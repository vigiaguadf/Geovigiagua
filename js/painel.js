// Painel Público: indicadores agregados com filtros integrados.
import { carregarBase, montarFiltros, descreverRecorte } from "./filtros.js";
import { carregarCamada, criarMapa, simbologia, INDICADORES, legendaHTML, controleLegenda, COR_SEM_DADOS, CATEGORICAS, CORES_RS } from "./camadas.js";
import { cartaoGrafico, serieMensal, barras, resultadosMicro, composicao } from "./graficos.js";
import { $, esc, fmt, pct, heading, notice, footer, statusDados, erroCarga } from "./util.js";

export function paginaPainel() {
  return `${heading("MONITORAMENTO · MAPEAMENTOS 2024–2026", 'Painel <em>público.</em>', "Indicadores agregados da vigilância da qualidade da água por ano, mês, Região de Saúde, Região Administrativa, motivo da coleta e resultado microbiológico.")}
    <div id="painel-status"></div>
    <div class="panel-filters" id="painel-filtros" aria-label="Filtros do painel público"></div>
    <p class="recorte" id="painel-recorte" aria-live="polite"></p>
    <section class="kpi-grid" id="painel-kpis" aria-label="Indicadores do recorte"></section>
    <div class="dashboard-grid">
      <section class="card map-card"><div class="card-head"><div><span class="section-kicker">DISTRIBUIÇÃO TERRITORIAL</span><h2>Indicador por Região Administrativa</h2></div><label class="inline-select">Indicador<select id="painel-indicador">${Object.entries(INDICADORES).map(([k, v]) => `<option value="${k}">${v.rotulo}</option>`).join("")}</select></label></div><div id="painel-mapa" class="dashboard-map" role="region" aria-label="Mapa coroplético por RA"></div><p class="map-caption">Clique em uma RA para filtrar o painel. Cinza = sem dados no recorte (diferente de zero).</p></section>
      <aside class="card ranking-card"><span class="section-kicker">RANKING DO RECORTE</span><h2>Amostras por RA</h2><div id="painel-ranking" class="ranking"></div></aside>
    </div>
    <section class="chart-grid">
      ${cartaoGrafico("g-mensal", "EVOLUÇÃO TEMPORAL", "Amostras por mês e ano", { largo: true, altura: 250 })}
      ${cartaoGrafico("g-micro", "RESULTADOS MICROBIOLÓGICOS", "Coliformes totais e <em>E. coli</em>", { altura: 170, nota: "Presença/ausência de coliformes totais e de E. coli são resultados distintos; nenhum deles, isoladamente, define a conformidade integral da água." })}
      ${cartaoGrafico("g-motivos", "MOTIVO DA COLETA", "Distribuição das amostras", { altura: 210 })}
      ${cartaoGrafico("g-rs", "REGIÕES DE SAÚDE", "Amostras por Região de Saúde", { altura: 230 })}
      ${cartaoGrafico("g-rs-pct", "PERCENTUAIS", "% satisfatórias por Região de Saúde", { altura: 230, nota: "Sobre amostras com coliformes totais e E. coli informados." })}
    </section>
    ${notice("<strong>Como ler “satisfatória”.</strong> Nesta versão, satisfatória significa <em>ausência de coliformes totais e de Escherichia coli</em> na mesma amostra (critério microbiológico). Não equivale à conformidade integral do padrão de potabilidade, que também envolve turbidez, cor, pH, residual desinfetante e outros parâmetros. A planilha de 2025 não traz resultados microbiológicos.")}
    ${footer()}`;
}

export async function iniciarPainel(params) {
  try {
    const [base, limites] = await Promise.all([carregarBase(), carregarCamada("ra")]);
    if (!$("#painel-filtros")) return;
    $("#painel-status").innerHTML = statusDados(base.indicadores);
    const mapa = criarMapa("painel-mapa");
    const legenda = controleLegenda(mapa);
    let selecaoRA = null;
    const camadaRA = L.geoJSON(limites, {
      style: { color: "#fff", weight: 1, fillOpacity: 0.85, fillColor: COR_SEM_DADOS },
      onEachFeature: (feature, layer) => layer.on("click", () => filtros.definir("ra", String(feature.properties.cira))),
    }).addTo(mapa);
    mapa.extensaoDF = camadaRA.getBounds();
    mapa.fitBounds(mapa.extensaoDF, { padding: [10, 10] });

    const atualizar = (f) => {
      const linhas = base.filtrar(f);
      const a = base.agregar(linhas);
      const estab = base.estabelecimentos(f);
      const ras = new Set(linhas.filter((l) => l.ra > 0 && l.n > 0).map((l) => l.ra));
      $("#painel-recorte").innerHTML = `<b>Recorte:</b> ${esc(descreverRecorte(base, f))}`;
      $("#painel-kpis").innerHTML = [
        kpi("Amostras", fmt(a.amostras), "amostras distintas (código GAL)"),
        kpi("Satisfatórias", a.comResultado ? fmt(a.satisfatorias) : "—", a.comResultado ? `${pct(a.satisfatorias, a.comResultado)} das ${fmt(a.comResultado)} com resultado` : "sem resultado microbiológico no recorte"),
        kpi("Coliformes totais · presença", a.ctInf ? fmt(a.ctP) : "—", a.ctInf ? `${pct(a.ctP, a.ctInf)} das amostras com resultado` : "sem resultado informado", "alerta"),
        kpi("E. coli · presença", a.ecInf ? fmt(a.ecP) : "—", a.ecInf ? `${pct(a.ecP, a.ecInf)} das amostras com resultado` : "sem resultado informado", "alerta"),
        kpi("Regiões Administrativas", fmt(ras.size), "com amostras no recorte (de 35)"),
        kpi("Estabelecimentos", fmt(estab.n), estab.parcial ? "por ano, mês e território; não filtrado por motivo/resultado" : "locais distintos de coleta"),
        kpi("Período", base.periodo(linhas) ?? "Sem data", "datas válidas do recorte", "texto"),
      ].join("");

      // Mapa coroplético
      const chave = $("#painel-indicador").value;
      const porRA = base.porRA(f);
      const membros = f.rs !== "all" ? new Set(base.rasDaRegiao(f.rs)) : null;
      const valores = [...porRA].filter(([c]) => !membros || membros.has(c)).map(([, ag]) => (ag.amostras ? INDICADORES[chave].valor(ag) : null));
      const simb = simbologia(chave, valores);
      camadaRA.eachLayer((layer) => {
        const cira = layer.feature.properties.cira;
        const ag = porRA.get(cira);
        const fora = membros && !membros.has(cira);
        const valor = ag.amostras ? INDICADORES[chave].valor(ag) : null;
        layer.setStyle({ fillColor: fora ? "#F3F6F7" : simb.cor(valor), fillOpacity: fora ? 0.4 : 0.85, weight: String(cira) === f.ra ? 3 : 1, color: String(cira) === f.ra ? "#123A5A" : "#fff" });
        if (String(cira) === f.ra) layer.bringToFront();
        layer.bindTooltip(`<strong>${esc(layer.feature.properties.nome)}</strong><br>${INDICADORES[chave].rotulo}: ${valor == null ? "sem dados" : simb.formatar(valor)}${INDICADORES[chave].base && ag.comResultado < 10 && valor != null ? "<br><small>Base pequena (n < 10): interpretar com cautela</small>" : ""}`, { sticky: true });
      });
      legenda.atualizar(legendaHTML(INDICADORES[chave].rotulo, simb.itens));
      if (f.ra !== "all" && selecaoRA !== f.ra) camadaRA.eachLayer((l) => { if (String(l.feature.properties.cira) === f.ra) mapa.fitBounds(l.getBounds(), { maxZoom: 12, padding: [20, 20] }); });
      else if (f.ra === "all" && selecaoRA) mapa.fitBounds(mapa.extensaoDF, { padding: [10, 10] });
      selecaoRA = f.ra !== "all" ? f.ra : null;

      // Ranking
      const ranking = [...porRA].filter(([, ag]) => ag.amostras > 0).sort((x, y) => y[1].amostras - x[1].amostras);
      const maior = ranking[0]?.[1].amostras || 1;
      $("#painel-ranking").innerHTML = ranking.length ? ranking.map(([cira, ag]) => `<button type="button" class="ranking-row${String(cira) === f.ra ? " active" : ""}" data-ra="${cira}"><span>${esc(base.raNome[cira])}</span><i style="--w:${Math.max(3, (ag.amostras / maior) * 100)}%"></i><b>${fmt(ag.amostras)}</b></button>`).join("") : '<p class="empty-inline">Nenhuma amostra no recorte.</p>';

      // Gráficos
      const anos = [...new Set(linhas.map((l) => l.ano))].sort();
      const porAnoMes = new Map();
      linhas.forEach((l) => { if (l.mes) porAnoMes.set(`${l.ano}-${l.mes}`, (porAnoMes.get(`${l.ano}-${l.mes}`) ?? 0) + l.n); });
      serieMensal("g-mensal", porAnoMes, anos.length ? anos : base.anos, base.mesesAtivos);
      resultadosMicro("g-micro", a);
      const porMotivo = base.agruparPor(linhas, "motivo");
      composicao("g-motivos", [...porMotivo].map(([m, ag]) => [base.motivos[m], ag.amostras]));
      const porRS = base.agruparPor(base.filtrar(f, ["rs", "ra"]), "rs");
      const nomesRS = base.regioes.map((r) => r.nome);
      barras("g-rs", nomesRS, nomesRS.map((n) => porRS.get(n)?.amostras ?? 0), { cores: nomesRS.map((n) => (f.rs === "all" || f.rs === n ? CORES_RS[n] : "#D5DEE2")) });
      barras("g-rs-pct", nomesRS, nomesRS.map((n) => { const ag = porRS.get(n); return ag?.comResultado ? Math.round((ag.satisfatorias / ag.comResultado) * 1000) / 10 : 0; }), { rotulo: "% satisfatórias", horizontal: true, cor: CATEGORICAS[2] });
    };

    const filtros = montarFiltros($("#painel-filtros"), base, { inicial: params, aoMudar: (f) => atualizar(f) });
    $("#painel-indicador").addEventListener("change", () => atualizar(filtros.estado()));
    $("#painel-ranking").addEventListener("click", (e) => { const b = e.target.closest("[data-ra]"); if (b) filtros.definir("ra", b.dataset.ra); });
    atualizar(filtros.estado());
  } catch (erro) {
    erroCarga($("#painel-kpis"), erro);
  }
}

function kpi(rotulo, valor, nota, tipo = "") {
  return `<article class="kpi${tipo ? ` kpi-${tipo}` : ""}"><span>${rotulo}</span><strong>${valor}</strong><small>${nota}</small></article>`;
}
