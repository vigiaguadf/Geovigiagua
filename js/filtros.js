// Modelo de dados do monitoramento público (cubo agregado) e filtros territoriais encadeados.
import { carregarJSON, MESES, opcoes } from "./util.js";

export const RESULTADOS = [
  ["sat", "Satisfatória (CT e E. coli ausentes)"],
  ["ct", "Presença de coliformes totais"],
  ["ec", "Presença de E. coli"],
  ["sem", "Sem resultado informado"],
];

let basePromise;

export function carregarBase() {
  basePromise ??= Promise.all([carregarJSON("data/indicadores.json"), carregarJSON("data/regioes_saude.json")])
    .then(([indicadores, correspondencia]) => new BaseMonitoramento(indicadores, correspondencia));
  return basePromise;
}

export class BaseMonitoramento {
  constructor(indicadores, correspondencia) {
    this.indicadores = indicadores;
    this.correspondencia = correspondencia;
    this.motivos = indicadores.dimensoes.motivos;
    this.raNome = { 0: "Sem RA identificada" };
    this.raRegiao = {};
    this.raCodigo = {};
    correspondencia.ras.forEach((ra) => { this.raNome[ra.cira] = ra.nome; this.raRegiao[ra.cira] = ra.regiao_saude; this.raCodigo[ra.cira] = ra.codigo; });
    this.regioes = correspondencia.regioes;
    this.linhas = indicadores.linhas.map(([ano, mes, ra, motivo, ct, ec, n]) => ({ ano, mes, ra, motivo, ct, ec, n, rs: this.raRegiao[ra] ?? null }));
    this.mesesAtivos = new Set(this.linhas.filter((l) => l.mes > 0).map((l) => `${l.ano}-${l.mes}`));
    this.anos = [...new Set(this.linhas.map((l) => l.ano))].sort();
    this.estab = new Map(indicadores.estabelecimentos.linhas.map(([ano, mes, ra, n]) => [`${ano}|${mes}|${ra}`, n]));
  }

  rasDaRegiao(nome) {
    return this.regioes.find((r) => r.nome === nome)?.ras ?? [];
  }

  /** Linhas que atendem ao filtro. Campos com valor "all" (ou ausentes) não restringem. */
  filtrar(f = {}, ignorar = []) {
    const usa = (campo) => f[campo] && f[campo] !== "all" && !ignorar.includes(campo);
    return this.linhas.filter((l) =>
      (!usa("ano") || l.ano === +f.ano)
      && (!usa("mes") || l.mes === +f.mes)
      && (!usa("rs") || l.rs === f.rs)
      && (!usa("ra") || l.ra === +f.ra)
      && (!usa("motivo") || l.motivo === +f.motivo)
      && (!usa("resultado") || atendeResultado(l, f.resultado)));
  }

  agregar(linhas) {
    const a = { amostras: 0, comResultado: 0, satisfatorias: 0, ctP: 0, ctInf: 0, ecP: 0, ecInf: 0 };
    for (const l of linhas) {
      a.amostras += l.n;
      if (l.ct !== "N") a.ctInf += l.n;
      if (l.ec !== "N") a.ecInf += l.n;
      if (l.ct === "P") a.ctP += l.n;
      if (l.ec === "P") a.ecP += l.n;
      if (l.ct !== "N" && l.ec !== "N") {
        a.comResultado += l.n;
        if (l.ct === "A" && l.ec === "A") a.satisfatorias += l.n;
      }
    }
    return a;
  }

  agruparPor(linhas, chave) {
    const grupos = new Map();
    for (const l of linhas) {
      const k = typeof chave === "function" ? chave(l) : l[chave];
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(l);
    }
    return new Map([...grupos].map(([k, ls]) => [k, this.agregar(ls)]));
  }

  /** Estabelecimentos distintos no recorte de ano, mês e território. Não é filtrado por motivo nem resultado. */
  estabelecimentos(f = {}, raAlvo = null) {
    const ano = f.ano && f.ano !== "all" ? +f.ano : 0;
    const mes = f.mes && f.mes !== "all" ? +f.mes : 0;
    let ras;
    if (raAlvo !== null) ras = [raAlvo];
    else if (f.ra && f.ra !== "all") ras = [+f.ra];
    else if (f.rs && f.rs !== "all") ras = this.rasDaRegiao(f.rs);
    else ras = [0, ...Object.keys(this.raRegiao).map(Number)];
    const n = ras.reduce((soma, ra) => soma + (this.estab.get(`${ano}|${mes}|${ra}`) ?? 0), 0);
    const parcial = ["motivo", "resultado"].some((c) => f[c] && f[c] !== "all");
    return { n, parcial };
  }

  /** Agregados por RA (ignora o filtro de RA para permitir comparação territorial). */
  porRA(f = {}) {
    const grupos = this.agruparPor(this.filtrar(f, ["ra"]), "ra");
    const resultado = new Map();
    Object.keys(this.raRegiao).map(Number).forEach((cira) => {
      const a = grupos.get(cira) ?? this.agregar([]);
      a.estabelecimentos = this.estabelecimentos(f, cira).n;
      resultado.set(cira, a);
    });
    return resultado;
  }

  periodo(linhas) {
    const chaves = linhas.filter((l) => l.mes > 0 && l.n > 0).map((l) => l.ano * 100 + l.mes).sort((a, b) => a - b);
    if (!chaves.length) return null;
    const rot = (k) => `${String(k % 100).padStart(2, "0")}/${Math.floor(k / 100)}`;
    return chaves[0] === chaves.at(-1) ? rot(chaves[0]) : `${rot(chaves[0])} a ${rot(chaves.at(-1))}`;
  }
}

export function atendeResultado(l, resultado) {
  switch (resultado) {
    case "sat": return l.ct === "A" && l.ec === "A";
    case "ct": return l.ct === "P";
    case "ec": return l.ec === "P";
    case "sem": return l.ct === "N" || l.ec === "N";
    default: return true;
  }
}

const CAMPOS = {
  ano: ["Ano", "Todos"], mes: ["Mês", "Todos"], rs: ["Região de Saúde", "Todas"], ra: ["Região Administrativa", "Todas"],
  motivo: ["Motivo da coleta", "Todos"], resultado: ["Resultado microbiológico", "Todos"],
};

/**
 * Cria selects de filtro encadeados (Região de Saúde restringe as RAs).
 * Retorna { estado(), definir(campo, valor) }.
 */
export function montarFiltros(container, base, { campos = Object.keys(CAMPOS), inicial = {}, aoMudar }) {
  container.innerHTML = campos.map((campo) => `<label>${CAMPOS[campo][0]}<select data-filtro="${campo}"></select></label>`).join("")
    + '<button class="outline-button filtro-limpar" type="button">Limpar filtros</button>';
  const sel = (campo) => container.querySelector(`[data-filtro="${campo}"]`);
  const preencher = {
    ano: () => opcoes(sel("ano"), base.anos.map((a) => [String(a), String(a)]), CAMPOS.ano[1]),
    mes: () => opcoes(sel("mes"), MESES.map((m, i) => [String(i + 1), m]), CAMPOS.mes[1]),
    rs: () => opcoes(sel("rs"), base.regioes.map((r) => [r.nome, r.nome]), CAMPOS.rs[1]),
    ra: () => {
      const rs = sel("rs")?.value ?? "all";
      const ras = (rs === "all" ? Object.keys(base.raRegiao).map(Number) : base.rasDaRegiao(rs))
        .sort((a, b) => base.raNome[a].localeCompare(base.raNome[b], "pt-BR"));
      opcoes(sel("ra"), ras.map((c) => [String(c), base.raNome[c]]), CAMPOS.ra[1]);
    },
    motivo: () => opcoes(sel("motivo"), base.motivos.map((m, i) => [String(i), m]), CAMPOS.motivo[1]),
    resultado: () => opcoes(sel("resultado"), RESULTADOS, CAMPOS.resultado[1]),
  };
  campos.forEach((campo) => preencher[campo]());
  const estado = () => Object.fromEntries(campos.map((c) => [c, sel(c).value]));
  const definir = (campo, valor, silencioso = false) => {
    const s = sel(campo);
    if (!s) return;
    if (campo === "ra" && valor !== "all" && sel("rs") && sel("rs").value !== "all" && base.raRegiao[valor] !== sel("rs").value) {
      sel("rs").value = "all";
      preencher.ra();
    }
    s.value = [...s.options].some((o) => o.value === String(valor)) ? String(valor) : "all";
    if (!silencioso) aoMudar?.(estado(), campo);
  };
  Object.entries(inicial).forEach(([c, v]) => { if (sel(c) && v != null) { if (c === "rs") { sel(c).value = v; preencher.ra(); } else definir(c, v, true); } });
  container.addEventListener("change", (evento) => {
    const campo = evento.target.dataset.filtro;
    if (campo === "rs" && sel("ra")) preencher.ra();
    aoMudar?.(estado(), campo);
  });
  container.querySelector(".filtro-limpar").addEventListener("click", () => {
    campos.forEach((c) => { sel(c).value = "all"; });
    if (sel("ra")) preencher.ra();
    aoMudar?.(estado(), "limpar");
  });
  return { estado, definir };
}

/** Texto curto que descreve o recorte filtrado. */
export function descreverRecorte(base, f) {
  const partes = [];
  if (f.ano && f.ano !== "all") partes.push(f.ano);
  if (f.mes && f.mes !== "all") partes.push(MESES[+f.mes - 1]);
  if (f.rs && f.rs !== "all") partes.push(`Região ${f.rs}`);
  if (f.ra && f.ra !== "all") partes.push(base.raNome[f.ra]);
  if (f.motivo && f.motivo !== "all") partes.push(base.motivos[+f.motivo]);
  if (f.resultado && f.resultado !== "all") partes.push(RESULTADOS.find(([v]) => v === f.resultado)?.[1]);
  return partes.length ? partes.join(" · ") : "Todo o período, todo o DF";
}
