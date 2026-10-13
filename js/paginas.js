// Páginas institucionais e de conteúdo: Início, Relatórios, Metodologia, Sobre e módulos restritos.
import { carregarBase } from "./filtros.js";
import { carregarCamada, criarMapa, simbologia, INDICADORES, legendaHTML, controleLegenda } from "./camadas.js";
import { tabelaHTML } from "./graficos.js";
import { $, esc, fmt, pct, heading, notice, footer, statusDados, carregarJSON, erroCarga, MESES } from "./util.js";

// ------------------------------------------------------------------ Início

export function paginaInicio() {
  return `${heading("INTELIGÊNCIA TERRITORIAL · VIGILÂNCIA AMBIENTAL EM SAÚDE", 'GeoVIGIÁGUA DF<br><em>Inteligência Territorial aplicada à Vigilância da Qualidade da Água</em>', "A Vigilância Ambiental em Saúde atua de forma preventiva: acompanha a água consumida pela população, identifica situações de risco sanitário antes que se tornem agravos e orienta ações corretivas junto aos responsáveis pelo abastecimento. O GeoVIGIÁGUA DF reúne os resultados do monitoramento, o território e a hidrografia para apoiar o planejamento e a transparência.", '<div class="df-stamp"><b>DF</b><span>SECRETARIA DE SAÚDE<br>DO DISTRITO FEDERAL</span></div>')}
    <div id="inicio-status"></div>
    <section class="kpi-grid kpi-home" id="inicio-kpis" aria-label="Resumo do monitoramento"><p class="loading">Carregando indicadores…</p></section>
    <div class="section-heading"><div><span class="section-kicker">01 / ESPACIALIZAÇÃO</span><h2>Amostras por Região Administrativa</h2></div><a class="text-link" href="#mapa-interativo">Explorar mapa <b>→</b></a></div>
    <div class="overview-grid">
      <section class="card map-card"><div id="inicio-mapa" class="overview-map" role="region" aria-label="Mapa-resumo do DF"></div><p class="map-caption">Amostras distintas 2024–2026 por RA · limites SEGETH/SEDUH-DF</p></section>
      <aside class="card year-card"><span class="section-kicker">POR ANO</span><h2>Resumo anual</h2><div id="inicio-anos"></div></aside>
    </div>
    <section class="shortcut-grid" aria-label="Acesso rápido">
      ${[["painel-publico", "▦", "Painel Público", "Indicadores e gráficos com filtros integrados."], ["mapa-interativo", "⌖", "Mapa Interativo", "WebGIS com RAs, Regiões de Saúde e hidrografia."], ["dados-downloads", "⇩", "Dados e Downloads", "Catálogo com metadados e arquivos autorizados."], ["relatorios", "▧", "Relatórios e Boletins", "Biblioteca de publicações técnicas."], ["metodologia", "≋", "Metodologia", "Fluxos, critérios, qualidade e governança."]].map(([r, i, t, d]) => `<a class="shortcut" href="#${r}"><span aria-hidden="true">${i}</span><strong>${t}</strong><small>${d}</small></a>`).join("")}
    </section>
    ${notice("<strong>Publicação responsável.</strong> O portal publica somente dados agregados por Região Administrativa: endereços, coordenadas de estabelecimentos, códigos de amostra e dados operacionais não são exibidos. Indicadores são preliminares até a validação institucional da GVAFNB.")}
    ${footer()}`;
}

export async function iniciarInicio() {
  try {
    const [base, limites] = await Promise.all([carregarBase(), carregarCamada("ra")]);
    if (!$("#inicio-kpis")) return;
    $("#inicio-status").innerHTML = statusDados(base.indicadores);
    const a = base.agregar(base.linhas);
    const ras = new Set(base.linhas.filter((l) => l.ra > 0).map((l) => l.ra)).size;
    $("#inicio-kpis").innerHTML = [
      ["Amostras analisadas", fmt(a.amostras), "amostras distintas, 2024–2026"],
      ["Satisfatórias", fmt(a.satisfatorias), `${pct(a.satisfatorias, a.comResultado)} das ${fmt(a.comResultado)} com resultado (critério microbiológico)`],
      ["Coliformes totais · presença", fmt(a.ctP), `${pct(a.ctP, a.ctInf)} das amostras com resultado`],
      ["Regiões Administrativas", `${ras}<small>/35</small>`, "com amostras no período"],
      ["Estabelecimentos", fmt(base.estabelecimentos({}).n), "locais distintos de coleta"],
      ["Período de referência", base.periodo(base.linhas), "datas válidas de coleta"],
    ].map(([r, v, n], i) => `<article class="kpi${i === 2 ? " kpi-alerta" : ""}${i === 5 ? " kpi-texto" : ""}"><span>${r}</span><strong>${v}</strong><small>${n}</small></article>`).join("");
    const resumo = base.indicadores.resumoAnual;
    $("#inicio-anos").innerHTML = `<table class="data-table compact"><thead><tr><th scope="col">Ano</th><th scope="col">Amostras</th><th scope="col">Satisf.</th><th scope="col">CT pres.</th></tr></thead><tbody>${Object.entries(resumo).map(([ano, r]) => `<tr><th scope="row"><a href="#painel-publico?ano=${ano}">${ano}</a></th><td>${fmt(r.amostras)}</td><td>${r.com_resultado_microbiologico ? pct(r.satisfatorias_microbiologicas, r.com_resultado_microbiologico) : '<span class="nd">s/r</span>'}</td><td>${r.com_resultado_microbiologico ? fmt(r.ct_presenca) : '<span class="nd">s/r</span>'}</td></tr>`).join("")}</tbody></table><p class="muted small">s/r: a planilha de 2025 não traz resultados microbiológicos.</p>`;
    const mapa = criarMapa("inicio-mapa", { base: "claro" });
    const porRA = base.porRA({});
    const simb = simbologia("amostras", [...porRA.values()].map((x) => x.amostras || null));
    const camada = L.geoJSON(limites, {
      style: (f) => ({ color: "#fff", weight: 1, fillOpacity: 0.85, fillColor: simb.cor(porRA.get(f.properties.cira).amostras || null) }),
      onEachFeature: (f, l) => { l.bindTooltip(`<strong>${esc(f.properties.nome)}</strong><br>${fmt(porRA.get(f.properties.cira).amostras)} amostras`, { sticky: true }); l.on("click", () => { location.hash = `regioes-administrativas?ra=${f.properties.cira}`; }); },
    }).addTo(mapa);
    mapa.extensaoDF = camada.getBounds();
    mapa.fitBounds(mapa.extensaoDF, { padding: [8, 8] });
    controleLegenda(mapa).atualizar(legendaHTML("Amostras", simb.itens));
  } catch (erro) {
    erroCarga($("#inicio-kpis"), erro);
  }
}

// ------------------------------------------------------------------ Relatórios

export function paginaRelatorios() {
  return `${heading("PUBLICAÇÕES TÉCNICAS", 'Relatórios <em>e boletins.</em>', "Biblioteca de boletins, relatórios quadrimestrais e anuais, notas técnicas, documentos metodológicos e materiais informativos do VIGIÁGUA DF.")}
    <div class="panel-filters compact" id="rel-filtros"><label>Ano<select data-f="ano"><option value="all">Todos</option></select></label><label>Categoria<select data-f="categoria"><option value="all">Todas</option></select></label></div>
    <div id="rel-lista"><p class="loading">Carregando biblioteca…</p></div>
    ${footer()}`;
}

export async function iniciarRelatorios() {
  try {
    const rel = await carregarJSON("data/relatorios.json");
    if (!$("#rel-lista")) return;
    const sel = (f) => $(`#rel-filtros [data-f="${f}"]`);
    [...new Set(rel.itens.map((i) => i.ano))].sort().reverse().forEach((a) => sel("ano").add(new Option(a, a)));
    rel.categorias.forEach((c) => sel("categoria").add(new Option(c, c)));
    const pintar = () => {
      const ano = sel("ano").value; const cat = sel("categoria").value;
      const itens = rel.itens.filter((i) => (ano === "all" || String(i.ano) === ano) && (cat === "all" || i.categoria === cat));
      $("#rel-lista").innerHTML = itens.length ? `<div class="catalog">${itens.map((i) => `<article class="catalog-item"><header><div><span class="section-kicker">${esc(i.categoria.toUpperCase())} · ${esc(i.edicao ?? "")}</span><h2>${esc(i.titulo)}</h2></div><span class="tag tag-publico">${esc(i.periodo)}</span></header><p>${esc(i.descricao)}</p><p class="muted small">Publicado em ${esc(i.publicacao)}</p><div class="catalog-actions">${i.pdf ? `<a class="btn btn-secondary" href="${encodeURI(i.pdf)}" target="_blank" rel="noopener">Visualizar PDF</a><a class="btn" href="${encodeURI(i.pdf)}" download>Baixar PDF</a>` : ""}</div></article>`).join("")}</div>`
        : `<section class="empty-state"><span class="empty-mark" aria-hidden="true">▤</span><span class="section-kicker">BIBLIOTECA EM PREPARAÇÃO</span><h2>Nenhuma publicação autorizada até o momento</h2><p>Documentos aparecerão aqui após revisão técnica e autorização institucional. Para publicar, inclua o PDF em <code>downloads/relatorios/</code> e registre-o em <code>data/relatorios.json</code>.</p></section>`;
    };
    $("#rel-filtros").addEventListener("change", pintar);
    pintar();
  } catch (erro) {
    erroCarga($("#rel-lista"), erro);
  }
}

// ------------------------------------------------------------------ Metodologia

const FLUXO_METODO = ["Planejamento", "Revisão bibliográfica", "Obtenção de dados", "Tratamento e padronização", "QGIS", "Indicadores", "Power BI", "WebGIS Leaflet", "Validação", "Produto tecnológico"];
const FLUXO_OPERACAO = ["Coletas", "Laboratório", "Banco de dados", "Qualificação", "Banco geoespacial", "Dashboard / WebGIS", "Gestão, planejamento, decisão e transparência"];
const FERRAMENTAS = [
  ["Excel", "Organização das planilhas de mapeamento", "Em uso"], ["Power Query", "ETL das bases institucionais", "Previsto (ambiente institucional)"],
  ["QGIS", "Geoprocessamento, validação cartográfica e simbologia", "Em uso"], ["Python (pandas, GeoPandas)", "Script reprodutível de geração da base pública (scripts/build_public_data.py)", "Em uso"],
  ["GeoJSON", "Intercâmbio de camadas na web (EPSG:4326)", "Em uso"], ["Shapefile", "Distribuição de dados vetoriais (.shp, .shx, .dbf, .prj, .cpg)", "Em uso"],
  ["Leaflet", "Mapas interativos", "Em uso"], ["Chart.js", "Gráficos do painel", "Em uso"], ["HTML, CSS e JavaScript", "Interface do portal", "Em uso"],
  ["GitHub Pages", "Hospedagem estática do portal público", "Em uso"], ["Power BI", "Painel institucional com controle de acesso", "Previsto"],
];

export function paginaMetodologia() {
  const flow = (passos) => `<ol class="flow">${passos.map((p, i) => `<li><b>${String(i + 1).padStart(2, "0")}</b><span>${p}</span></li>`).join("")}</ol>`;
  return `${heading("TRANSPARÊNCIA E GOVERNANÇA", 'Metodologia <em>e governança.</em>', "Procedimentos, tecnologias, critérios de classificação, qualidade dos dados e regras de publicação do GeoVIGIÁGUA DF.")}
    <nav class="toc" aria-label="Nesta página"><a href="#metodologia" data-ancora="m-fluxos">Fluxos</a><a href="#metodologia" data-ancora="m-criterios">Critérios</a><a href="#metodologia" data-ancora="m-qualidade">Qualidade</a><a href="#metodologia" data-ancora="m-dicionario">Dicionário</a><a href="#metodologia" data-ancora="m-governanca">Governança</a><a href="#metodologia" data-ancora="m-validacao">Validação</a></nav>
    <section class="card method" id="m-fluxos"><span class="section-kicker">FLUXO METODOLÓGICO</span>${flow(FLUXO_METODO)}<span class="section-kicker">FLUXO OPERACIONAL</span>${flow(FLUXO_OPERACAO)}</section>
    <section class="card method"><span class="section-kicker">FERRAMENTAS</span><h2>Tecnologias e funções</h2>${tabelaHTML(["Ferramenta", "Função", "Situação"], FERRAMENTAS)}</section>
    <section class="card method" id="m-criterios"><span class="section-kicker">CLASSIFICAÇÃO</span><h2>Critérios dos indicadores</h2><div id="m-criterios-lista"><p class="loading">Carregando…</p></div>
      ${notice("Presença/ausência de coliformes totais, presença/ausência de <em>Escherichia coli</em> e conformidade geral são conceitos distintos. A ausência de coliformes, isoladamente, não comprova conformidade integral da água ao padrão de potabilidade (Portaria GM/MS nº 888/2021).")}</section>
    <section class="card method" id="m-qualidade"><span class="section-kicker">QUALIDADE E RASTREABILIDADE</span><h2>Controle de qualidade por planilha</h2><div class="table-scroll" id="m-qualidade-tabela"><p class="loading">Carregando…</p></div><p class="muted small">Gerado automaticamente pelo script de build. O hash SHA-256 de cada planilha de origem fica registrado em data/indicadores.json para rastreabilidade.</p></section>
    <section class="card method" id="m-dicionario"><span class="section-kicker">DICIONÁRIO DE DADOS</span><h2>Base pública agregada</h2>${tabelaHTML(["Campo", "Descrição"], [
      ["ano", "Ano da planilha de mapeamento."], ["mes", "Mês da data de coleta (vazio/0 quando ausente)."], ["ra_cira", "Código numérico estável da RA (1 a 35, SEGETH/SEDUH); 0 = sem RA identificada."],
      ["ra_codigo", "Código romano oficial (RA-I a RA-XXXV)."], ["regiao_saude", "Região de Saúde pela tabela de correspondência versionada."], ["motivo_coleta", "Rotina, Retorno, Recoleta, Solicitação, Ouvidoria, Surto, Vigidesastre, Outros, Não informado."],
      ["ct / ec", "Resultado de coliformes totais / E. coli: P (presença), A (ausência), N (não informado)."], ["amostras (n)", "Número de amostras distintas na combinação."],
      ["estabelecimentos", "Locais distintos de coleta por ano × mês × RA; não somáveis entre períodos."],
    ])}</section>
    <section class="card method" id="m-governanca"><span class="section-kicker">GOVERNANÇA</span><h2>Arquitetura e classificação de acesso</h2>
      ${tabelaHTML(["Camada de dados", "Exemplo", "Onde fica", "Acesso"], [
        ["Bruto institucional", "VIGIAGUA_DF_Gestao_Coletas_2026.xlsx", "Ambiente institucional da SES-DF", "Restrito"],
        ["Bruto de mapeamento", "Mapeamento_Agua_20XX.xlsx (com endereços e coordenadas)", "Pasta de fontes fora do repositório", "Restrito"],
        ["Tratado e geoespacial", "Pontos validados, RA atribuída", "Ambiente institucional / QGIS", "Restrito"],
        ["Público agregado", "data/indicadores.json, downloads/mapeamento_*", "Repositório público (GitHub Pages)", "Público"],
        ["Metadados", "data/catalogo.json, docs/metadados/", "Repositório público", "Público"],
      ])}
      <ul class="rules"><li>Sem coordenadas exatas de estabelecimentos, endereços, dados pessoais ou identificadores operacionais (ID_VISITA, ID_LAUDO, códigos GAL) no portal público.</li><li>Agregação mínima por RA e mês; percentuais com menos de 10 amostras com resultado são sinalizados.</li><li>Associação territorial por códigos estáveis (ra_cira, ra_codigo), não apenas por nomes.</li><li>Atualização por arquivos JSON/CSV/GeoJSON gerados pelo script, sem edição manual de páginas. Cada mudança da tabela RA–Região de Saúde gera nova versão no CHANGELOG.</li><li>GitHub Pages não substitui autenticação e autorização de servidor.</li></ul></section>
    <section class="card method" id="m-validacao"><span class="section-kicker">VALIDAÇÃO</span><h2>Situação das validações</h2>${tabelaHTML(["Dimensão", "O que foi verificado", "Situação"], [
      ["Cartográfica", "SRC (EPSG:31983 → 4326), validade geométrica, 35 RAs com códigos e nomes conferidos, simplificação topológica sem lacunas", "Automatizada no build"],
      ["Dados", "Totais por planilha, duplicidades de código de amostra, datas ausentes, coordenadas fora do DF, divergência RA informada × espacial", "Automatizada no build"],
      ["Comparação com relatórios institucionais", "Totais anuais × relatórios da GVAFNB", "Pendente"],
      ["Funcional", "Filtros, mapas, indicadores, downloads, responsividade e acessibilidade", "Testada nesta versão"],
      ["Institucional", "Avaliação documentada por especialistas autorizados da GVAFNB", "Pendente"],
    ])}</section>
    ${footer()}`;
}

export async function iniciarMetodologia() {
  document.querySelectorAll("[data-ancora]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); document.getElementById(a.dataset.ancora)?.scrollIntoView({ behavior: "smooth" }); }));
  try {
    const ind = await carregarJSON("data/indicadores.json");
    if (!$("#m-criterios-lista")) return;
    const nomes = { satisfatoria_microbiologica: "Satisfatória (critério microbiológico)", percentuais: "Percentuais", ra: "Região Administrativa", regiao_saude: "Região de Saúde", conformidade_integral: "Conformidade integral" };
    $("#m-criterios-lista").innerHTML = `<dl class="meta-dl wide">${Object.entries(ind.criterios).map(([k, v]) => `<dt>${esc(nomes[k] ?? k)}</dt><dd>${esc(v)}</dd>`).join("")}<dt>Unidade de contagem</dt><dd>${esc(ind.unidade)}</dd></dl>`;
    const campos = [["linhas", "Linhas"], ["amostras_distintas", "Amostras distintas"], ["linhas_repetidas_mesma_amostra", "Linhas repetidas"], ["sem_codigo_amostra", "Sem código"], ["sem_coordenada", "Sem coordenada"], ["coordenada_fora_do_df", "Fora do DF"], ["ra_por_espacial", "RA espacial"], ["ra_por_atributo", "RA por atributo"], ["coordenada_suspeita_prevaleceu_atributo", "Coord. suspeita"], ["sem_data", "Sem data"]];
    $("#m-qualidade-tabela").innerHTML = tabelaHTML(["Planilha", ...campos.map(([, r]) => r)], ind.qualidade.map((q) => [q.arquivo, ...campos.map(([c]) => q[c] ?? 0)]));
  } catch (erro) {
    erroCarga($("#m-criterios-lista"), erro);
  }
}

// ------------------------------------------------------------------ Sobre

export function paginaSobre() {
  return `${heading("PROJETO · DISTRITO FEDERAL", 'Sobre o <em>GeoVIGIÁGUA DF.</em>', "Plataforma Integrada de Inteligência Territorial para a Vigilância da Qualidade da Água para Consumo Humano.")}
    <section class="about-lead"><span>PROPÓSITO</span><p>Articular Geografia da Saúde, geoprocessamento, indicadores de qualidade da água, governança de dados e planejamento público para apoiar decisões baseadas em evidências no Distrito Federal.</p></section>
    <div class="about-grid">
      <article class="card"><span class="section-kicker">REFERÊNCIA INSTITUCIONAL</span><h2>GVAFNB / DIVAL / SVS / SES-DF</h2><p>Vigilância da qualidade da água para consumo humano (VIGIÁGUA) no âmbito da Secretaria de Saúde do Distrito Federal.</p></article>
      <article class="card"><span class="section-kicker">DOIS AMBIENTES</span><h2>Público e institucional</h2><p>O portal público mostra dados agregados e arquivos autorizados. Dados operacionais detalhados exigem um ambiente institucional com autenticação real, fora do GitHub Pages.</p></article>
      <article class="card"><span class="section-kicker">VERSÃO</span><h2>Portal Integrado 2.0</h2><p>Evolução incremental do WebGIS 1.2: base pública agregada, WebGIS com 35 RAs e 7 Regiões de Saúde, hidrografia, catálogo com metadados e documentação metodológica. Histórico em <a href="CHANGELOG.md">CHANGELOG.md</a>.</p></article>
    </div>
    <section class="card method"><span class="section-kicker">EVOLUÇÕES FUTURAS</span><h2>Próximas etapas</h2><ul class="rules"><li>Validação institucional dos indicadores e da tabela RA–Região de Saúde.</li><li>Medição de distância e área, consultas espaciais, exportação de mapas em PNG/PDF e impressão cartográfica.</li><li>Comparação entre anos, tendências, metas e cobertura territorial (com taxas por população quando houver base demográfica autorizada).</li><li>Integração com bases ambientais (bacias e sub-bacias), SISAGUA sob autorização e serviços OGC quando viáveis.</li><li>Ambiente institucional com autenticação, laudos e planejamento das coletas.</li></ul></section>
    ${footer()}`;
}

// ------------------------------------------------------------------ Restritos

export function paginaRestrita(id) {
  const institucional = id === "painel-institucional";
  const blocos = institucional
    ? `<section class="card method"><span class="section-kicker">ESCOPO PREVISTO</span><h2>Indicadores do Painel Institucional</h2><ul class="rules"><li>Amostras, satisfatórias, coliformes totais e <em>E. coli</em> por estabelecimento visitado, RA, Região de Saúde, motivo, tipo de imóvel e data.</li><li>Laudos emitidos, encaminhados e pendentes; percentual de entrega; desempenho temporal e territorial.</li><li>Campos operacionais: <code>ID_VISITA</code>, <code>ID_LAUDO</code>, <code>STATUS_LAUDO</code>, <code>LAUDO_QUALIFICADO</code>.</li><li>Planejamento das coletas, pendências e acompanhamento de metas.</li></ul></section>
       <section class="card method"><span class="section-kicker">ARQUITETURA RECOMENDADA</span><h2>Ambiente protegido</h2>${tabelaHTML(["Componente", "Recomendação"], [["Hospedagem", "Servidor ou nuvem institucional da SES-DF, fora do GitHub Pages"], ["Autenticação", "Login institucional (SSO/Microsoft Entra ID ou equivalente), com perfis por função"], ["Autorização", "Controle por papel e, no Power BI, segurança em nível de linha (RLS) por Região de Saúde"], ["Dados", "Base de gestão de coletas em banco institucional; publicação no portal público somente de derivados agregados aprovados"], ["Auditoria", "Registro de acessos e de alterações nas bases"]])}</section>`
    : `<section class="card method"><span class="section-kicker">PROCEDIMENTO DE ATUALIZAÇÃO</span><h2>Como a base pública é gerada</h2><ol class="rules"><li>Atualize as planilhas Mapeamento_Agua_20XX.xlsx e as camadas na pasta de fontes, <strong>fora do repositório</strong>.</li><li>Execute <code>python scripts/build_public_data.py --fontes &lt;pasta&gt;</code>.</li><li>Revise <code>docs/validacao_build.txt</code> (contagens, divergências, coordenadas suspeitas).</li><li>Registre a versão no CHANGELOG e submeta para validação da GVAFNB.</li><li>Publique no GitHub somente após aprovação.</li></ol></section>`;
  const titulo = institucional ? "Painel Institucional" : "Administração de Dados";
  return `${heading("AMBIENTE INSTITUCIONAL", `${titulo.split(" ")[0]} <em>${titulo.split(" ").slice(1).join(" ")}.</em>`, `${titulo} exige autenticação e autorização institucionais, que não existem em um site estático.`)}
    <section class="restricted-panel"><span aria-hidden="true">▣</span><div><h2>Acesso restrito: este módulo não carrega dados.</h2><p>Nenhum dado operacional é carregado neste portal público. O GitHub Pages não é usado para proteger informações sigilosas, e não há tela de login simulada.</p></div></section>
    ${blocos}${footer()}`;
}
