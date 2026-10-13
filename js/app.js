// GeoVIGIÁGUA DF · Portal Integrado 2.0 — navegação e roteamento por hash (rotas da versão 1.x preservadas).
import { $, footer } from "./util.js";
import { destruirGraficos } from "./graficos.js";
import { paginaPainel, iniciarPainel } from "./painel.js";
import { paginaMapa, iniciarMapa } from "./mapa.js";
import { paginaRA, iniciarRA, paginaRS, iniciarRS } from "./territorios.js";
import { paginaHidrografia, iniciarHidrografia } from "./hidrografia.js";
import { paginaDownloads, iniciarDownloads } from "./downloads.js";
import { paginaInicio, iniciarInicio, paginaRelatorios, iniciarRelatorios, paginaMetodologia, iniciarMetodologia, paginaSobre, paginaRestrita } from "./paginas.js";

const MODULOS = [
  ["inicio", "Início", "⌂", paginaInicio, iniciarInicio],
  ["painel-publico", "Painel Público", "▦", paginaPainel, iniciarPainel],
  ["mapa-interativo", "Mapa Interativo", "⌖", paginaMapa, iniciarMapa],
  ["regioes-administrativas", "Regiões Administrativas", "▤", paginaRA, iniciarRA],
  ["regioes-saude", "Regiões de Saúde", "◉", paginaRS, iniciarRS],
  ["hidrografia", "Hidrografia e Território", "≈", paginaHidrografia, iniciarHidrografia],
  ["dados-downloads", "Dados e Downloads", "⇩", paginaDownloads, iniciarDownloads],
  ["relatorios", "Relatórios e Boletins", "▧", paginaRelatorios, iniciarRelatorios],
  ["metodologia", "Metodologia", "≋", paginaMetodologia, iniciarMetodologia],
  ["sobre", "Sobre o Projeto", "＋", paginaSobre, null],
  ["painel-institucional", "Painel Institucional", "▣", () => paginaRestrita("painel-institucional"), null, true],
  ["administracao-dados", "Administração de Dados", "⚙", () => paginaRestrita("administracao-dados"), null, true],
];

function rota() {
  const [id, consulta = ""] = location.hash.slice(1).split("?");
  return { id: decodeURIComponent(id || "inicio"), params: Object.fromEntries(new URLSearchParams(consulta)) };
}

function link([id, titulo, icone, , , restrito]) {
  return `<a class="nav-link" href="#${id}" data-route="${id}"><span class="nav-icon" aria-hidden="true">${icone}</span><span>${titulo}</span>${restrito ? '<span class="nav-lock" aria-label="acesso restrito">●</span>' : ""}</a>`;
}

function render() {
  let { id, params } = rota();
  let modulo = MODULOS.find(([r]) => r === id);
  if (!modulo) { id = "inicio"; history.replaceState(null, "", "#inicio"); modulo = MODULOS[0]; params = {}; }
  const [, titulo, , pagina, iniciar] = modulo;
  fecharMenu();
  destruirGraficos();
  $("#current-module").textContent = titulo.toLocaleUpperCase("pt-BR");
  document.title = `GeoVIGIÁGUA DF | ${titulo}`;
  document.querySelectorAll(".nav-link").forEach((a) => { const ativo = a.dataset.route === id; a.classList.toggle("active", ativo); if (ativo) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  const view = $("#app-view");
  view.innerHTML = pagina() ?? footer();
  view.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
  iniciar?.(params);
}

function fecharMenu() {
  $("#sidebar").classList.remove("open");
  $("#mobile-scrim").hidden = true;
  $("#menu-toggle").setAttribute("aria-expanded", "false");
  $("#menu-toggle").setAttribute("aria-label", "Abrir navegação");
}

function fecharModal() { $("#modal").hidden = true; }

function iniciar() {
  $("#main-nav").innerHTML = MODULOS.filter((m) => !m[5]).map(link).join("");
  $("#restricted-nav").innerHTML = MODULOS.filter((m) => m[5]).map(link).join("");
  $("#menu-toggle").addEventListener("click", () => {
    const aberto = $("#sidebar").classList.toggle("open");
    $("#mobile-scrim").hidden = !aberto;
    $("#menu-toggle").setAttribute("aria-expanded", String(aberto));
    $("#menu-toggle").setAttribute("aria-label", aberto ? "Fechar navegação" : "Abrir navegação");
  });
  $("#mobile-scrim").addEventListener("click", fecharMenu);
  $("#modal-close").addEventListener("click", fecharModal);
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") fecharModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { fecharModal(); fecharMenu(); } });
  window.addEventListener("hashchange", render);
  render();
}

iniciar();
