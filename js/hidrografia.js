// Hidrografia e Território: visualizador das camadas de Hidrografia Geral (SEGETH/SEDUH-DF).
import { carregarCamada, criarMapa, trocarBase, opcoesBase, estiloRio, estiloLago, popupHidro, CORES_RIOS, CORES_LAGOS, controleLegenda } from "./camadas.js";
import { carregarBase } from "./filtros.js";
import { tabelaHTML } from "./graficos.js";
import { $, esc, fmt, fmtDec, heading, notice, footer, carregarJSON, erroCarga } from "./util.js";

export function paginaHidrografia() {
  return `${heading("CAMADAS AMBIENTAIS · HIDROGRAFIA GERAL", 'Hidrografia <em>e território.</em>', "Cursos d'água e espelhos d'água do Distrito Federal, com consulta de atributos e síntese por Região Administrativa.")}
    <div class="webgis hidro">
      <aside class="webgis-panel" aria-label="Controles da hidrografia">
        <section><h2 class="panel-title">Camadas</h2><div class="layer-list" id="hidro-camadas">
          <label><input type="checkbox" data-camada="rios" checked> Cursos principais e nomeados</label>
          <label><input type="checkbox" data-camada="riosDemais"> Demais trechos de drenagem</label>
          <label><input type="checkbox" data-camada="lagos" checked> Lagos, lagoas e alagados</label>
          <label><input type="checkbox" data-camada="ra" checked> Limites das RAs</label>
        </div></section>
        <section><h2 class="panel-title">Filtro</h2><label class="stack-label">Regime<select id="hidro-perene"><option value="all">Perenes e sazonais</option><option value="SIM">Somente perenes</option><option value="NAO">Somente sazonais</option></select></label>
          <label class="stack-label">Transparência<input id="hidro-opacidade" type="range" min="0.2" max="1" step="0.1" value="1"></label></section>
        <section><h2 class="panel-title">Mapa-base</h2><label class="stack-label">Base cartográfica<select id="hidro-base">${opcoesBase("claro")}</select></label></section>
      </aside>
      <div class="webgis-map"><div id="hidro-mapa" class="full-map" role="region" aria-label="Mapa da hidrografia do DF"></div></div>
    </div>
    ${notice("<strong>Licença da fonte.</strong> Os metadados da SEGETH/SEDUH-DF informam uso próprio e vedam reprodução para terceiros. Por isso o portal exibe apenas uma versão simplificada para visualização, com atribuição, e <strong>não disponibiliza download</strong>. Confirme a autorização institucional antes de publicar.", "alerta")}
    <div class="section-heading"><div><span class="section-kicker">INVENTÁRIO</span><h2>Feições disponíveis na fonte</h2></div></div>
    <div class="inventory" id="hidro-inventario"></div>
    <div class="section-heading"><div><span class="section-kicker">CRUZAMENTO PREPARADO</span><h2>Contexto hidrográfico e monitoramento por RA</h2></div></div>
    <section class="card"><div class="table-scroll" id="hidro-cruzamento"><p class="loading">Carregando…</p></div><p class="muted small">Extensão de trechos e área de espelhos d'água recortadas pelos limites de cada RA (geometria integral, EPSG:31983). Indicadores de contexto: não indicam relação causal entre proximidade de corpos d'água e qualidade da água distribuída.</p></section>
    <p class="muted small">Bacias e sub-bacias hidrográficas não constam dos arquivos recebidos (pasta Hidrografia Geral contém apenas Rios e Córregos; Lagos e Barragens) e serão incluídas quando a camada for fornecida.</p>
    ${footer()}`;
}

export async function iniciarHidrografia(params) {
  try {
    const [catalogo, limites, porRA, base] = await Promise.all([carregarJSON("data/catalogo.json"), carregarCamada("ra"), carregarJSON("data/hidrografia_por_ra.json"), carregarBase()]);
    if (!$("#hidro-mapa")) return;
    const mapa = criarMapa("hidro-mapa", { base: "claro", rolagem: true });
    const legenda = controleLegenda(mapa);
    legenda.atualizar(`<strong>Hidrografia</strong>${Object.entries(CORES_RIOS).map(([t, c]) => `<span><i class="swatch-line" style="border-color:${c}"></i>${esc(t.charAt(0) + t.slice(1).toLowerCase())}</span>`).join("")}<span><i class="swatch-line dotted" style="border-color:#4FA3D9"></i>Sazonal (tracejado)</span>${Object.entries(CORES_LAGOS).filter(([t]) => t !== "RIO").map(([t, c]) => `<span><i style="background:${c}"></i>${esc(t.charAt(0) + t.slice(1).toLowerCase())}</span>`).join("")}<span><i style="background:#3D8FCC"></i>Rio (polígono)</span>`);
    const camadas = { ra: L.geoJSON(limites, { style: { color: "#123A5A", weight: 1, opacity: 0.6, fill: false }, onEachFeature: (f, l) => l.bindTooltip(esc(f.properties.nome), { sticky: true }) }) };
    mapa.extensaoDF = camadas.ra.getBounds();
    mapa.fitBounds(mapa.extensaoDF, { padding: [10, 10] });
    const dados = {};
    const versoes = {};
    const fabricar = (chave) => {
      const regime = $("#hidro-perene").value;
      const opacidade = +$("#hidro-opacidade").value;
      const estilo = chave === "lagos" ? estiloLago : estiloRio;
      return L.geoJSON(dados[chave], {
        filter: (f) => regime === "all" || f.properties.perene === regime,
        style: (f) => { const s = estilo(f); return { ...s, opacity: (s.opacity ?? 1) * opacidade, fillOpacity: (s.fillOpacity ?? 0) * opacidade }; },
        onEachFeature: (f, l) => l.bindPopup(popupHidro(f.properties)),
      });
    };
    const ligar = async (chave, ativo) => {
      if (camadas[chave] && chave !== "ra") { mapa.removeLayer(camadas[chave]); camadas[chave] = null; }
      if (chave === "ra") { if (ativo) camadas.ra.addTo(mapa); else mapa.removeLayer(camadas.ra); return; }
      if (!ativo) return;
      const versao = (versoes[chave] = (versoes[chave] ?? 0) + 1);
      const caixa = $(`#hidro-camadas [data-camada="${chave}"]`);
      caixa.parentElement.classList.add("loading-layer");
      try { dados[chave] ??= await carregarCamada(chave); } finally { caixa.parentElement.classList.remove("loading-layer"); }
      if (!caixa.checked || versoes[chave] !== versao) return;
      if (camadas[chave]) mapa.removeLayer(camadas[chave]);
      camadas[chave] = fabricar(chave).addTo(mapa);
    };
    const redesenhar = () => document.querySelectorAll("#hidro-camadas [data-camada]").forEach((c) => ligar(c.dataset.camada, c.checked));
    $("#hidro-camadas").addEventListener("change", (e) => ligar(e.target.dataset.camada, e.target.checked));
    $("#hidro-perene").addEventListener("change", redesenhar);
    $("#hidro-opacidade").addEventListener("change", redesenhar);
    $("#hidro-base").addEventListener("change", (e) => trocarBase(mapa, e.target.value));
    redesenhar();

    const itens = catalogo.itens.filter((i) => i.tema === "Hidrografia");
    $("#hidro-inventario").innerHTML = itens.map((i) => `<article class="card inventory-item"><span class="section-kicker">${esc(i.geometria)}</span><h3>${esc(i.nome)}</h3><p>${esc(i.descricao)}</p><dl class="meta-dl"><dt>Fonte</dt><dd>${esc(i.fonte)}</dd><dt>Referência</dt><dd>${esc(i.referencia)}</dd><dt>SRC</dt><dd>${esc(i.src)}</dd><dt>Acesso</dt><dd>${esc(i.acesso)} · sem download</dd></dl><a class="text-link" href="${esc(i.metadados)}" target="_blank" rel="noopener">Metadados <b>↗</b></a></article>`).join("");

    const geral = base.porRA({});
    const linhas = Object.entries(porRA.ras).map(([c, h]) => {
      const a = geral.get(+c);
      return [base.raNome[c], h.km_total, h.km_perene, h.espelhos, fmtDec(h.espelhos_ha), a.amostras, a.comResultado ? `${fmtDec((a.ctP / a.ctInf) * 100)}%` : "—"];
    }).sort((x, y) => x[0].localeCompare(y[0], "pt-BR"));
    $("#hidro-cruzamento").innerHTML = tabelaHTML(["Região Administrativa", "Drenagem (km)", "Perene (km)", "Espelhos d'água", "Área (ha)", "Amostras 2024–2026", "% CT presença"], linhas.map((l) => [l[0], fmtDec(l[1]), fmtDec(l[2]), fmt(l[3]), l[4], l[5], l[6]]));
  } catch (erro) {
    erroCarga($("#hidro-inventario"), erro);
  }
}
