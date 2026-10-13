# GeoVIGIÁGUA DF · Portal Integrado 2.0

Plataforma pública de inteligência territorial aplicada à vigilância da qualidade da água para consumo humano no Distrito Federal (GVAFNB/DIVAL/SVS/SES-DF). Site estático pronto para GitHub Pages.

## Publicar no GitHub Pages

1. Crie (ou use) o repositório e copie para a raiz **todo o conteúdo desta pasta** (inclusive `.nojekyll` e `.gitignore`).
2. Faça commit e push para a branch `main`.
3. Em *Settings → Pages*, escolha *Deploy from a branch*, branch `main`, pasta `/ (root)`.
4. Acesse `https://<usuario>.github.io/<repositorio>/`.

Antes de publicar, confirme com a GVAFNB a autorização dos dados agregados e da visualização da hidrografia (ver “Pendências”).

## Executar localmente

Os dados são carregados com `fetch`, então `file://` não funciona. Na pasta do site:

```bash
python -m http.server 8000
# abra http://localhost:8000
```

Leaflet 1.9.4 e Chart.js 4.4.7 estão em `vendor/` (sem dependência de CDN). Os mapas-base (OpenStreetMap, CARTO, OpenTopoMap, Esri) e a fonte Inter vêm da internet; respeite as atribuições exibidas no mapa.

## Rotas (preservadas da versão 1.x)

`#inicio`, `#painel-publico`, `#mapa-interativo`, `#regioes-administrativas`, `#regioes-saude`, `#hidrografia`, `#dados-downloads`, `#relatorios`, `#metodologia`, `#sobre`, `#painel-institucional`, `#administracao-dados`.
Aceitam parâmetros, por exemplo `#painel-publico?ano=2026&rs=Norte`, `#mapa-interativo?ra=9`, `#mapa-interativo?camada=rios,lagos`.
Também existem atalhos `painel.html`, `mapa.html`, `regioes-administrativas.html`, `regioes-saude.html`, `hidrografia.html`, `dados.html`, `relatorios.html`, `metodologia.html` e `sobre.html`, que redirecionam para as rotas.

## Estrutura

```text
index.html                 shell do portal
css/style.css              identidade visual (paleta do Prompt Mestre, Inter)
js/app.js                  navegação e rotas
js/filtros.js              modelo de dados e filtros encadeados (Região de Saúde → RA)
js/painel.js               Painel Público
js/mapa.js                 WebGIS
js/camadas.js              mapas-base, camadas e simbologia coroplética
js/territorios.js          Regiões Administrativas e Regiões de Saúde
js/hidrografia.js          Hidrografia e Território
js/downloads.js            catálogo de dados
js/paginas.js              Início, Relatórios, Metodologia, Sobre, módulos restritos
js/graficos.js, js/util.js utilitários
data/indicadores.json      base pública agregada (cubo ano × mês × RA × motivo × resultado)
data/regioes_saude.json    tabela RA–Região de Saúde versionada
data/catalogo.json         catálogo com metadados
data/relatorios.json       biblioteca de publicações (vazia até haver PDF autorizado)
data/*.geojson             camadas web (EPSG:4326, simplificadas)
downloads/                 Shapefile ZIP, GeoJSON, CSV e Excel autorizados
docs/metadados/            metadados JSON de cada recurso
docs/validacao_build.txt   relatório de validação da última geração
scripts/build_public_data.py  geração reprodutível dos dados
Saúde/, regioes_administrativas.zip, Limite do DF.zip   URLs legadas da versão 1.x
```

## Atualizar os dados

Os arquivos brutos **não** entram no repositório (estão no `.gitignore`). Mantenha-os numa pasta de fontes separada com: `Mapeamento_Agua_2024.xlsx`, `Mapeamento_Agua_2025.xlsx`, `Mapeamento_Agua_2026.xlsx`, `regioes_administrativas.zip`, `Limite do DF.zip`, `Hidrografia Geral/` e `Saúde/` (pastas extraídas dos .rar).

```bash
pip install pandas openpyxl geopandas shapely pyogrio pyproj
python scripts/build_public_data.py --fontes ../fontes --saida .
```

O script valida SRC e geometrias, reprojeta para EPSG:4326, simplifica com controle topológico, atribui cada amostra à RA por interseção espacial (com fallback para a RA informada), remove endereços, coordenadas, códigos de amostra e equipes, agrega e regenera catálogo, metadados e downloads. Revise `docs/validacao_build.txt` e registre a versão no `CHANGELOG.md`.
A planilha `VIGIAGUA_DF_Gestao_Coletas_2026.xlsx` é restrita e não é lida pelo script nem pelo portal.

## Pendências para validação institucional

- **Indicadores**: dados reais, porém preliminares. “Satisfatória” = ausência de coliformes totais e de *E. coli* (critério microbiológico), não conformidade integral.
- **2025**: a planilha não traz resultados microbiológicos; só contagens de amostras.
- **RA–Região de Saúde**: tabela compatível com o Plano Distrital de Saúde 2024–2027 (Lago Norte e Varjão na Região Central), confirmada pela equipe em 13/10/2026. A coluna Regiao_Saude do Mapeamento 2026 tem lançamentos inconsistentes e não é usada.
- **Hidrografia**: os metadados SEGETH/SEDUH vedam reprodução para terceiros; o portal mostra apenas visualização simplificada, sem download. Bacias e sub-bacias não estão nos arquivos recebidos.
- **Autenticação**: o Painel Institucional e a Administração de Dados são apenas descritivos. GitHub Pages não protege dados.
