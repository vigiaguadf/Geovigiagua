// Módulos Regiões Administrativas e Regiões de Saúde.
import { carregarBase, montarFiltros, descreverRecorte } from "./filtros.js";
import { carregarCamada, criarMapa, CORES_RS, CATEGORICAS } from "./camadas.js";
import { cartaoGrafico, serieMensal, barras, composicao, resultadosMicro } from "./graficos.js";
import { $, esc, fmt, fmtDec, pct, heading, notice, footer, statusDados, erroCarga } from "./util.js";

const COLUNAS = [
  ["nome", "Região Administrativa"], ["rs", "Região de Saúde"], ["amostras", "Amostras"], ["satisfatorias", "Satisfatórias"],
  ["pctSat", "% satisf."], ["ctP", "CT presença"], ["pctCT", "% CT"], ["ecP", "E. coli presença"], ["estabelecimentos", "Estabelec."],
];

export function paginaRA() {
  return `${heading("ORGANIZAÇÃO TERRITORIAL · 35 RAs", 'Regiões <em>Administrativas.</em>', "Compare as 35 Regiões Administrativas e abra a análise de cada uma. Limites oficiais SEGETH/SEDUH-DF; associação das amostras por interseção espacial.")}
    <div id="ra-status"></div>
    <div class="panel-filters" id="ra-filtros"></div>
    <div class="ra-layout">
      <section class="card"><div class="card-head"><div><span class="section-kicker">QUADRO COMPARATIVO</span><h2>Indicadores por RA</h2></div><small class="muted">Clique no cabeçalho para ordenar; na linha para analisar.</small></div><div class="table-scroll"><table class="data-table sortable" id="ra-tabela"></table></div></section>
      <aside class="card ra-detail" id="ra-detalhe"><span class="section-kicker">ANÁLISE DA RA</span><h2>Selecione uma RA</h2><p class="muted">Escolha uma linha do quadro ou uma RA no filtro.</p></aside>
    </div>
    <section class="chart-grid" id="ra-graficos" hidden>
      ${cartaoGrafico("g-ra-mensal", "EVOLUÇÃO TEMPORAL", "Amostras por mês na RA", { largo: true, altura: 230 })}
      ${cartaoGrafico("g-ra-micro", "RESULTADOS MICROBIOLÓGICOS", "Coliformes totais e <em>E. coli</em> na RA", { altura: 170 })}
      ${cartaoGrafico("g-ra-motivos", "MOTIVO DA COLETA", "Motivos na RA", { altura: 210 })}
    </section>
    ${notice("Contagens absolutas refletem o esforço de coleta de cada RA e não devem ser usadas, sozinhas, para comparar risco entre territórios. Percentuais com menos de 10 amostras com resultado são sinalizados.")}
    ${footer()}`;
}

export async function iniciarRA(params) {
  try {
    const [base, limites] = await Promise.all([carregarBase(), carregarCamada("ra")]);
    if (!$("#ra-tabela")) return;
    $("#ra-status").innerHTML = statusDados(base.indicadores);
    let ordem = ["amostras", -1];
    let mapa;
    const atualizar = (f) => {
      const porRA = base.porRA(f);
      const linhas = [...porRA].map(([cira, a]) => ({
        cira, nome: base.raNome[cira], rs: base.raRegiao[cira], ...a,
        pctSat: a.comResultado ? (a.satisfatorias / a.comResultado) * 100 : null, pctCT: a.ctInf ? (a.ctP / a.ctInf) * 100 : null,
      })).filter((l) => f.rs === "all" || l.rs === f.rs);
      const [col, dir] = ordem;
      linhas.sort((x, y) => (typeof x[col] === "string" ? x[col].localeCompare(y[col], "pt-BR") : (x[col] ?? -1) - (y[col] ?? -1)) * dir);
      const cel = (l, c) => {
        if (c === "nome") return `<th scope="row">${esc(l.nome)}</th>`;
        if (c === "rs") return `<td>${esc(l.rs)}</td>`;
        if (c.startsWith("pct")) return `<td>${l[c] == null ? '<span class="nd">s/d</span>' : `${fmtDec(l[c])}%${l.comResultado < 10 ? '<sup title="Menos de 10 amostras com resultado">*</sup>' : ""}`}</td>`;
        if (["satisfatorias", "ctP", "ecP"].includes(c) && !l.comResultado) return `<td>${l.amostras ? '<span class="nd">s/r</span>' : '<span class="nd">s/d</span>'}</td>`;
        return `<td>${l.amostras || c === "estabelecimentos" ? fmt(l[c]) : '<span class="nd">s/d</span>'}</td>`;
      };
      $("#ra-tabela").innerHTML = `<thead><tr>${COLUNAS.map(([c, r]) => `<th scope="col"><button type="button" data-ordem="${c}" aria-sort="${col === c ? (dir > 0 ? "ascending" : "descending") : "none"}">${r}${col === c ? (dir > 0 ? " ▲" : " ▼") : ""}</button></th>`).join("")}</tr></thead><tbody>${linhas.map((l) => `<tr data-ra="${l.cira}" tabindex="0"${String(l.cira) === f.ra ? ' class="active"' : ""}>${COLUNAS.map(([c]) => cel(l, c)).join("")}</tr>`).join("")}</tbody>`;
      $("#ra-tabela").insertAdjacentHTML("beforeend", '<caption>s/d = sem dados no recorte · s/r = amostras sem resultado microbiológico · * base pequena (n &lt; 10)</caption>');
      if (f.ra !== "all") detalhe(+f.ra, f, porRA.get(+f.ra)); else { $("#ra-detalhe").innerHTML = '<span class="section-kicker">ANÁLISE DA RA</span><h2>Selecione uma RA</h2><p class="muted">Escolha uma linha do quadro ou uma RA no filtro.</p>'; $("#ra-graficos").hidden = true; mapa = null; }
    };
    const detalhe = (cira, f, a) => {
      const p = limites.features.find((x) => x.properties.cira === cira).properties;
      $("#ra-detalhe").innerHTML = `<span class="section-kicker">ANÁLISE DA RA · ${esc(p.codigo)}</span><h2>${esc(p.nome)}</h2><p class="muted">Região de Saúde ${esc(p.regiao_saude)} · ${fmtDec(p.area_km2)} km²</p><div id="ra-mini-mapa" class="mini-map"></div>
        <dl class="ficha-dl"><dt>Amostras</dt><dd>${fmt(a.amostras)}</dd><dt>Satisfatórias</dt><dd>${a.comResultado ? `${fmt(a.satisfatorias)} (${pct(a.satisfatorias, a.comResultado)})` : "—"}</dd><dt>CT · presença</dt><dd>${a.ctInf ? `${fmt(a.ctP)} (${pct(a.ctP, a.ctInf)})` : "—"}</dd><dt>E. coli · presença</dt><dd>${a.ecInf ? `${fmt(a.ecP)} (${pct(a.ecP, a.ecInf)})` : "—"}</dd><dt>Estabelecimentos</dt><dd>${fmt(a.estabelecimentos)}</dd></dl>
        <a class="text-link" href="#mapa-interativo?ra=${cira}">Ver no mapa interativo <b>→</b></a>`;
      mapa = criarMapa("ra-mini-mapa", { base: "claro" });
      L.geoJSON(limites, { style: (ft) => (ft.properties.cira === cira ? { color: "#123A5A", weight: 2.5, fillColor: "#0877A7", fillOpacity: 0.45 } : { color: "#9CB3BD", weight: 0.6, fillOpacity: 0.05 }) }).addTo(mapa);
      mapa.extensaoDF = L.geoJSON(limites).getBounds();
      mapa.fitBounds(L.geoJSON(limites.features.find((x) => x.properties.cira === cira)).getBounds(), { padding: [12, 12], maxZoom: 12 });
      $("#ra-graficos").hidden = false;
      const linhas = base.filtrar({ ...f, rs: "all" });
      const porAnoMes = new Map();
      linhas.forEach((l) => { if (l.mes) porAnoMes.set(`${l.ano}-${l.mes}`, (porAnoMes.get(`${l.ano}-${l.mes}`) ?? 0) + l.n); });
      serieMensal("g-ra-mensal", porAnoMes, f.ano !== "all" ? [+f.ano] : base.anos, base.mesesAtivos);
      resultadosMicro("g-ra-micro", a);
      composicao("g-ra-motivos", [...base.agruparPor(linhas, "motivo")].map(([m, ag]) => [base.motivos[m], ag.amostras]));
    };
    const filtros = montarFiltros($("#ra-filtros"), base, { campos: ["ano", "mes", "rs", "ra", "motivo"], inicial: params, aoMudar: (f) => atualizar(f) });
    $("#ra-tabela").addEventListener("click", (e) => {
      const botao = e.target.closest("[data-ordem]");
      if (botao) { ordem = [botao.dataset.ordem, ordem[0] === botao.dataset.ordem ? -ordem[1] : (["nome", "rs"].includes(botao.dataset.ordem) ? 1 : -1)]; atualizar(filtros.estado()); return; }
      const linha = e.target.closest("[data-ra]");
      if (linha) filtros.definir("ra", linha.dataset.ra);
    });
    $("#ra-tabela").addEventListener("keydown", (e) => { const linha = e.target.closest("[data-ra]"); if (linha && e.key === "Enter") filtros.definir("ra", linha.dataset.ra); });
    atualizar(filtros.estado());
  } catch (erro) {
    erroCarga($("#ra-detalhe"), erro);
  }
}

// ------------------------------------------------------------------ Regiões de Saúde

export function paginaRS() {
  return `${heading("ORGANIZAÇÃO REGIONAL DA SAÚDE · 7 REGIÕES", 'Regiões de <em>Saúde.</em>', "Central, Centro-Sul, Leste, Norte, Oeste, Sudoeste e Sul: RAs integrantes, indicadores, distribuição mensal e evolução entre anos.")}
    <div id="rs-status"></div>
    <div class="panel-filters" id="rs-filtros"></div>
    <div class="rs-cards" id="rs-cards" role="tablist" aria-label="Regiões de Saúde"></div>
    <div class="region-page-grid">
      <section class="card map-card"><div id="rs-mapa" class="region-map" role="region" aria-label="Mapa das Regiões de Saúde"></div><p class="map-caption">Limites reconstituídos a partir das 35 RAs conforme a tabela de correspondência v2.0.</p></section>
      <aside class="card" id="rs-detalhe"></aside>
    </div>
    <section class="chart-grid">
      ${cartaoGrafico("g-rs-mensal", "DISTRIBUIÇÃO MENSAL", "Amostras por mês na Região", { largo: true, altura: 230 })}
      ${cartaoGrafico("g-rs-anual", "EVOLUÇÃO TEMPORAL", "Amostras por ano", { altura: 200 })}
      ${cartaoGrafico("g-rs-anual-pct", "EVOLUÇÃO TEMPORAL", "% satisfatórias por ano", { altura: 200, nota: "2025 sem resultados microbiológicos na fonte." })}
      ${cartaoGrafico("g-rs-ras", "RAS INTEGRANTES", "Amostras por RA da Região", { largo: true, altura: 240 })}
    </section>
    <section class="card"><div class="card-head"><div><span class="section-kicker">TABELA DE CORRESPONDÊNCIA · VERSÃO <span id="rs-versao"></span></span><h2>RA – Região de Saúde</h2></div><a class="text-link" href="data/dados_publicos/correspondencia_ra_regiao_saude.csv" download>Baixar CSV <b>↓</b></a></div><div class="table-scroll" id="rs-correspondencia"></div></section>
    ${footer()}`;
}

export async function iniciarRS(params) {
  try {
    const [base, rsGeo, limites] = await Promise.all([carregarBase(), carregarCamada("rs"), carregarCamada("ra")]);
    if (!$("#rs-cards")) return;
    $("#rs-status").innerHTML = statusDados(base.indicadores);
    const corr = base.correspondencia;
    $("#rs-versao").textContent = corr.versao;
    $("#rs-correspondencia").innerHTML = `<table class="data-table"><thead><tr><th scope="col">Região de Saúde</th><th scope="col">Macrorregião</th><th scope="col">RAs integrantes</th></tr></thead><tbody>${corr.regioes.map((r) => `<tr><th scope="row"><i class="dot" style="background:${CORES_RS[r.nome]}"></i>${esc(r.nome)}</th><td>${esc(r.macrorregiao ?? "—")}</td><td>${r.ras.map((c) => esc(base.raNome[c])).join(", ")}</td></tr>`).join("")}</tbody></table>
      <p class="muted small">${esc(corr.status)} ${corr.divergencias.length ? `Divergência com o arquivo original de Regiões de Saúde: ${corr.divergencias.map((d) => `${esc(d.nome)} (tabela: ${esc(d.regiao_tabela)}; arquivo original: ${esc(d.regiao_poligono_original)})`).join("; ")}.` : ""}</p>`;
    let regiao = params.rs && base.rasDaRegiao(params.rs).length ? params.rs : corr.regioes[0].nome;
    const mapa = criarMapa("rs-mapa", { base: "claro" });
    const camadaRS = L.geoJSON(rsGeo, { style: (f) => ({ color: "#fff", weight: 2, fillColor: CORES_RS[f.properties.nome], fillOpacity: 0.55 }), onEachFeature: (f, l) => { l.bindTooltip(`Região ${esc(f.properties.nome)}`, { sticky: true }); l.on("click", () => selecionar(f.properties.nome)); } }).addTo(mapa);
    L.geoJSON(limites, { style: { color: "#ffffff", weight: 0.7, opacity: 0.8, fill: false }, interactive: false }).addTo(mapa);
    mapa.extensaoDF = camadaRS.getBounds();
    mapa.fitBounds(mapa.extensaoDF, { padding: [10, 10] });

    const desenhar = () => {
      const f = { ...filtros.estado(), rs: regiao };
      const geral = base.agruparPor(base.filtrar({ ...f, rs: "all" }), "rs");
      $("#rs-cards").innerHTML = corr.regioes.map((r) => { const a = geral.get(r.nome) ?? base.agregar([]); return `<button type="button" role="tab" aria-selected="${r.nome === regiao}" class="rs-card${r.nome === regiao ? " active" : ""}" data-rs="${esc(r.nome)}" style="--rs:${CORES_RS[r.nome]}"><span>${esc(r.nome)}</span><strong>${fmt(a.amostras)}</strong><small>amostras · ${a.comResultado ? `${pct(a.satisfatorias, a.comResultado)} satisf.` : "sem resultado"}</small></button>`; }).join("");
      camadaRS.eachLayer((l) => l.setStyle({ fillOpacity: l.feature.properties.nome === regiao ? 0.75 : 0.18, weight: l.feature.properties.nome === regiao ? 3 : 1.5, color: l.feature.properties.nome === regiao ? "#123A5A" : "#fff" }));
      const linhas = base.filtrar(f);
      const a = base.agregar(linhas);
      const info = corr.regioes.find((r) => r.nome === regiao);
      const porRA = base.agruparPor(linhas, "ra");
      $("#rs-detalhe").innerHTML = `<span class="section-kicker">REGIÃO DE SAÚDE · ${esc(info.macrorregiao ?? "")}</span><h2>${esc(regiao)}</h2><p class="recorte-mini">${esc(descreverRecorte(base, { ...f, rs: "all" }))}</p>
        <dl class="ficha-dl"><dt>Amostras</dt><dd>${fmt(a.amostras)}</dd><dt>Satisfatórias</dt><dd>${a.comResultado ? `${fmt(a.satisfatorias)} (${pct(a.satisfatorias, a.comResultado)})` : "—"}</dd><dt>Coliformes totais · presença</dt><dd>${a.ctInf ? `${fmt(a.ctP)} (${pct(a.ctP, a.ctInf)})` : "—"}</dd><dt>E. coli · presença</dt><dd>${a.ecInf ? `${fmt(a.ecP)} (${pct(a.ecP, a.ecInf)})` : "—"}</dd><dt>Estabelecimentos</dt><dd>${fmt(base.estabelecimentos(f).n)}</dd><dt>Período</dt><dd>${base.periodo(linhas) ?? "—"}</dd></dl>
        <h3 class="sub">RAs integrantes (${info.ras.length})</h3><ul class="chip-list">${info.ras.map((c) => `<li><a href="#regioes-administrativas?ra=${c}">${esc(base.raNome[c])}</a> <small>${fmt(porRA.get(c)?.amostras ?? 0)}</small></li>`).join("")}</ul>`;
      const porAnoMes = new Map();
      linhas.forEach((l) => { if (l.mes) porAnoMes.set(`${l.ano}-${l.mes}`, (porAnoMes.get(`${l.ano}-${l.mes}`) ?? 0) + l.n); });
      const anos = f.ano !== "all" ? [+f.ano] : base.anos;
      serieMensal("g-rs-mensal", porAnoMes, anos, base.mesesAtivos);
      const porAno = base.agruparPor(base.filtrar({ ...f, ano: "all" }), "ano");
      barras("g-rs-anual", base.anos.map(String), base.anos.map((ano) => porAno.get(ano)?.amostras ?? 0), { cor: CORES_RS[regiao] });
      barras("g-rs-anual-pct", base.anos.map(String), base.anos.map((ano) => { const ag = porAno.get(ano); return ag?.comResultado ? Math.round((ag.satisfatorias / ag.comResultado) * 1000) / 10 : 0; }), { rotulo: "% satisfatórias", cor: CATEGORICAS[2] });
      barras("g-rs-ras", info.ras.map((c) => base.raNome[c]), info.ras.map((c) => porRA.get(c)?.amostras ?? 0), { cor: CORES_RS[regiao] });
    };
    const selecionar = (nome) => { regiao = nome; desenhar(); };
    const filtros = montarFiltros($("#rs-filtros"), base, { campos: ["ano", "mes", "motivo", "resultado"], inicial: params, aoMudar: desenhar });
    $("#rs-cards").addEventListener("click", (e) => { const b = e.target.closest("[data-rs]"); if (b) selecionar(b.dataset.rs); });
    desenhar();
  } catch (erro) {
    erroCarga($("#rs-detalhe"), erro);
  }
}
