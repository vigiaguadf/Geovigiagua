// Gráficos Chart.js padronizados (marcas finas, eixo único, legenda + tabela acessível).
import { CATEGORICAS } from "./camadas.js";
import { esc, fmt, MESES_CURTOS } from "./util.js";

export const COR_PRESENCA = "#C4553A";
export const COR_AUSENCIA = "#159A75";
export const COR_NI = "#C9D3D8";
const GRADE = "#E4ECEF";

const ativos = new Map();

function base() {
  if (!window.Chart) return false;
  Chart.defaults.font.family = '"Inter", "Segoe UI", sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.transitions.resize.animation.duration = 0;
  Chart.defaults.animation.duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 250;
  Chart.defaults.color = "#4F6672";
  Chart.defaults.plugins.tooltip.backgroundColor = "#123A5A";
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.callbacks.label = (ctx) => `${ctx.dataset.label ? `${ctx.dataset.label}: ` : ""}${fmt(ctx.parsed[ctx.chart.options.indexAxis === "y" ? "x" : "y"])}`;
  return true;
}

/** Cria (ou recria) um gráfico no canvas indicado e preenche a tabela acessível ao lado. */
export function grafico(id, config, tabela) {
  const canvas = document.getElementById(id);
  if (!canvas || !base()) return null;
  ativos.get(id)?.destroy();
  const chart = new Chart(canvas, config);
  ativos.set(id, chart);
  const alvo = document.getElementById(`${id}-tabela`);
  if (alvo && tabela) alvo.innerHTML = tabelaHTML(tabela.cabecalho, tabela.linhas);
  return chart;
}

export function destruirGraficos() {
  ativos.forEach((c) => c.destroy());
  ativos.clear();
}

export function tabelaHTML(cabecalho, linhas) {
  return `<table class="data-table"><thead><tr>${cabecalho.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>${linhas.map((l) => `<tr>${l.map((v, i) => (i === 0 ? `<th scope="row">${esc(v)}</th>` : `<td>${typeof v === "number" ? fmt(v) : esc(v)}</td>`)).join("")}</tr>`).join("")}</tbody></table>`;
}

/** Cartão de gráfico com título, canvas e tabela recolhível. */
export function cartaoGrafico(id, kicker, titulo, { largo = false, altura = 230, nota = "" } = {}) {
  return `<article class="chart-card${largo ? " chart-wide" : ""}"><div class="chart-heading"><span class="section-kicker">${kicker}</span><h2>${titulo}</h2></div><div class="chart-wrap" style="height:${altura}px"><canvas id="${id}" role="img" aria-label="${esc(titulo)}"></canvas></div>${nota ? `<p class="chart-note">${nota}</p>` : ""}<details class="table-toggle"><summary>Ver dados em tabela</summary><div id="${id}-tabela"></div></details></article>`;
}

const eixos = (empilhado = false, horizontal = false) => {
  const valor = { stacked: empilhado, beginAtZero: true, ticks: { precision: 0 }, grid: { color: GRADE }, border: { display: false } };
  const categoria = { stacked: empilhado, grid: { display: false }, border: { color: "#B9C8CF" } };
  return horizontal ? { x: valor, y: categoria } : { x: categoria, y: valor };
};

/** Série mensal: uma linha por ano. */
export function serieMensal(id, porAnoMes, anos, mesesAtivos) {
  // Meses sem nenhuma coleta no ano (fora do período do mapeamento) ficam vazios, não zero.
  const datasets = anos.map((ano, i) => ({
    label: String(ano), data: MESES_CURTOS.map((_, m) => porAnoMes.get(`${ano}-${m + 1}`) ?? (!mesesAtivos || mesesAtivos.has(`${ano}-${m + 1}`) ? 0 : null)),
    borderColor: CATEGORICAS[i], backgroundColor: CATEGORICAS[i], borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0, spanGaps: false,
  }));
  return grafico(id, {
    type: "line", data: { labels: MESES_CURTOS, datasets },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { display: anos.length > 1, position: "bottom", labels: { boxWidth: 12, boxHeight: 3 } } }, scales: eixos() },
  }, { cabecalho: ["Mês", ...anos.map(String)], linhas: MESES_CURTOS.map((m, i) => [m, ...datasets.map((d) => d.data[i] ?? "sem coleta")]) });
}

/** Barras simples (uma série). */
export function barras(id, rotulos, valores, { rotulo = "Amostras", cor = CATEGORICAS[0], horizontal = false, cores } = {}) {
  return grafico(id, {
    type: "bar", data: { labels: rotulos, datasets: [{ label: rotulo, data: valores, backgroundColor: cores ?? cor, borderRadius: 4, borderSkipped: "start", maxBarThickness: 28 }] },
    options: { indexAxis: horizontal ? "y" : "x", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: eixos(false, horizontal) },
  }, { cabecalho: ["Categoria", rotulo], linhas: rotulos.map((r, i) => [r, valores[i]]) });
}

/** Barras empilhadas de resultado microbiológico (presença / ausência / não informado). */
export function resultadosMicro(id, agregado) {
  const rotulos = ["Coliformes totais", "Escherichia coli"];
  const presenca = [agregado.ctP, agregado.ecP];
  const ausencia = [agregado.ctInf - agregado.ctP, agregado.ecInf - agregado.ecP];
  const ni = [agregado.amostras - agregado.ctInf, agregado.amostras - agregado.ecInf];
  const ds = (label, data, cor) => ({ label, data, backgroundColor: cor, borderColor: "#fff", borderWidth: { right: 2 }, borderSkipped: false, maxBarThickness: 34 });
  return grafico(id, {
    type: "bar", data: { labels: rotulos, datasets: [ds("Presença", presenca, COR_PRESENCA), ds("Ausência", ausencia, COR_AUSENCIA), ds("Não informado", ni, COR_NI)] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } }, scales: eixos(true, true) },
  }, { cabecalho: ["Parâmetro", "Presença", "Ausência", "Não informado"], linhas: rotulos.map((r, i) => [r, presenca[i], ausencia[i], ni[i]]) });
}

/** Rosca para composição (motivos). Categorias além de 6 viram "Outros". */
export function composicao(id, pares) {
  const ordenados = [...pares].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const principais = ordenados.slice(0, 6);
  const resto = ordenados.slice(6).reduce((s, [, v]) => s + v, 0);
  if (resto) principais.push(["Demais motivos", resto]);
  return grafico(id, {
    type: "doughnut", data: { labels: principais.map(([r]) => r), datasets: [{ data: principais.map(([, v]) => v), backgroundColor: CATEGORICAS.slice(0, principais.length), borderColor: "#fff", borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "right", labels: { boxWidth: 12, padding: 10 } }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmt(ctx.parsed)}` } } } },
  }, { cabecalho: ["Motivo", "Amostras"], linhas: ordenados });
}
