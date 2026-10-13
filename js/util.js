// Utilitários compartilhados pelos módulos do portal.
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
export const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export const fmt = (n) => (n ?? 0).toLocaleString("pt-BR");
export const fmtDec = (n, casas = 1) => (n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** Percentual com uma casa; "—" quando o denominador é zero. */
export function pct(parte, total) {
  if (!total) return "—";
  return `${fmtDec((parte / total) * 100)}%`;
}

const cache = new Map();
/** fetch com cache em memória; rejeita com mensagem legível. */
export function carregarJSON(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Falha ao carregar ${url} (${r.status})`);
      return r.json();
    }).catch((erro) => { cache.delete(url); throw erro; }));
  }
  return cache.get(url);
}

export function heading(kicker, title, description, aside = "") {
  return `<div class="page-heading"><div><div class="eyebrow"><i></i>${kicker}</div><h1>${title}</h1><p>${description}</p></div>${aside}</div>`;
}

export function notice(html, tipo = "info") {
  return `<div class="notice notice-${tipo}" role="note"><span aria-hidden="true">${tipo === "alerta" ? "!" : "i"}</span><p>${html}</p></div>`;
}

export function footer() {
  return `<footer class="page-footer"><span>GeoVIGIÁGUA DF · Portal Integrado 2.0</span><span>GVAFNB / DIVAL / SVS / SES-DF</span><a href="#metodologia">Metodologia e critérios de publicação</a></footer>`;
}

export function statusDados(indicadores) {
  const data = indicadores?.geradoEm ? new Date(indicadores.geradoEm).toLocaleDateString("pt-BR") : "—";
  return `<div class="data-status"><span class="tag tag-preliminar">DADOS REAIS PRELIMINARES</span><span>Base gerada em ${data} a partir dos mapeamentos 2024–2026 · pendente de validação institucional</span></div>`;
}

export function opcoes(select, valores, rotuloTodos) {
  const atual = select.value;
  select.replaceChildren(new Option(rotuloTodos, "all"));
  valores.forEach(([valor, rotulo]) => select.add(new Option(rotulo, valor)));
  if ([...select.options].some((o) => o.value === atual)) select.value = atual;
}

export function erroCarga(container, erro) {
  console.error(erro);
  if (container) container.innerHTML = `<p class="load-error">Não foi possível carregar os dados. Abra o portal por um servidor HTTP (não por file://). <small>${esc(erro.message)}</small></p>`;
}
