// Mapas-base, camadas vetoriais e simbologia temática compartilhados pelos mapas do portal.
import { carregarJSON, esc, fmt, fmtDec } from "./util.js";

export const CENTRO_DF = [-15.79, -47.80];

export const BASES = {
  osm: { rotulo: "OpenStreetMap", url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", opcoes: { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores do OpenStreetMap</a>' } },
  claro: { rotulo: "Claro (Esri Light Gray)", url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", opcoes: { maxZoom: 19, maxNativeZoom: 16, attribution: 'Base &copy; Esri, HERE, Garmin, &copy; colaboradores do OpenStreetMap' } },
  topo: { rotulo: "Topográfico (OpenTopoMap)", url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", opcoes: { maxZoom: 17, attribution: 'Dados: &copy; OpenStreetMap, SRTM · Estilo: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' } },
  satelite: { rotulo: "Imagem de satélite (Esri)", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", opcoes: { maxZoom: 19, attribution: "Imagens &copy; Esri, Maxar, Earthstar Geographics" } },
};

export const ARQUIVOS = {
  limite: "data/limite_df.geojson",
  ra: "data/limites_ra.geojson",
  rs: "data/regioes_saude.geojson",
  macro: "data/macrorregioes_saude.geojson",
  rios: "data/hidrografia_rios_principais.geojson",
  riosDemais: "data/hidrografia_rios_demais.geojson",
  lagos: "data/hidrografia_lagos.geojson",
};

export const carregarCamada = (nome) => carregarJSON(ARQUIVOS[nome]);

// Paleta categórica validada (ordem fixa; CVD e visão normal conferidos com validador).
export const CATEGORICAS = ["#0877A7", "#D08A2E", "#159A75", "#7B5EA7", "#C4553A", "#5A9BD5", "#8A8F35"];
export const CORES_RS = { Central: CATEGORICAS[0], "Centro-Sul": CATEGORICAS[1], Leste: CATEGORICAS[2], Norte: CATEGORICAS[3], Oeste: CATEGORICAS[4], Sudoeste: CATEGORICAS[5], Sul: CATEGORICAS[6] };

let mapaAtivo = null;

/** Cria um mapa Leaflet padronizado. Remove o mapa anterior da página (um mapa principal por vez). */
export function criarMapa(elemento, { base = "osm", rolagem = false, unico = true, extensao } = {}) {
  if (unico && mapaAtivo) { mapaAtivo.remove(); mapaAtivo = null; }
  const mapa = L.map(elemento, { scrollWheelZoom: rolagem, zoomControl: false, attributionControl: true }).setView(CENTRO_DF, 9);
  mapa.camadaBase = L.tileLayer(BASES[base].url, BASES[base].opcoes).addTo(mapa);
  L.control.zoom({ position: "bottomright", zoomInTitle: "Aproximar", zoomOutTitle: "Afastar" }).addTo(mapa);
  L.control.scale({ imperial: false, position: "bottomleft" }).addTo(mapa);
  const Reset = L.Control.extend({
    options: { position: "bottomright" },
    onAdd: () => {
      const botao = L.DomUtil.create("button", "map-reset");
      botao.type = "button";
      botao.title = "Voltar à extensão do DF";
      botao.setAttribute("aria-label", "Voltar à extensão do Distrito Federal");
      botao.textContent = "DF";
      L.DomEvent.disableClickPropagation(botao);
      botao.addEventListener("click", () => mapa.fitBounds(mapa.extensaoDF ?? extensao ?? L.latLngBounds([-16.06, -48.29], [-15.49, -47.30]), { padding: [16, 16] }));
      return botao;
    },
  });
  new Reset().addTo(mapa);
  mapa.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  if (unico) mapaAtivo = mapa;
  requestAnimationFrame(() => mapa.invalidateSize());
  return mapa;
}

export function trocarBase(mapa, chave) {
  mapa.removeLayer(mapa.camadaBase);
  mapa.camadaBase = L.tileLayer(BASES[chave].url, BASES[chave].opcoes).addTo(mapa);
  mapa.camadaBase.bringToBack();
}

export function opcoesBase(selecionada = "osm") {
  return Object.entries(BASES).map(([k, b]) => `<option value="${k}"${k === selecionada ? " selected" : ""}>${b.rotulo}</option>`).join("");
}

// ------------------------------------------------------------------ simbologia temática

const SEQ_AZUL = ["#DDF3EC", "#9BD5CF", "#4DB3C2", "#0877A7", "#123A5A"];
const SEQ_ALERTA = ["#FBEFE6", "#F4C9A6", "#E49562", "#C4622E", "#8A3A12"];
export const COR_SEM_DADOS = "#E3E8EA";

export const INDICADORES = {
  amostras: { rotulo: "Amostras", curto: "amostras", tipo: "contagem", paleta: SEQ_AZUL, valor: (a) => a.amostras },
  satisfatorias: { rotulo: "Satisfatórias (critério microbiológico)", curto: "satisfatórias", tipo: "contagem", paleta: SEQ_AZUL, valor: (a) => (a.comResultado ? a.satisfatorias : null) },
  ctP: { rotulo: "Presença de coliformes totais", curto: "com presença de CT", tipo: "contagem", paleta: SEQ_ALERTA, valor: (a) => (a.ctInf ? a.ctP : null) },
  pctSat: { rotulo: "% satisfatórias (critério microbiológico)", curto: "% satisfatórias", tipo: "percentual", paleta: SEQ_AZUL, quebras: [80, 90, 95, 99], valor: (a) => (a.comResultado ? (a.satisfatorias / a.comResultado) * 100 : null), base: (a) => a.comResultado },
  pctCT: { rotulo: "% com presença de coliformes totais", curto: "% presença CT", tipo: "percentual", paleta: SEQ_ALERTA, quebras: [2, 5, 10, 20], valor: (a) => (a.ctInf ? (a.ctP / a.ctInf) * 100 : null), base: (a) => a.ctInf },
  estabelecimentos: { rotulo: "Estabelecimentos monitorados", curto: "estabelecimentos", tipo: "contagem", paleta: SEQ_AZUL, valor: (a) => (a.amostras ? a.estabelecimentos : null) },
};

/** Quebras por quantis (4 classes de valores positivos); zero tem classe própria. */
export function quebrasQuantis(valores) {
  const positivos = valores.filter((v) => v > 0).sort((a, b) => a - b);
  if (!positivos.length) return [];
  const q = (p) => positivos[Math.min(positivos.length - 1, Math.floor(p * positivos.length))];
  return [...new Set([q(0.25), q(0.5), q(0.75)])].filter((v) => v < positivos.at(-1));
}

/** Retorna a função de cor e os itens de legenda de um indicador. */
export function simbologia(chave, valores) {
  const ind = INDICADORES[chave];
  const pal = ind.paleta;
  const formatar = (v) => (ind.tipo === "percentual" ? `${fmtDec(v, v % 1 ? 1 : 0)}%` : fmt(Math.round(v)));
  if (ind.tipo === "percentual") {
    const q = ind.quebras;
    const cor = (v) => (v == null ? COR_SEM_DADOS : pal[q.findIndex((limite) => v < limite) === -1 ? 4 : q.findIndex((limite) => v < limite)]);
    const itens = [[pal[0], `< ${formatar(q[0])}`], ...q.slice(0, -1).map((limite, i) => [pal[i + 1], `${formatar(limite)} a < ${formatar(q[i + 1])}`]), [pal[4], `≥ ${formatar(q.at(-1))}`]];
    return { cor, itens, formatar };
  }
  const q = quebrasQuantis(valores);
  const cor = (v) => {
    if (v == null) return COR_SEM_DADOS;
    if (v === 0) return pal[0];
    const i = q.findIndex((limite) => v <= limite);
    return pal[i === -1 ? Math.min(4, q.length + 1) : i + 1];
  };
  const itens = [[pal[0], "Zero"]];
  let anterior = 1;
  q.forEach((limite, i) => { itens.push([pal[i + 1], anterior === limite ? formatar(limite) : `${formatar(anterior)} a ${formatar(limite)}`]); anterior = Math.floor(limite) + 1; });
  const maximo = Math.max(0, ...valores.filter((v) => v != null));
  if (maximo > 0) itens.push([pal[Math.min(4, q.length + 1)], anterior >= maximo ? formatar(maximo) : `${formatar(anterior)} a ${formatar(maximo)}`]);
  return { cor, itens, formatar };
}

export function legendaHTML(titulo, itens, extras = []) {
  return `<strong>${esc(titulo)}</strong>${itens.map(([cor, rotulo]) => `<span><i style="background:${cor}"></i>${esc(rotulo)}</span>`).join("")}<span><i class="swatch-sem-dados"></i>Sem dados no recorte</span>${extras.join("")}`;
}

/** Controle Leaflet de legenda atualizável. */
export function controleLegenda(mapa, posicao = "topright") {
  const Legenda = L.Control.extend({
    options: { position: posicao },
    onAdd: () => { const div = L.DomUtil.create("div", "map-legend"); L.DomEvent.disableScrollPropagation(div); return div; },
  });
  const controle = new Legenda().addTo(mapa);
  return { atualizar: (html) => { controle.getContainer().innerHTML = html; }, controle };
}

// ------------------------------------------------------------------ hidrografia

export const CORES_RIOS = { "RIO": "#2F7FC1", "CÓRREGO": "#4FA3D9", "CANAL": "#7E8FCB", "SANGRADOURO": "#8FB8D8", "CONEXÃO": "#A6C8DE" };
export const CORES_LAGOS = { "LAGO": "#1F6FB2", "LAGOA": "#58A6DA", "ALAGADO": "#8CC7C2", "RIO": "#3D8FCC" };

export function estiloRio(feature) {
  const p = feature.properties;
  return { color: CORES_RIOS[p.tipo] ?? "#4FA3D9", weight: p.perene === "SIM" ? (p.tipo === "RIO" ? 2.2 : 1.6) : 0.9, opacity: p.perene === "SIM" ? 0.95 : 0.7, dashArray: p.perene === "SIM" ? null : "3 3" };
}

export function estiloLago(feature) {
  const p = feature.properties;
  return { color: "#1F6FB2", weight: 0.6, fillColor: CORES_LAGOS[p.tipo] ?? "#58A6DA", fillOpacity: p.perene === "SIM" ? 0.75 : 0.45 };
}

export function popupHidro(p) {
  const linhas = [
    ["Nome", p.descricao || "Sem nome na fonte"], ["Tipo", p.tipo], ["Perene", p.perene === "SIM" ? "Sim" : "Não (sazonal)"],
    p.extensao_km != null ? ["Extensão (grupo de trechos)", `${fmtDec(p.extensao_km, 2)} km`] : null,
    p.area_ha != null ? ["Área", `${fmtDec(p.area_ha, 2)} ha`] : null,
  ].filter(Boolean);
  return `<dl class="popup-dl">${linhas.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl><small class="popup-source">Fonte: SEGETH/SEDUH-DF (geometria simplificada para a web)</small>`;
}
