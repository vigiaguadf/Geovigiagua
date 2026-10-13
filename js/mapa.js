// Mapa Interativo (WebGIS): camadas territoriais, temáticas e ambientais com ficha territorial.
import { carregarBase, montarFiltros, descreverRecorte } from "./filtros.js";
import { carregarCamada, criarMapa, trocarBase, opcoesBase, simbologia, INDICADORES, legendaHTML, controleLegenda, COR_SEM_DADOS, CORES_RS, estiloRio, estiloLago, popupHidro } from "./camadas.js";
import { $, esc, fmt, fmtDec, pct, heading, notice, footer, statusDados, erroCarga, carregarJSON } from "./util.js";

const CAMADAS = [
  ["limite", "Limite do DF", true],
  ["ra", "Regiões Administrativas (tema)", true],
  ["rs", "Regiões de Saúde", false],
  ["macro", "Macrorregiões de Saúde", false],
  ["rios", "Cursos d'água principais e nomeados", false],
  ["riosDemais", "Demais trechos de drenagem", false],
  ["lagos", "Lagos, lagoas e alagados", false],
];

export function paginaMapa() {
  return `${heading("WEBGIS · DISTRITO FEDERAL", 'Mapa <em>interativo.</em>', "Explore indicadores por Região Administrativa, limites de saúde e hidrografia. Selecione uma RA para abrir a ficha territorial.")}
    <div id="mapa-status"></div>
    <div class="webgis">
      <aside class="webgis-panel" aria-label="Controles do mapa">
        <section><h2 class="panel-title">Recorte</h2><div class="stack-filters" id="mapa-filtros"></div></section>
        <section><h2 class="panel-title">Tema das RAs</h2><label class="stack-label">Indicador<select id="mapa-indicador"><option value="nenhum">Sem tema (somente limites)</option>${Object.entries(INDICADORES).map(([k, v]) => `<option value="${k}"${k === "amostras" ? " selected" : ""}>${v.rotulo}</option>`).join("")}</select></label></section>
        <section><h2 class="panel-title">Camadas</h2><div class="layer-list" id="mapa-camadas">${CAMADAS.map(([k, r, on]) => `<label><input type="checkbox" data-camada="${k}"${on ? " checked" : ""}> ${r}</label>`).join("")}</div></section>
        <section><h2 class="panel-title">Mapa-base</h2><label class="stack-label">Base cartográfica<select id="mapa-base">${opcoesBase("claro")}</select></label></section>
      </aside>
      <div class="webgis-map"><div id="mapa-principal" class="full-map" role="region" aria-label="Mapa interativo do Distrito Federal"></div></div>
      <aside class="ficha" id="mapa-ficha" aria-live="polite"><span class="section-kicker">FICHA TERRITORIAL</span><h2>Selecione uma RA</h2><p class="muted">Clique em um polígono no mapa ou escolha uma Região Administrativa no filtro.</p></aside>
    </div>
    ${notice("Mapa de calor não é exibido: a base pública é agregada por RA e não contém coordenadas de estabelecimentos. Comparações territoriais devem preferir percentuais; contagens refletem também o esforço de coleta em cada RA. Proximidade de corpos d'água não indica causalidade.")}
    ${footer()}`;
}

export async function iniciarMapa(params) {
  try {
    const [base, limites, limiteDF, rs, macro, hidroRA] = await Promise.all([
      carregarBase(), carregarCamada("ra"), carregarCamada("limite"), carregarCamada("rs"), carregarCamada("macro"), carregarJSON("data/hidrografia_por_ra.json"),
    ]);
    if (!$("#mapa-principal")) return;
    $("#mapa-status").innerHTML = statusDados(base.indicadores);
    const mapa = criarMapa("mapa-principal", { base: "claro", rolagem: true });
    const legenda = controleLegenda(mapa);
    mapa.createPane("hidro").style.zIndex = 420;
    mapa.createPane("limites").style.zIndex = 450;

    const camadas = {};
    camadas.ra = L.geoJSON(limites, { style: { color: "#fff", weight: 1, fillOpacity: 0.8, fillColor: COR_SEM_DADOS }, onEachFeature: (f, layer) => layer.on("click", () => filtros.definir("ra", String(f.properties.cira))) });
    camadas.limite = L.geoJSON(limiteDF, { pane: "limites", style: { color: "#123A5A", weight: 3, opacity: 0.9 }, interactive: false });
    camadas.rs = L.geoJSON(rs, { pane: "limites", style: (f) => ({ color: CORES_RS[f.properties.nome], weight: 2.5, dashArray: "6 4", fill: false }), onEachFeature: (f, layer) => layer.bindTooltip(`Região de Saúde ${esc(f.properties.nome)} · ${esc(f.properties.macrorregiao ?? "")}`, { sticky: true }) });
    camadas.macro = L.geoJSON(macro, { pane: "limites", style: { color: "#123A5A", weight: 1.5, dashArray: "2 5", fill: false }, onEachFeature: (f, layer) => layer.bindTooltip(esc(f.properties.nome), { sticky: true }) });
    const hidro = {
      rios: () => carregarCamada("rios").then((d) => L.geoJSON(d, { pane: "hidro", style: estiloRio, onEachFeature: (f, l) => l.bindPopup(popupHidro(f.properties)) })),
      riosDemais: () => carregarCamada("riosDemais").then((d) => L.geoJSON(d, { pane: "hidro", style: estiloRio, onEachFeature: (f, l) => l.bindPopup(popupHidro(f.properties)) })),
      lagos: () => carregarCamada("lagos").then((d) => L.geoJSON(d, { pane: "hidro", style: estiloLago, onEachFeature: (f, l) => l.bindPopup(popupHidro(f.properties)) })),
    };
    mapa.extensaoDF = camadas.ra.getBounds();
    mapa.fitBounds(mapa.extensaoDF, { padding: [16, 16] });

    const ligar = async (chave, ativo) => {
      if (!camadas[chave] && hidro[chave] && ativo) {
        const caixa = $(`[data-camada="${chave}"]`);
        caixa.disabled = true;
        caixa.parentElement.classList.add("loading-layer");
        try { camadas[chave] = await hidro[chave](); } catch (e) { console.error(e); } finally { caixa.disabled = false; caixa.parentElement.classList.remove("loading-layer"); }
      }
      if (!camadas[chave]) return;
      if (ativo) camadas[chave].addTo(mapa); else mapa.removeLayer(camadas[chave]);
      atualizarLegenda();
    };
    const pedidas = new Set((params.camada ?? "").split(",").filter(Boolean));
    if (pedidas.size) $$camadas().forEach((c) => { if (pedidas.has(c.dataset.camada)) c.checked = true; });
    $("#mapa-camadas").addEventListener("change", (e) => ligar(e.target.dataset.camada, e.target.checked));
    $("#mapa-base").addEventListener("change", (e) => trocarBase(mapa, e.target.value));
    $("#mapa-indicador").addEventListener("change", () => atualizar(filtros.estado()));

    let simbAtual = null;
    let raAnterior = null;
    function atualizarLegenda() {
      const chave = $("#mapa-indicador").value;
      const extras = [];
      if (mapa.hasLayer(camadas.limite)) extras.push('<span><i class="swatch-line" style="border-color:#123A5A"></i>Limite do DF</span>');
      if (mapa.hasLayer(camadas.rs)) extras.push('<span><i class="swatch-line dashed" style="border-color:#0877A7"></i>Regiões de Saúde</span>');
      if (camadas.rios && mapa.hasLayer(camadas.rios)) extras.push('<span><i class="swatch-line" style="border-color:#2F7FC1"></i>Curso perene</span><span><i class="swatch-line dotted" style="border-color:#4FA3D9"></i>Curso sazonal</span>');
      if (camadas.lagos && mapa.hasLayer(camadas.lagos)) extras.push('<span><i style="background:#58A6DA"></i>Espelho d\'água</span>');
      const temaVisivel = chave !== "nenhum" && mapa.hasLayer(camadas.ra) && simbAtual;
      legenda.atualizar(temaVisivel ? legendaHTML(INDICADORES[chave].rotulo, simbAtual.itens, extras) : `<strong>Legenda</strong>${extras.join("") || "<span>Nenhuma camada temática</span>"}`);
    }

    function atualizar(f) {
      const chave = $("#mapa-indicador").value;
      const porRA = base.porRA(f);
      const membros = f.rs !== "all" ? new Set(base.rasDaRegiao(f.rs)) : null;
      simbAtual = chave === "nenhum" ? null : simbologia(chave, [...porRA].filter(([c]) => !membros || membros.has(c)).map(([, a]) => (a.amostras ? INDICADORES[chave].valor(a) : null)));
      camadas.ra.eachLayer((layer) => {
        const p = layer.feature.properties;
        const ag = porRA.get(p.cira);
        const fora = membros && !membros.has(p.cira);
        const valor = simbAtual && ag.amostras ? INDICADORES[chave].valor(ag) : null;
        const selecionada = String(p.cira) === f.ra;
        layer.setStyle({
          fillColor: !simbAtual ? "#DDF3EC" : fora ? "#F3F6F7" : simbAtual.cor(valor), fillOpacity: !simbAtual ? 0.25 : fora ? 0.35 : 0.8,
          color: selecionada ? "#123A5A" : simbAtual ? "#fff" : "#0877A7", weight: selecionada ? 3.5 : 1,
        });
        if (selecionada) layer.bringToFront();
        layer.bindTooltip(`<strong>${esc(p.nome)}</strong> · ${esc(p.codigo)}<br>Região de Saúde ${esc(p.regiao_saude)}${simbAtual ? `<br>${INDICADORES[chave].rotulo}: ${valor == null ? "sem dados" : simbAtual.formatar(valor)}` : ""}`, { sticky: true });
      });
      atualizarLegenda();
      if (f.ra !== "all") {
        if (raAnterior !== f.ra) camadas.ra.eachLayer((l) => { if (String(l.feature.properties.cira) === f.ra) mapa.fitBounds(l.getBounds(), { maxZoom: 13, padding: [30, 30] }); });
        ficha(+f.ra, porRA.get(+f.ra), f);
      } else {
        if (raAnterior) mapa.fitBounds(f.rs !== "all" ? L.featureGroup(camadas.ra.getLayers().filter((l) => membros.has(l.feature.properties.cira))).getBounds() : mapa.extensaoDF, { padding: [20, 20] });
        else if (f.rs !== "all") mapa.fitBounds(L.featureGroup(camadas.ra.getLayers().filter((l) => membros.has(l.feature.properties.cira))).getBounds(), { padding: [20, 20] });
        fichaVazia(f);
      }
      raAnterior = f.ra !== "all" ? f.ra : null;
    }

    function ficha(cira, ag, f) {
      const props = limites.features.find((x) => x.properties.cira === cira).properties;
      const h = hidroRA.ras[String(cira)];
      $("#mapa-ficha").innerHTML = `<span class="section-kicker">FICHA TERRITORIAL · ${esc(props.codigo)}</span><h2>${esc(props.nome)}</h2>
        <p class="muted">Região de Saúde <b>${esc(props.regiao_saude)}</b> · ${fmtDec(props.area_km2)} km²</p>
        <p class="recorte-mini">${esc(descreverRecorte(base, { ...f, ra: "all", rs: "all" }))}</p>
        <dl class="ficha-dl">
          <dt>Amostras</dt><dd>${fmt(ag.amostras)}</dd>
          <dt>Satisfatórias (microbiológico)</dt><dd>${ag.comResultado ? `${fmt(ag.satisfatorias)} <small>(${pct(ag.satisfatorias, ag.comResultado)})</small>` : "—"}</dd>
          <dt>Coliformes totais · presença</dt><dd>${ag.ctInf ? `${fmt(ag.ctP)} <small>(${pct(ag.ctP, ag.ctInf)})</small>` : "—"}</dd>
          <dt>E. coli · presença</dt><dd>${ag.ecInf ? `${fmt(ag.ecP)} <small>(${pct(ag.ecP, ag.ecInf)})</small>` : "—"}</dd>
          <dt>Estabelecimentos</dt><dd>${fmt(ag.estabelecimentos)}</dd>
          <dt>Drenagem (trechos)</dt><dd>${fmtDec(h.km_total)} km <small>(${fmtDec(h.km_perene)} km perenes)</small></dd>
          <dt>Espelhos d'água</dt><dd>${fmt(h.espelhos)} <small>(${fmtDec(h.espelhos_ha)} ha)</small></dd>
        </dl>
        ${ag.comResultado && ag.comResultado < 10 ? '<p class="caution">Base pequena (menos de 10 amostras com resultado): interpretar percentuais com cautela.</p>' : ""}
        <a class="text-link" href="#regioes-administrativas?ra=${cira}">Abrir análise da RA <b>→</b></a>`;
    }
    function fichaVazia(f) {
      const a = base.agregar(base.filtrar(f));
      $("#mapa-ficha").innerHTML = `<span class="section-kicker">FICHA TERRITORIAL</span><h2>${f.rs !== "all" ? `Região de Saúde ${esc(f.rs)}` : "Distrito Federal"}</h2><p class="recorte-mini">${esc(descreverRecorte(base, f))}</p>
        <dl class="ficha-dl"><dt>Amostras</dt><dd>${fmt(a.amostras)}</dd><dt>Satisfatórias (microbiológico)</dt><dd>${a.comResultado ? `${fmt(a.satisfatorias)} <small>(${pct(a.satisfatorias, a.comResultado)})</small>` : "—"}</dd><dt>Coliformes totais · presença</dt><dd>${a.ctInf ? fmt(a.ctP) : "—"}</dd><dt>Estabelecimentos</dt><dd>${fmt(base.estabelecimentos(f).n)}</dd></dl>
        <p class="muted">Clique em uma RA para ver a ficha territorial.</p>`;
    }

    const filtros = montarFiltros($("#mapa-filtros"), base, { campos: ["ano", "mes", "rs", "ra", "motivo", "resultado"], inicial: params, aoMudar: (f) => atualizar(f) });
    for (const [chave] of CAMADAS) { const caixa = $(`[data-camada="${chave}"]`); if (caixa.checked) await ligar(chave, true); }
    atualizar(filtros.estado());
  } catch (erro) {
    erroCarga($("#mapa-ficha"), erro);
  }
}

const $$camadas = () => [...document.querySelectorAll("#mapa-camadas [data-camada]")];
