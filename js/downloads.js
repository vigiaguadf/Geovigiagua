// Centro de Dados e Downloads: catálogo pesquisável alimentado por data/catalogo.json.
import { $, esc, heading, notice, footer, carregarJSON, erroCarga } from "./util.js";

const FORMATOS = { shp: "Baixar Shapefile ZIP", geojson: "Baixar GeoJSON", xlsx: "Baixar Excel", csv: "Baixar CSV", pdf: "Baixar PDF" };
const ROTULO_FORMATO = { shp: "Shapefile", geojson: "GeoJSON", xlsx: "Excel", csv: "CSV", pdf: "PDF" };

export function paginaDownloads() {
  return `${heading("CENTRO DE DADOS GEOESPACIAIS", 'Dados <em>e downloads.</em>', "Catálogo dos recursos inventariados no projeto, com metadados, origem, licença e restrições. Só aparecem botões para arquivos que existem e cuja publicação é permitida.")}
    <div class="catalog-tools"><label class="search-box"><span aria-hidden="true">⌕</span><input id="cat-busca" type="search" placeholder="Buscar por nome, descrição ou fonte" autocomplete="off"></label>
      <div class="panel-filters compact" id="cat-filtros">
        <label>Tema<select data-f="tema"></select></label><label>Ano<select data-f="ano"></select></label><label>Formato<select data-f="formato"></select></label><label>Fonte<select data-f="fonte"></select></label><label>Acesso<select data-f="acesso"></select></label>
      </div></div>
    <p class="recorte" id="cat-contagem"></p>
    <div class="catalog" id="catalogo"><p class="loading">Carregando catálogo…</p></div>
    ${notice("Os arquivos de monitoramento são agregados por RA, mês e motivo, sem endereços, coordenadas ou códigos de amostra. A planilha operacional de gestão de coletas é restrita e não é disponibilizada. Sem relatório PDF autorizado nesta versão, não há botão de PDF.")}
    ${footer()}`;
}

const fonteCurta = (fonte) => (/SEGETH|SEDUH/.test(fonte) && !/GeoVIGI/.test(fonte) ? "SEGETH/SEDUH-DF" : /GVAFNB/.test(fonte) ? "GVAFNB/SES-DF" : /GeoVIGI/.test(fonte) ? "GeoVIGIÁGUA DF" : "Arquivos do projeto");

export async function iniciarDownloads(params) {
  try {
    const catalogo = await carregarJSON("data/catalogo.json");
    if (!$("#catalogo")) return;
    const itens = catalogo.itens.map((i) => ({ ...i, fonteCurta: fonteCurta(i.fonte) }));
    const valores = {
      tema: [...new Set(itens.map((i) => i.tema))].sort(),
      ano: [...new Set(itens.flatMap((i) => i.anos))].sort().map(String),
      formato: Object.keys(ROTULO_FORMATO).filter((f) => itens.some((i) => i.formatos[f])),
      fonte: [...new Set(itens.map((i) => i.fonteCurta))].sort(),
      acesso: [...new Set(itens.map((i) => i.acesso))].sort(),
    };
    document.querySelectorAll("#cat-filtros select").forEach((s) => {
      const campo = s.dataset.f;
      s.replaceChildren(new Option("Todos", "all"), ...valores[campo].map((v) => new Option(campo === "formato" ? ROTULO_FORMATO[v] : v, v)));
      if (params[campo]) s.value = params[campo];
    });
    if (params.busca) $("#cat-busca").value = params.busca;
    const pintar = () => {
      const q = $("#cat-busca").value.trim().toLocaleLowerCase("pt-BR");
      const f = Object.fromEntries([...document.querySelectorAll("#cat-filtros select")].map((s) => [s.dataset.f, s.value]));
      const visiveis = itens.filter((i) =>
        (!q || `${i.nome} ${i.descricao} ${i.fonte} ${i.tema}`.toLocaleLowerCase("pt-BR").includes(q))
        && (f.tema === "all" || i.tema === f.tema) && (f.ano === "all" || i.anos.includes(+f.ano))
        && (f.formato === "all" || i.formatos[f.formato]) && (f.fonte === "all" || i.fonteCurta === f.fonte) && (f.acesso === "all" || i.acesso === f.acesso));
      $("#cat-contagem").innerHTML = `<b>${visiveis.length}</b> de ${itens.length} recursos · catálogo v${esc(catalogo.versao)}`;
      $("#catalogo").innerHTML = visiveis.length ? visiveis.map(cartao).join("") : '<p class="empty-inline">Nenhum recurso atende aos filtros.</p>';
    };
    $("#cat-busca").addEventListener("input", pintar);
    $("#cat-filtros").addEventListener("change", pintar);
    pintar();
  } catch (erro) {
    erroCarga($("#catalogo"), erro);
  }
}

function cartao(i) {
  const tag = i.acesso === "Público" ? "tag-publico" : i.acesso === "Restrito" ? "tag-restrito" : "tag-visual";
  const botoes = [
    i.camada ? `<a class="btn btn-secondary" href="#${i.camada === "monitoramento" ? `mapa-interativo?ano=${i.anos[0] ?? ""}` : `mapa-interativo?camada=${i.camada === "ra" ? "" : i.camada}`}">Visualizar no mapa</a>` : "",
    ...Object.entries(FORMATOS).filter(([f]) => i.formatos[f]).map(([f, rotulo]) => `<a class="btn" href="${encodeURI(i.formatos[f].href)}" download>${rotulo} <small>${esc(i.formatos[f].tamanho)}</small></a>`),
    `<a class="btn btn-ghost" href="${esc(i.metadados)}" target="_blank" rel="noopener">Metadados</a>`,
  ].join("");
  const meta = [["Fonte", i.fonte], ["Referência temporal", i.referencia], ["Escala/resolução", i.escala], ["SRC", i.src], ["Geometria", i.geometria], ["Atualização", i.atualizacao], ["Licença", i.licenca], ["Restrições", i.restricoes]];
  return `<article class="catalog-item" id="recurso-${esc(i.id)}"><header><div><span class="section-kicker">${esc(i.tema.toUpperCase())}</span><h2>${esc(i.nome)}</h2></div><span class="tag ${tag}">${esc(i.acesso.toUpperCase())}</span></header><p>${esc(i.descricao)}</p><details><summary>Metadados resumidos</summary><dl class="meta-dl">${meta.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl></details><div class="catalog-actions">${botoes}</div></article>`;
}
