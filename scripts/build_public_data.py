"""GeoVIGIÁGUA DF: gera a base pública agregada e as camadas web a partir das fontes originais.

Uso:
    python scripts/build_public_data.py --fontes ../fontes --saida .

A pasta de fontes NÃO deve ser versionada no repositório público. Ela deve conter:
    Mapeamento_Agua_2024.xlsx, Mapeamento_Agua_2025.xlsx, Mapeamento_Agua_2026.xlsx
    regioes_administrativas.zip
    Limite do DF.zip
    Hidrografia Geral/  (pasta extraída do .rar, com "Rios e Córregos" e "Lagos e Barragens")
    Saúde/              (pasta extraída do .rar, com os GeoJSON de Regiões e Macrorregiões de Saúde)

A planilha VIGIAGUA_DF_Gestao_Coletas_2026.xlsx é institucional e restrita: este script não a lê.

Dependências: pandas, openpyxl, geopandas (>= 1.0), shapely (>= 2.1), pyogrio.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import shutil
import tempfile
import unicodedata
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import pandas as pd
import shapely
from pyproj import Transformer
from shapely.geometry import Point

VERSAO = "2.0.0"
SRC_WEB = "EPSG:4326"
SRC_METRICO = "EPSG:31983"  # SIRGAS 2000 / UTM 23S, SRC original das camadas SEGETH/SEDUH

NOMES_RA = {
    1: "Plano Piloto", 2: "Gama", 3: "Taguatinga", 4: "Brazlândia", 5: "Sobradinho", 6: "Planaltina",
    7: "Paranoá", 8: "Núcleo Bandeirante", 9: "Ceilândia", 10: "Guará", 11: "Cruzeiro", 12: "Samambaia",
    13: "Santa Maria", 14: "São Sebastião", 15: "Recanto das Emas", 16: "Lago Sul", 17: "Riacho Fundo",
    18: "Lago Norte", 19: "Candangolândia", 20: "Águas Claras", 21: "Riacho Fundo II", 22: "Sudoeste/Octogonal",
    23: "Varjão", 24: "Park Way", 25: "SCIA/Estrutural", 26: "Sobradinho II", 27: "Jardim Botânico",
    28: "Itapoã", 29: "SIA", 30: "Vicente Pires", 31: "Fercal", 32: "Sol Nascente/Pôr do Sol",
    33: "Arniqueira", 34: "Arapoanga", 35: "Água Quente",
}

# Grafias encontradas na coluna RA das planilhas -> código da RA (ra_cira). Usado apenas quando
# o ponto não tem coordenada válida dentro do DF; nos demais casos vale a interseção espacial.
ALIASES_RA = {
    "ASA NORTE": 1, "ASA SUL": 1, "NOROESTE": 1, "GRANJA DO TORTO": 1, "VILA PLANALTO": 1, "SMU": 1,
    "OCTOGONAL": 22, "SUDOESTE": 22, "ESTRUTURAL": 25, "SCIA": 25, "SCIA / ESTRUTURAL": 25,
    "SOL NASCENTE": 32, "RIACHO FUNDO I": 17, "SOBRADINHO I": 5, "S I A": 29, "PARKWAY": 24,
    "N.BANDEIRANTE": 8, "JARDINS MANGUEIRAL": 14, "LAGO OESTE": 26,
}

# Tabela de correspondência RA (ra_cira) -> Região de Saúde, versão 2.0.0. Compatível com o Plano Distrital de
# Saúde 2024–2027 (SES-DF), confirmada pela equipe do projeto em 13/10/2026 (Lago Norte e Varjão na Região Central).
# Alterações devem ser registradas no CHANGELOG.md com a nova versão.
CORRESPONDENCIA_RS = {
    1: "Central", 11: "Central", 16: "Central", 18: "Central", 22: "Central", 23: "Central",
    8: "Centro-Sul", 10: "Centro-Sul", 17: "Centro-Sul", 19: "Centro-Sul", 21: "Centro-Sul", 24: "Centro-Sul", 25: "Centro-Sul", 29: "Centro-Sul",
    7: "Leste", 14: "Leste", 27: "Leste", 28: "Leste",
    5: "Norte", 6: "Norte", 26: "Norte", 31: "Norte", 34: "Norte",
    4: "Oeste", 9: "Oeste", 32: "Oeste",
    3: "Sudoeste", 12: "Sudoeste", 15: "Sudoeste", 20: "Sudoeste", 30: "Sudoeste", 33: "Sudoeste", 35: "Sudoeste",
    2: "Sul", 13: "Sul",
}

MOTIVOS = ["Rotina", "Retorno", "Recoleta", "Solicitação", "Ouvidoria", "Surto", "Vigidesastre", "Outros", "Não informado"]

COLUNAS = {
    "ra": r"^RA$", "lat": r"^Latitude", "lon": r"^Longitude", "amostra": r"^num_gal$",
    "local": r"^Localidade$", "data": r"^Data da Coleta$", "motivo": r"^Motivo$",
    "ct": r"^C_Totais$", "ec": r"^EColi$",
}

LICENCA_SEGETH = ("Produto de autoria da SEGETH/SEDUH-DF. Metadados da fonte: uso próprio, vedada a reprodução e "
                  "comercialização para terceiros; a SEDUH não se responsabiliza pelo uso impróprio.")


def norm(texto) -> str:
    if texto is None or (isinstance(texto, float) and pd.isna(texto)):
        return ""
    texto = unicodedata.normalize("NFD", str(texto)).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", texto).strip().upper()


def resultado(valor) -> str:
    v = norm(valor)
    if v.startswith("PRESEN"):
        return "P"
    if v.startswith("AUSEN"):
        return "A"
    return "N"


def motivo(valor) -> str:
    v = norm(valor)
    mapa = {"ROTINA": "Rotina", "RETORNO": "Retorno", "RECOLETA": "Recoleta", "SOLICITACAO": "Solicitação",
            "SOLICITADO": "Solicitação", "OUVIDORIA": "Ouvidoria", "SURTO": "Surto", "VIGIDESASTRE": "Vigidesastre"}
    if not v or v == "SEM INFORMACAO":
        return "Não informado"
    return mapa.get(v, "Outros")


def coordenada(valor):
    if valor is None or (isinstance(valor, float) and pd.isna(valor)):
        return None
    try:
        numero = float(str(valor).strip().replace(",", "."))
    except ValueError:
        return None
    return numero if abs(numero) <= 180 else None


def arredondar(geom, casas=5):
    return shapely.set_precision(geom, 10 ** -casas) if geom is not None else geom


def gravar_json(caminho: Path, dados, compacto=True):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with caminho.open("w", encoding="utf-8") as arquivo:
        json.dump(dados, arquivo, ensure_ascii=False, separators=(",", ":") if compacto else None,
                  indent=None if compacto else 2)


def gravar_geojson(gdf: gpd.GeoDataFrame, caminho: Path, casas=5, metadados=None):
    gdf = gdf.to_crs(SRC_WEB).copy()
    gdf["geometry"] = gdf.geometry.apply(lambda g: arredondar(g, casas))
    dados = json.loads(gdf.to_json(drop_id=True))
    dados.pop("crs", None)
    if metadados:
        dados = {"type": "FeatureCollection", "metadata": metadados, "features": dados["features"]}
    gravar_json(caminho, dados)


def zip_shapefile(gdf: gpd.GeoDataFrame, destino: Path, nome: str, extras: dict[str, bytes] | None = None):
    """Grava o Shapefile (.shp, .shx, .dbf, .prj, .cpg) e empacota em ZIP."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as pasta:
        alvo = Path(pasta) / f"{nome}.shp"
        gdf.to_file(alvo, driver="ESRI Shapefile", encoding="UTF-8", engine="pyogrio")
        cpg = alvo.with_suffix(".cpg")
        if not cpg.exists():
            cpg.write_text("UTF-8", encoding="ascii")
        with zipfile.ZipFile(destino, "w", zipfile.ZIP_DEFLATED) as pacote:
            for ext in (".shp", ".shx", ".dbf", ".prj", ".cpg"):
                arquivo = alvo.with_suffix(ext)
                if not arquivo.exists():
                    raise RuntimeError(f"Componente ausente no Shapefile {nome}: {ext}")
                pacote.write(arquivo, arquivo.name)
            for nome_extra, conteudo in (extras or {}).items():
                pacote.writestr(nome_extra, conteudo)


def tamanho(caminho: Path) -> str:
    b = caminho.stat().st_size
    for unidade in ("B", "KB", "MB"):
        if b < 1024 or unidade == "MB":
            return f"{b:.0f} {unidade}" if unidade == "B" else f"{b:.1f} {unidade}".replace(".", ",")
        b /= 1024
    return ""


def sha256(caminho: Path) -> str:
    return hashlib.sha256(caminho.read_bytes()).hexdigest()


def ler_shapefile_zip(caminho: Path, padrao: str, encoding="utf-8") -> gpd.GeoDataFrame:
    with zipfile.ZipFile(caminho) as pacote:
        nomes = [n for n in pacote.namelist() if re.search(padrao, n, re.I) and n.lower().endswith(".shp")]
        if len(nomes) != 1:
            raise RuntimeError(f"Esperado 1 shapefile '{padrao}' em {caminho.name}; encontrados {nomes}")
        return gpd.read_file(f"zip://{caminho}!{nomes[0]}", encoding=encoding)


# ---------------------------------------------------------------- camadas territoriais

def construir_territorios(fontes: Path, saida: Path, log: list[str]):
    ra = ler_shapefile_zip(fontes / "regioes_administrativas.zip", r"regioes_administrativas")
    if len(ra) != 35 or ra.crs.to_epsg() != 31983:
        raise RuntimeError(f"RA: esperados 35 polígonos em EPSG:31983; obtidos {len(ra)} em {ra.crs}")
    if not ra.is_valid.all():
        raise RuntimeError("RA: há geometrias inválidas")
    ra["cira"] = ra["ra_cira"].astype(int)
    for _, linha in ra.iterrows():
        oficial = norm(NOMES_RA[linha.cira]).replace("/", " ")
        fonte = norm(linha.ra_nome).replace("/", " ")
        if oficial.split()[0] != fonte.split()[0]:
            raise RuntimeError(f"RA {linha.cira}: nome da fonte '{linha.ra_nome}' não confere com '{NOMES_RA[linha.cira]}'")
    ra["codigo"] = ra["ra_codigo"].str.strip()
    ra["nome"] = ra["cira"].map(NOMES_RA)
    ra["area_km2"] = (ra.geometry.area / 1e6).round(2)

    rs = gpd.read_file(fontes / "Saúde" / "Regiões de Saúde.geojson").to_crs(SRC_METRICO)
    rs = rs.rename(columns={"Reg_Saúde": "regiao_saude"})
    macro = gpd.read_file(fontes / "Saúde" / "Macrorregiões de Saúde.geojson").to_crs(SRC_METRICO)
    if len(rs) != 7:
        raise RuntimeError(f"Esperadas 7 Regiões de Saúde; obtidas {len(rs)}")

    # Correspondência RA -> Região de Saúde: tabela versionada (CORRESPONDENCIA_RS), conferida contra o
    # GeoJSON original de Regiões de Saúde pela maior área de interseção.
    cruzamento = gpd.overlay(ra[["cira", "geometry"]], rs[["regiao_saude", "geometry"]], how="intersection", keep_geom_type=True)
    cruzamento["area"] = cruzamento.geometry.area
    total = ra.set_index("cira").geometry.area
    poligono_original = {}
    for cira, grupo in cruzamento.groupby("cira"):
        melhor = grupo.sort_values("area", ascending=False).iloc[0]
        poligono_original[int(cira)] = (melhor.regiao_saude, round(float(melhor.area / total[cira]), 4))
    if set(CORRESPONDENCIA_RS) != set(NOMES_RA) or set(CORRESPONDENCIA_RS.values()) != set(rs.regiao_saude):
        raise RuntimeError("Tabela CORRESPONDENCIA_RS incompleta ou com nomes de Região de Saúde desconhecidos")
    ra["regiao_saude"] = ra["cira"].map(CORRESPONDENCIA_RS)
    ra["rs_poligono_original"] = ra["cira"].map(lambda c: poligono_original[c][0])
    ra["proporcao_area_original"] = ra["cira"].map(lambda c: poligono_original[c][1])
    divergentes = ra[ra.regiao_saude != ra.rs_poligono_original]
    for _, linha in divergentes.iterrows():
        log.append(f"Divergência: RA {linha.nome} está na Região {linha.regiao_saude} pela tabela, mas no polígono original da Região {linha.rs_poligono_original}.")

    # Regiões de Saúde reconstituídas pela dissolução das RAs (coerentes com a tabela e com os limites de RA vigentes).
    rs_atual = ra[["regiao_saude", "geometry"]].dissolve(by="regiao_saude", as_index=False)
    macro_cross = gpd.overlay(rs_atual, macro[["nome", "geometry"]], how="intersection", keep_geom_type=True)
    macro_cross["area"] = macro_cross.geometry.area
    macro_por_rs = {r: g.sort_values("area", ascending=False).iloc[0]["nome"] for r, g in macro_cross.groupby("regiao_saude")}
    rs_atual["macrorregiao"] = rs_atual.regiao_saude.map(macro_por_rs)
    rs_atual["ras"] = rs_atual.regiao_saude.map(lambda n: ", ".join(ra[ra.regiao_saude == n].sort_values("cira").nome))

    # Simplificação topológica (cobertura sem lacunas entre vizinhos).
    ra_web = ra[["cira", "codigo", "nome", "regiao_saude", "area_km2", "geometry"]].copy().sort_values("cira")
    ra_web["geometry"] = shapely.coverage_simplify(ra_web.geometry.values, tolerance=15)
    gravar_geojson(ra_web, saida / "data" / "limites_ra.geojson")
    rs_web = ra_web[["regiao_saude", "geometry"]].dissolve(by="regiao_saude", as_index=False)
    rs_web["macrorregiao"] = rs_web.regiao_saude.map(macro_por_rs)
    gravar_geojson(rs_web.rename(columns={"regiao_saude": "nome"}), saida / "data" / "regioes_saude.geojson")
    macro_web = macro[["nome", "geometry"]].copy()
    macro_web["geometry"] = macro_web.geometry.simplify(15, preserve_topology=True)
    gravar_geojson(macro_web, saida / "data" / "macrorregioes_saude.geojson")

    df = ler_shapefile_zip(fontes / "Limite do DF.zip", r"Limite do DF")
    df_web = df[["nm_estado", "cd_geocuf", "geometry"]].copy()
    df_web["geometry"] = df_web.geometry.simplify(10)
    gravar_geojson(df_web, saida / "data" / "limite_df.geojson")

    regioes = []
    for nome_rs in sorted(rs.regiao_saude):
        membros = ra_web[ra_web.regiao_saude == nome_rs].sort_values("cira")
        regioes.append({"nome": nome_rs, "macrorregiao": macro_por_rs.get(nome_rs), "ras": membros.cira.tolist()})
    tabela = {
        "versao": VERSAO,
        "status": "Preliminar: requer validação institucional da GVAFNB.",
        "metodo": ("Tabela versionada no script de build (CORRESPONDENCIA_RS), compatível com o Plano Distrital de Saúde 2024–2027 da SES-DF. "
                   "Conferida contra o GeoJSON original de Regiões de Saúde pela maior área de interseção."),
        "divergencias": [{"cira": int(l.cira), "nome": l.nome, "regiao_tabela": l.regiao_saude, "regiao_poligono_original": l.rs_poligono_original}
                         for l in divergentes.itertuples()],
        "regioes": regioes,
        "ras": [{"cira": int(l.cira), "codigo": l.codigo, "nome": l.nome, "regiao_saude": l.regiao_saude,
                 "regiao_poligono_original": l.rs_poligono_original, "area_km2": float(l.area_km2)}
                for l in ra.sort_values("cira").itertuples()],
    }
    gravar_json(saida / "data" / "regioes_saude.json", tabela, compacto=False)
    (saida / "data" / "dados_publicos").mkdir(parents=True, exist_ok=True)
    with (saida / "data" / "dados_publicos" / "correspondencia_ra_regiao_saude.csv").open("w", newline="", encoding="utf-8-sig") as arq:
        escritor = csv.writer(arq, delimiter=";")
        escritor.writerow(["ra_cira", "ra_codigo", "ra_nome", "regiao_saude", "regiao_no_poligono_original", "area_km2", "versao"])
        for r in tabela["ras"]:
            escritor.writerow([r["cira"], r["codigo"], r["nome"], r["regiao_saude"], r["regiao_poligono_original"], str(r["area_km2"]).replace(".", ","), VERSAO])

    # Pacotes para download (Shapefile ZIP + GeoJSON em resolução integral).
    ra_dl = ra[["cira", "codigo", "nome", "regiao_saude", "area_km2", "ra_path", "geometry"]].rename(columns={"ra_path": "monografia", "regiao_saude": "reg_saude"})
    zip_shapefile(ra_dl, saida / "downloads" / "regioes_administrativas" / "regioes_administrativas_df.zip", "regioes_administrativas_df")
    gravar_geojson(ra_dl, saida / "downloads" / "regioes_administrativas" / "regioes_administrativas_df.geojson", casas=6)
    zip_shapefile(df[["nm_estado", "nm_regiao", "cd_geocuf", "geometry"]], saida / "downloads" / "limite_df" / "limite_df.zip", "limite_df")
    gravar_geojson(df[["nm_estado", "nm_regiao", "cd_geocuf", "geometry"]], saida / "downloads" / "limite_df" / "limite_df.geojson", casas=6)
    rs_dl = rs_atual.rename(columns={"regiao_saude": "reg_saude", "macrorregiao": "macrorreg"})
    zip_shapefile(rs_dl, saida / "downloads" / "saude" / "regioes_saude_df.zip", "regioes_saude_df")
    gravar_geojson(rs_dl, saida / "downloads" / "saude" / "regioes_saude_df.geojson", casas=6)
    zip_shapefile(macro[["nome", "geometry"]].to_crs(SRC_WEB), saida / "downloads" / "saude" / "macrorregioes_saude_df.zip", "macrorregioes_saude_df")

    log.append(f"RA: 35 polígonos válidos, EPSG:31983 -> EPSG:4326; Regiões de Saúde: {len(rs)}; Macrorregiões: {len(macro)}.")
    return ra, tabela


# ---------------------------------------------------------------- hidrografia

def construir_hidrografia(fontes: Path, saida: Path, ra: gpd.GeoDataFrame, log: list[str]):
    base = fontes / "Hidrografia Geral"
    lagos = gpd.read_file(base / "Lagos e Barragens" / "Lagos e Barragens.shp")
    rios = gpd.read_file(base / "Rios e Córregos" / "Rios e Córregos.shp")
    for nome, camada in (("Lagos e Barragens", lagos), ("Rios e Córregos", rios)):
        if camada.crs.to_epsg() != 31983:
            raise RuntimeError(f"{nome}: SRC inesperado {camada.crs}")
        invalidas = (~camada.is_valid).sum()
        log.append(f"Hidrografia · {nome}: {len(camada)} feições, EPSG:31983, {invalidas} geometrias inválidas.")

    # Síntese hidrográfica por RA (preparação de cruzamentos; não implica relação causal com a qualidade da água).
    trechos = gpd.overlay(rios[["perene", "geometry"]], ra[["cira", "geometry"]], how="intersection", keep_geom_type=True)
    trechos["km"] = trechos.geometry.length / 1000
    espelhos = gpd.overlay(lagos[["geometry"]], ra[["cira", "geometry"]], how="intersection", keep_geom_type=True)
    espelhos["ha"] = espelhos.geometry.area / 1e4
    por_ra = {}
    for cira in sorted(ra.cira):
        t = trechos[trechos.cira == cira]
        e = espelhos[espelhos.cira == cira]
        por_ra[str(cira)] = {"km_total": round(float(t.km.sum()), 1), "km_perene": round(float(t[t.perene == "SIM"].km.sum()), 1),
                             "espelhos": int(len(e)), "espelhos_ha": round(float(e.ha.sum()), 1)}
    gravar_json(saida / "data" / "hidrografia_por_ra.json", {
        "versao": VERSAO, "fonte": "SEGETH/SEDUH-DF · Hidrografia Geral (Rios e Córregos; Lagos e Barragens), resolução integral, EPSG:31983",
        "nota": "Extensão de trechos e área de espelhos d'água recortados pelos limites de cada RA. Indicadores de contexto territorial; proximidade não indica causalidade.",
        "ras": por_ra})

    lagos = lagos[["descricao", "tipo", "perene", "geometry"]].copy()
    lagos["area_ha"] = (lagos.geometry.area / 1e4).round(2)
    lagos["geometry"] = lagos.geometry.simplify(6, preserve_topology=True)
    lagos = lagos[lagos.geometry.area > 0]
    gravar_geojson(lagos, saida / "data" / "hidrografia_lagos.geojson")

    rios = rios[["descricao", "tipo", "perene", "geometry"]].copy()
    rios["descricao"] = rios.descricao.fillna("")
    # Dissolve trechos por nome/tipo/perenidade para reduzir o volume na web sem perder atributos.
    rios = rios.dissolve(by=["descricao", "tipo", "perene"], as_index=False)
    rios["geometry"] = shapely.line_merge(rios.geometry.values)
    rios["extensao_km"] = (rios.geometry.length / 1000).round(2)
    rios["geometry"] = rios.geometry.simplify(12, preserve_topology=False)
    principais = rios[(rios.perene == "SIM") | (rios.descricao != "")]
    gravar_geojson(principais, saida / "data" / "hidrografia_rios_principais.geojson")
    secundarios = rios[~rios.index.isin(principais.index)]
    gravar_geojson(secundarios, saida / "data" / "hidrografia_rios_demais.geojson")
    log.append(f"Hidrografia web: {len(principais)} grupos de cursos principais/nomeados, {len(secundarios)} grupos de demais trechos, {len(lagos)} espelhos d'água.")
    return {
        "lagos_tipos": lagos.tipo.value_counts().to_dict(),
        "rios_tipos": gpd.read_file(base / "Rios e Córregos" / "Rios e Córregos.shp", columns=["tipo"], ignore_geometry=True).tipo.value_counts().to_dict(),
    }


# ---------------------------------------------------------------- monitoramento

def localizar_colunas(colunas):
    achadas = {}
    for chave, padrao in COLUNAS.items():
        for coluna in colunas:
            if re.search(padrao, str(coluna).strip(), re.I):
                achadas[chave] = coluna
                break
    faltantes = {"ra", "lat", "lon", "data"} - achadas.keys()
    if faltantes:
        raise RuntimeError(f"Colunas obrigatórias ausentes: {faltantes}")
    return achadas


def construir_monitoramento(fontes: Path, saida: Path, ra: gpd.GeoDataFrame, tabela_rs: dict, log: list[str]):
    para_utm = Transformer.from_crs(SRC_WEB, SRC_METRICO, always_xy=True)
    df_area = ra.geometry.union_all().buffer(150)
    ra_por_cira = dict(zip(ra.cira, ra.geometry))  # tolerância de 150 m na borda do DF
    rs_por_ra = {r["cira"]: r["regiao_saude"] for r in tabela_rs["ras"]}
    arquivos = sorted(fontes.glob("Mapeamento_Agua_20*.xlsx"))
    if [a.name for a in arquivos] != ["Mapeamento_Agua_2024.xlsx", "Mapeamento_Agua_2025.xlsx", "Mapeamento_Agua_2026.xlsx"]:
        raise RuntimeError(f"Planilhas de mapeamento inesperadas: {[a.name for a in arquivos]}")

    amostras = []
    qualidade = []
    for arquivo in arquivos:
        ano = int(re.search(r"20\d\d", arquivo.stem).group())
        planilha = pd.read_excel(arquivo, sheet_name=0, dtype=object)  # primeira aba: "Cronograma"
        c = localizar_colunas(planilha.columns)
        planilha = planilha[planilha[c["ra"]].notna() | planilha[c["lat"]].notna()].reset_index(drop=True)
        q = Counter(linhas=len(planilha))
        vistos = set()
        for i, linha in planilha.iterrows():
            codigo = linha.get(c.get("amostra")) if "amostra" in c else None
            codigo = None if codigo is None or pd.isna(codigo) else str(codigo).strip().split(".")[0]
            chave = f"{ano}:{codigo}" if codigo else f"{ano}:linha{i}"
            if not codigo:
                q["sem_codigo_amostra"] += 1
            if chave in vistos:
                q["linhas_repetidas_mesma_amostra"] += 1
                continue
            vistos.add(chave)

            lat, lon = coordenada(linha[c["lat"]]), coordenada(linha[c["lon"]])
            cira_espacial = None
            if lat is not None and lon is not None:
                ponto_utm = Point(*para_utm.transform(lon, lat))
                if df_area.contains(ponto_utm):
                    alvo = ra[ra.contains(ponto_utm)]
                    if alvo.empty:  # ponto na faixa de tolerância: RA mais próxima
                        alvo = ra.iloc[[ra.distance(ponto_utm).argmin()]]
                    cira_espacial = int(alvo.iloc[0].cira)
                else:
                    q["coordenada_fora_do_df"] += 1
            else:
                q["sem_coordenada"] += 1

            nome_ra = norm(linha[c["ra"]])
            cira_atributo = ALIASES_RA.get(nome_ra) or next((k for k, v in NOMES_RA.items() if norm(v).replace("/", " ") == nome_ra.replace("/", " ").replace(" / ", " ")), None)
            if cira_espacial and cira_atributo and cira_atributo != cira_espacial:
                q["ra_atributo_diverge_da_espacial"] += 1
                # Ponto a mais de 2 km da RA informada: coordenada suspeita, prevalece o atributo.
                if ra_por_cira[cira_atributo].distance(ponto_utm) > 2000:
                    q["coordenada_suspeita_prevaleceu_atributo"] += 1
                    cira_espacial = None
            if cira_espacial:
                cira, metodo = cira_espacial, "espacial"
            elif cira_atributo:
                cira, metodo = cira_atributo, "atributo"
            else:
                cira, metodo = 0, "sem_ra"
            q[f"ra_por_{metodo}"] += 1

            data = linha[c["data"]]
            data = pd.to_datetime(data, errors="coerce", dayfirst=True) if not isinstance(data, datetime) else pd.Timestamp(data)
            if pd.isna(data):
                q["sem_data"] += 1
                mes = 0
            else:
                if data.year != ano:
                    q["data_fora_do_ano"] += 1
                mes = int(data.month)

            local = norm(linha.get(c.get("local"))) if "local" in c else ""
            estabelecimento = f"{cira}|{local}" if local else f"{cira}|{lat:.4f},{lon:.4f}" if lat is not None and lon is not None else f"linha{ano}{i}"
            amostras.append({
                "ano": ano, "mes": mes, "ra": cira, "motivo": motivo(linha.get(c.get("motivo"))) if "motivo" in c else "Não informado",
                "ct": resultado(linha.get(c.get("ct"))) if "ct" in c else "N",
                "ec": resultado(linha.get(c.get("ec"))) if "ec" in c else "N",
                "estab": estabelecimento,
            })
        q["amostras_distintas"] = len(vistos)
        qualidade.append({"ano": ano, "arquivo": arquivo.name, "sha256": sha256(arquivo), **dict(q)})

    base = pd.DataFrame(amostras)
    base["rs"] = base.ra.map(rs_por_ra).fillna("Sem correspondência")

    # Cubo agregado: nenhuma linha identifica estabelecimento, endereço, coordenada ou código de amostra.
    cubo = (base.groupby(["ano", "mes", "ra", "motivo", "ct", "ec"]).size().reset_index(name="n"))
    cubo["motivo"] = cubo.motivo.map(MOTIVOS.index)

    # Estabelecimentos distintos (não somáveis entre meses/anos): pré-calculados por ano x mês x RA.
    estab = []
    for ano_alvo in [0] + sorted(base.ano.unique().tolist()):
        recorte_ano = base if ano_alvo == 0 else base[base.ano == ano_alvo]
        for mes_alvo in range(0, 13):
            recorte = recorte_ano if mes_alvo == 0 else recorte_ano[recorte_ano.mes == mes_alvo]
            for cira, grupo in recorte.groupby("ra"):
                estab.append([int(ano_alvo), mes_alvo, int(cira), int(grupo.estab.nunique())])

    resumo = {}
    for ano, g in base.groupby("ano"):
        com_resultado = g[(g.ct != "N") & (g.ec != "N")]
        resumo[int(ano)] = {
            "amostras": int(len(g)), "estabelecimentos": int(g.estab.nunique()),
            "com_resultado_microbiologico": int(len(com_resultado)),
            "satisfatorias_microbiologicas": int(((com_resultado.ct == "A") & (com_resultado.ec == "A")).sum()),
            "ct_presenca": int((g.ct == "P").sum()), "ec_presenca": int((g.ec == "P").sum()),
            "ras": int(g[g.ra > 0].ra.nunique()),
            "periodo": [f"{ano}-{int(g[g.mes > 0].mes.min()):02d}", f"{ano}-{int(g[g.mes > 0].mes.max()):02d}"] if (g.mes > 0).any() else None,
        }

    indicadores = {
        "versao": VERSAO,
        "geradoEm": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "Dados reais preliminares, derivados dos mapeamentos anuais; pendentes de validação institucional da GVAFNB.",
        "unidade": "amostra distinta (código GAL único por ano; linhas sem código contam como amostras próprias)",
        "criterios": {
            "satisfatoria_microbiologica": "Amostra com ausência de coliformes totais E ausência de Escherichia coli, ambos informados. Não equivale à conformidade integral (Portaria GM/MS nº 888/2021), que exige também parâmetros físico-químicos e residual desinfetante.",
            "percentuais": "Calculados sobre as amostras com resultado microbiológico informado (coliformes totais e E. coli).",
            "ra": "Interseção espacial do ponto de coleta com os 35 polígonos oficiais de RA; sem coordenada válida, usa-se a RA informada na planilha (grafias antigas normalizadas).",
            "regiao_saude": "Derivada da RA pela tabela de correspondência data/regioes_saude.json.",
            "conformidade_integral": "Não calculada nesta versão.",
        },
        "dimensoes": {"motivos": MOTIVOS, "resultados": {"P": "Presença", "A": "Ausência", "N": "Não informado"},
                      "ras": {str(k): v for k, v in NOMES_RA.items()} | {"0": "Sem RA identificada"}},
        "colunas": ["ano", "mes", "ra", "motivo", "ct", "ec", "n"],
        "linhas": cubo[["ano", "mes", "ra", "motivo", "ct", "ec", "n"]].values.tolist(),
        "estabelecimentos": {"descricao": "Locais distintos de coleta por ano x mês x RA (0 = todos). Não são somáveis entre meses ou anos.",
                             "colunas": ["ano", "mes", "ra", "n"], "linhas": estab},
        "resumoAnual": resumo,
        "qualidade": qualidade,
    }
    indicadores["linhas"] = [[int(a), int(m), int(r), int(mo), ct, ec, int(n)] for a, m, r, mo, ct, ec, n in indicadores["linhas"]]
    gravar_json(saida / "data" / "indicadores.json", indicadores)

    # Downloads tabulares por ano (CSV e Excel), agregados por RA x mês x motivo.
    for ano, g in base.groupby("ano"):
        tabela = (g.assign(ra_nome=g.ra.map(lambda r: NOMES_RA.get(r, "Sem RA identificada")),
                           ct_p=g.ct.eq("P"), ct_a=g.ct.eq("A"), ec_p=g.ec.eq("P"), ec_a=g.ec.eq("A"),
                           sat=g.ct.eq("A") & g.ec.eq("A"), res=g.ct.ne("N") & g.ec.ne("N"))
                  .groupby(["ano", "mes", "ra", "ra_nome", "rs", "motivo"], as_index=False)
                  .agg(amostras=("ct", "size"), com_resultado_microbiologico=("res", "sum"),
                       satisfatorias_microbiologicas=("sat", "sum"), coliformes_totais_presenca=("ct_p", "sum"),
                       coliformes_totais_ausencia=("ct_a", "sum"), e_coli_presenca=("ec_p", "sum"), e_coli_ausencia=("ec_a", "sum"))
                  .rename(columns={"ra": "ra_cira", "rs": "regiao_saude", "motivo": "motivo_coleta"}))
        tabela["mes"] = tabela.mes.replace(0, pd.NA)
        pasta = saida / "downloads" / f"mapeamento_{ano}"
        pasta.mkdir(parents=True, exist_ok=True)
        tabela.to_csv(pasta / f"mapeamento_agua_{ano}_agregado.csv", sep=";", index=False, encoding="utf-8-sig")
        with pd.ExcelWriter(pasta / f"mapeamento_agua_{ano}_agregado.xlsx", engine="openpyxl") as excel:
            tabela.to_excel(excel, sheet_name="agregado", index=False)
            pd.DataFrame({"campo": list(DICIONARIO_AGREGADO), "descricao": list(DICIONARIO_AGREGADO.values())}).to_excel(excel, sheet_name="dicionario", index=False)
            pd.DataFrame({"item": ["fonte", "gerado_em", "status", "criterio_satisfatoria"],
                          "valor": [f"Mapeamento_Agua_{ano}.xlsx (aba Cronograma)", indicadores["geradoEm"], indicadores["status"],
                                    indicadores["criterios"]["satisfatoria_microbiologica"]]}).to_excel(excel, sheet_name="metadados", index=False)
    for q in qualidade:
        log.append("Monitoramento " + ", ".join(f"{k}={v}" for k, v in q.items() if k != "sha256"))
    return indicadores


DICIONARIO_AGREGADO = {
    "ano": "Ano da planilha de mapeamento.",
    "mes": "Mês da data de coleta (vazio quando a data não foi informada).",
    "ra_cira": "Código numérico da Região Administrativa (1 a 35, SEGETH/SEDUH); 0 = sem RA identificada.",
    "ra_nome": "Nome oficial da Região Administrativa.",
    "regiao_saude": "Região de Saúde correspondente (tabela de correspondência RA–Região de Saúde).",
    "motivo_coleta": "Motivo da coleta padronizado (Rotina, Retorno, Recoleta, Solicitação, Ouvidoria, Surto, Vigidesastre, Outros, Não informado).",
    "amostras": "Número de amostras distintas.",
    "com_resultado_microbiologico": "Amostras com coliformes totais e E. coli informados.",
    "satisfatorias_microbiologicas": "Amostras com ausência de coliformes totais e de E. coli (critério microbiológico; não é conformidade integral).",
    "coliformes_totais_presenca": "Amostras com presença de coliformes totais.",
    "coliformes_totais_ausencia": "Amostras com ausência de coliformes totais.",
    "e_coli_presenca": "Amostras com presença de Escherichia coli.",
    "e_coli_ausencia": "Amostras com ausência de Escherichia coli.",
}


# ---------------------------------------------------------------- catálogo

def construir_catalogo(saida: Path, indicadores: dict, hidro: dict, log: list[str]):
    gerado = indicadores["geradoEm"][:10]
    dl = lambda p: {"href": p, "tamanho": tamanho(saida / p)}
    itens = [
        {"id": "regioes_administrativas", "nome": "Regiões Administrativas do DF", "tema": "Limites territoriais",
         "descricao": "Limites das 35 Regiões Administrativas com código (RA-I a RA-XXXV), nome oficial, área e Região de Saúde correspondente.",
         "fonte": "SEGETH/SEDUH-DF · SITURB (pacote regioes_administrativas.zip fornecido ao projeto)", "referencia": "2023 (edição de 15/05/2023)",
         "escala": "Cadastral (não informada na fonte)", "src": "SIRGAS 2000 / UTM 23S (EPSG:31983) na fonte; downloads em EPSG:4326",
         "geometria": "Polígono (35 feições)", "atualizacao": gerado, "licenca": "Dado público do GDF; citar SEGETH/SEDUH-DF como fonte.",
         "restricoes": "Nenhuma informada na fonte.", "acesso": "Público", "anos": [2023], "camada": "ra",
         "formatos": {"shp": dl("downloads/regioes_administrativas/regioes_administrativas_df.zip"),
                      "geojson": dl("downloads/regioes_administrativas/regioes_administrativas_df.geojson")}},
        {"id": "limite_df", "nome": "Limite do Distrito Federal", "tema": "Limites territoriais",
         "descricao": "Contorno do Distrito Federal (linha), com código IBGE da UF (53).",
         "fonte": "Pacote 'Limite do DF.zip' fornecido ao projeto (atributos no padrão IBGE)", "referencia": "Não informada na fonte",
         "escala": "Não informada", "src": "SIRGAS 2000 / UTM 23S (EPSG:31983) na fonte; downloads em EPSG:4326",
         "geometria": "Linha (1 feição)", "atualizacao": gerado, "licenca": "Não informada na fonte; confirmar antes de redistribuir.",
         "restricoes": "Nenhuma informada.", "acesso": "Público", "anos": [], "camada": "limite",
         "formatos": {"shp": dl("downloads/limite_df/limite_df.zip"), "geojson": dl("downloads/limite_df/limite_df.geojson")}},
        {"id": "regioes_saude", "nome": "Regiões de Saúde do DF", "tema": "Saúde",
         "descricao": "Sete Regiões de Saúde (Central, Centro-Sul, Leste, Norte, Oeste, Sudoeste e Sul) reconstituídas pela dissolução dos 35 polígonos de RA conforme a tabela de correspondência v" + VERSAO + ".",
         "fonte": "GeoVIGIÁGUA DF, a partir de SEGETH/SEDUH-DF (RAs) e da tabela RA–Região de Saúde", "referencia": gerado,
         "escala": "Cadastral (herdada das RAs)", "src": "WGS 84 (EPSG:4326)", "geometria": "Polígono (7 feições)", "atualizacao": gerado,
         "licenca": "Uso livre com citação; validar com SES-DF.", "restricoes": "Preliminar; requer validação institucional.", "acesso": "Público", "anos": [], "camada": "rs",
         "formatos": {"shp": dl("downloads/saude/regioes_saude_df.zip"), "geojson": dl("downloads/saude/regioes_saude_df.geojson")}},
        {"id": "regioes_saude_original", "nome": "Regiões de Saúde · arquivo original", "tema": "Saúde",
         "descricao": "GeoJSON de Regiões de Saúde recebido pelo projeto, mantido sem alteração.",
         "fonte": "Arquivo 'Saúde/Regiões de Saúde.geojson' fornecido ao projeto; origem não documentada", "referencia": "Não informada na fonte",
         "escala": "Não informada", "src": "WGS 84 (EPSG:4326)", "geometria": "Polígono (7 feições)", "atualizacao": "—",
         "licenca": "Não informada; validar com SES-DF.", "restricoes": "Nenhuma informada.", "acesso": "Público", "anos": [], "camada": None,
         "formatos": {"geojson": dl("Saúde/Regiões de Saúde.geojson")}},
        {"id": "macrorregioes_saude", "nome": "Macrorregiões de Saúde do DF", "tema": "Saúde",
         "descricao": "Limites das três Macrorregiões de Saúde.",
         "fonte": "Arquivo 'Saúde/Macrorregiões de Saúde.geojson' fornecido ao projeto; origem não documentada", "referencia": "Não informada na fonte",
         "escala": "Não informada", "src": "WGS 84 (EPSG:4326)", "geometria": "Polígono (3 feições)", "atualizacao": gerado,
         "licenca": "Não informada; validar com SES-DF.", "restricoes": "Nenhuma informada.", "acesso": "Público", "anos": [], "camada": "macro",
         "formatos": {"shp": dl("downloads/saude/macrorregioes_saude_df.zip"), "geojson": dl("Saúde/Macrorregiões de Saúde.geojson")}},
        {"id": "correspondencia_ra_rs", "nome": "Correspondência RA – Região de Saúde", "tema": "Saúde",
         "descricao": "Tabela versionada que associa cada RA à Região de Saúde de maior sobreposição de área.",
         "fonte": "GeoVIGIÁGUA DF (derivação espacial)", "referencia": gerado, "escala": "—", "src": "—", "geometria": "Tabela",
         "atualizacao": gerado, "licenca": "Uso livre com citação do GeoVIGIÁGUA DF.", "restricoes": "Preliminar; requer validação institucional.",
         "acesso": "Público", "anos": [], "camada": None,
         "formatos": {"csv": dl("data/dados_publicos/correspondencia_ra_regiao_saude.csv")}},
    ]
    for ano in (2024, 2025, 2026):
        r = indicadores["resumoAnual"][ano]
        q = next(x for x in indicadores["qualidade"] if x["ano"] == ano)
        obs = " Esta planilha não traz resultados microbiológicos." if r["com_resultado_microbiologico"] == 0 else ""
        itens.append({
            "id": f"mapeamento_{ano}", "nome": f"Mapeamento da Água {ano} · base agregada", "tema": "Monitoramento",
            "descricao": f"{r['amostras']:,}".replace(",", ".") + f" amostras distintas agregadas por RA, Região de Saúde, mês e motivo, com contagens de coliformes totais e E. coli.{obs}",
            "fonte": f"GVAFNB/DIVAL/SVS/SES-DF · Mapeamento_Agua_{ano}.xlsx (aba Cronograma)",
            "referencia": f"{r['periodo'][0]} a {r['periodo'][1]}" if r["periodo"] else str(ano),
            "escala": "Agregado por Região Administrativa", "src": "—", "geometria": "Tabela (agregada por RA)", "atualizacao": gerado,
            "licenca": "Dados públicos agregados; citar GVAFNB/DIVAL/SVS/SES-DF.",
            "restricoes": "Sem endereços, coordenadas, códigos de amostra ou equipes. Dados preliminares pendentes de validação institucional.",
            "acesso": "Público", "anos": [ano], "camada": "monitoramento",
            "formatos": {"xlsx": dl(f"downloads/mapeamento_{ano}/mapeamento_agua_{ano}_agregado.xlsx"),
                         "csv": dl(f"downloads/mapeamento_{ano}/mapeamento_agua_{ano}_agregado.csv")},
            "qualidade": {k: v for k, v in q.items() if k not in ("sha256", "arquivo")},
        })
    itens += [
        {"id": "rios_corregos", "nome": "Rios e Córregos", "tema": "Hidrografia",
         "descricao": "Hidrografia linear do DF: " + ", ".join(f"{k.lower()} ({v:,})".replace(",", ".") for k, v in hidro["rios_tipos"].items()) + ".",
         "fonte": "SEGETH/SEDUH-DF · Hidrografia Geral", "referencia": "Criação 12/12/2017; modificação 18/10/2019",
         "escala": "Não informada", "src": "SIRGAS 2000 / UTM 23S (EPSG:31983)", "geometria": "Linha (64.118 feições)", "atualizacao": "2019-10-18",
         "licenca": LICENCA_SEGETH, "restricoes": "Download não disponibilizado: a licença da fonte veda reprodução para terceiros. Visualização simplificada no mapa, com atribuição. Obtenha o arquivo junto à SEDUH-DF.",
         "acesso": "Visualização", "anos": [2019], "camada": "rios", "formatos": {}},
        {"id": "lagos_barragens", "nome": "Lagos e Barragens", "tema": "Hidrografia",
         "descricao": "Espelhos d'água do DF: " + ", ".join(f"{k.lower()} ({v:,})".replace(",", ".") for k, v in hidro["lagos_tipos"].items()) + ".",
         "fonte": "SEGETH/SEDUH-DF · Hidrografia Geral", "referencia": "Criação 12/12/2017; modificação 18/10/2019",
         "escala": "Não informada", "src": "SIRGAS 2000 / UTM 23S (EPSG:31983)", "geometria": "Polígono (1.940 feições)", "atualizacao": "2019-10-18",
         "licenca": LICENCA_SEGETH, "restricoes": "Download não disponibilizado: a licença da fonte veda reprodução para terceiros. Visualização simplificada no mapa, com atribuição. Obtenha o arquivo junto à SEDUH-DF.",
         "acesso": "Visualização", "anos": [2019], "camada": "lagos", "formatos": {}},
        {"id": "gestao_coletas_2026", "nome": "VIGIÁGUA DF · Gestão de Coletas 2026", "tema": "Monitoramento",
         "descricao": "Base operacional institucional (visitas, laudos, endereços e contatos).",
         "fonte": "GVAFNB/DIVAL/SVS/SES-DF", "referencia": "2026", "escala": "—", "src": "—", "geometria": "Tabela",
         "atualizacao": "—", "licenca": "Uso institucional.", "restricoes": "Base restrita: não é publicada nem lida por este portal. Somente derivados agregados aprovados poderão ser publicados.",
         "acesso": "Restrito", "anos": [2026], "camada": None, "formatos": {}},
    ]
    for item in itens:
        item["metadados"] = f"docs/metadados/{item['id']}.json"
        gravar_json(saida / item["metadados"], {k: v for k, v in item.items() if k != "metadados"} | {"versao_catalogo": VERSAO}, compacto=False)
    gravar_json(saida / "data" / "catalogo.json", {"versao": VERSAO, "geradoEm": indicadores["geradoEm"], "itens": itens}, compacto=False)
    log.append(f"Catálogo: {len(itens)} itens.")


def preservar_legado(fontes: Path, saida: Path, log: list[str]):
    """Mantém as URLs publicadas na versão 1.x (GeoJSON de saúde e pacotes ZIP originais)."""
    (saida / "Saúde").mkdir(parents=True, exist_ok=True)
    for nome in ("Regiões de Saúde.geojson", "Macrorregiões de Saúde.geojson"):
        shutil.copy2(fontes / "Saúde" / nome, saida / "Saúde" / nome)
    for nome in ("regioes_administrativas.zip", "Limite do DF.zip"):
        shutil.copy2(fontes / nome, saida / nome)
    log.append("URLs legadas preservadas: Saúde/*.geojson, regioes_administrativas.zip, Limite do DF.zip.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fontes", required=True, type=Path, help="Pasta com os arquivos originais (fora do repositório)")
    parser.add_argument("--saida", default=Path(__file__).resolve().parents[1], type=Path, help="Raiz do site")
    args = parser.parse_args()
    fontes, saida = args.fontes.resolve(), args.saida.resolve()
    if (fontes / "VIGIAGUA_DF_Gestao_Coletas_2026.xlsx").exists():
        print("Aviso: a planilha de gestão está na pasta de fontes, mas não é lida por este script.")
    log: list[str] = []
    preservar_legado(fontes, saida, log)
    ra, tabela_rs = construir_territorios(fontes, saida, log)
    hidro = construir_hidrografia(fontes, saida, ra, log)
    indicadores = construir_monitoramento(fontes, saida, ra, tabela_rs, log)
    construir_catalogo(saida, indicadores, hidro, log)
    relatorio = saida / "docs" / "validacao_build.txt"
    relatorio.parent.mkdir(parents=True, exist_ok=True)
    relatorio.write_text(f"GeoVIGIÁGUA DF · build {indicadores['geradoEm']}\n" + "\n".join(log) + "\n", encoding="utf-8")
    print("\n".join(log))


if __name__ == "__main__":
    main()
