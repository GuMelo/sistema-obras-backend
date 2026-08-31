import { describe, it, expect } from "vitest";
import { validarLinhas } from "../../src/import/validation.js";
import { normalizarLinhas } from "../../src/import/normalization.js";
import { mapearLinhas } from "../../src/import/mapping.js";
import type { CatalogoStatusObra, RawLoteRow } from "../../src/import/types.js";

function rawRow(overrides: Partial<RawLoteRow> = {}): RawLoteRow {
  return {
    linha: 4,
    quadra: "A2",
    lote: 1,
    m2: 250,
    endereco: null,
    proprietario: null,
    arquitetoEngenheiro: null,
    status: null,
    loteApoio: null,
    dataLiberacaoObra: null,
    vistoriaPosObra: null,
    liberadoParaMudanca: null,
    dataMudanca: null,
    observacoes: null,
    ...overrides,
  };
}

describe("validation", () => {
  it("marca linha totalmente vazia como ignorada silenciosamente (não é erro)", () => {
    const linhas = validarLinhas([
      rawRow({ quadra: null, lote: null, m2: null, status: null, proprietario: null }),
    ]);
    expect(linhas).toHaveLength(0);
  });

  it("marca linha sem QUADRA como inválida", () => {
    const [linha] = validarLinhas([rawRow({ quadra: null, status: "MORADOR" })]);
    expect(linha.valido).toBe(false);
    expect(linha.problemas.some((p) => p.codigo === "QUADRA_AUSENTE")).toBe(true);
  });

  it("marca linha com LOTE não numérico como inválida", () => {
    const [linha] = validarLinhas([rawRow({ lote: "abc" })]);
    expect(linha.valido).toBe(false);
    expect(linha.problemas.some((p) => p.codigo === "LOTE_NAO_NUMERICO")).toBe(true);
  });

  it("detecta lote duplicado dentro do próprio arquivo", () => {
    const linhas = validarLinhas([
      rawRow({ linha: 4, quadra: "A2", lote: 1 }),
      rawRow({ linha: 5, quadra: "A2", lote: 1 }),
    ]);
    expect(linhas[0].valido).toBe(true);
    expect(linhas[1].valido).toBe(false);
    expect(linhas[1].problemas.some((p) => p.codigo === "LOTE_DUPLICADO_NO_ARQUIVO")).toBe(true);
  });

  it("aceita 'OK' como ausência de data (convenção da planilha original)", () => {
    const [linha] = validarLinhas([rawRow({ dataLiberacaoObra: "OK" })]);
    expect(linha.dataLiberacaoObra).toBeNull();
  });
});

describe("normalization", () => {
  it("não separa nome de proprietário com conjunção ambígua ' E '", () => {
    const validas = validarLinhas([
      rawRow({ proprietario: "SHIRLEY CUNHA DOS SANTOS E CLAYTON PAULO CALIARI" }),
    ]);
    const [linha] = normalizarLinhas(validas);
    expect(linha.proprietarios).toHaveLength(0);
    expect(linha.proprietarioNaoSeparado).toBe(
      "SHIRLEY CUNHA DOS SANTOS E CLAYTON PAULO CALIARI"
    );
    expect(linha.problemas.some((p) => p.codigo === "PROPRIETARIO_NAO_SEPARADO")).toBe(true);
  });

  it("separa nome de proprietário com '/' de forma segura", () => {
    const validas = validarLinhas([rawRow({ proprietario: "Jocasta / Leonardo Demartini" })]);
    const [linha] = normalizarLinhas(validas);
    expect(linha.proprietarios.map((p) => p.nome)).toEqual(["Jocasta", "Leonardo Demartini"]);
    expect(linha.proprietarioNaoSeparado).toBeNull();
  });

  it("não resolve código de lote de apoio realmente ambíguo (texto solto)", () => {
    const validas = validarLinhas([rawRow({ loteApoio: "OK" })]);
    const [linha] = normalizarLinhas(validas);
    expect(linha.loteApoioResolvidos).toHaveLength(0);
    expect(linha.loteApoioNaoResolvidos).toEqual(["OK"]);
  });

  it("resolve código de lote de apoio em formato reconhecido (ex.: 'H2 05')", () => {
    const validas = validarLinhas([rawRow({ loteApoio: "H2 05" })]);
    const [linha] = normalizarLinhas(validas);
    expect(linha.loteApoioResolvidos).toEqual([{ quadraCodigo: "H2", loteNumero: 5 }]);
  });

  it("resolve código de lote de apoio no formato QUADRA2/LOTE (padrão atual da planilha)", () => {
    const casos: Array<[string, { quadraCodigo: string; loteNumero: number }]> = [
      ["J2/28", { quadraCodigo: "J2", loteNumero: 28 }],
      ["G2/2", { quadraCodigo: "G2", loteNumero: 2 }],
      ["L2/20", { quadraCodigo: "L2", loteNumero: 20 }],
    ];
    for (const [bruto, esperado] of casos) {
      const validas = validarLinhas([rawRow({ loteApoio: bruto })]);
      const [linha] = normalizarLinhas(validas);
      expect(linha.loteApoioResolvidos).toEqual([esperado]);
    }
  });

  it("resolve múltiplos códigos com barra na mesma célula (separados por vírgula)", () => {
    const validas = validarLinhas([rawRow({ loteApoio: "D2/2, D2/11, D2/12" })]);
    const [linha] = normalizarLinhas(validas);
    expect(linha.loteApoioResolvidos).toEqual([
      { quadraCodigo: "D2", loteNumero: 2 },
      { quadraCodigo: "D2", loteNumero: 11 },
      { quadraCodigo: "D2", loteNumero: 12 },
    ]);
  });

  it("não resolve código sem separador entre quadra e lote (ambíguo por construção)", () => {
    // "J28" pode ser quadra J2 + lote 8 OU quadra J2 (abreviada) + lote 28 —
    // sem separador não há como saber qual. Uma versão anterior tentava
    // adivinhar esse segundo caso e chegou a interpretar "J28" como lote 8
    // quando a intenção real era lote 28 (ver histórico). A planilha atual
    // sempre usa "/" (ex.: "J2/28"), então isso nunca deveria mais aparecer
    // como código real — mas se aparecer, fica em loteApoioNaoResolvidos
    // para revisão humana em vez de adivinhar.
    const validas = validarLinhas([rawRow({ loteApoio: "J28" })]);
    const [linha] = normalizarLinhas(validas);
    expect(linha.loteApoioResolvidos).toHaveLength(0);
    expect(linha.loteApoioNaoResolvidos).toEqual(["J28"]);
  });

  it("sinaliza status vazio com proprietário já preenchido", () => {
    const validas = validarLinhas([rawRow({ proprietario: "Fulano", status: null })]);
    const [linha] = normalizarLinhas(validas);
    expect(linha.problemas.some((p) => p.codigo === "STATUS_VAZIO_COM_PROPRIETARIO")).toBe(true);
  });

  it("mantém o prefixo 'ARQ.'/'ENG.' no nome do responsável técnico, só colapsando espaços", () => {
    const validas = validarLinhas([
      rawRow({ arquitetoEngenheiro: "ARQ.  MARCELO JOSÉ OHIRA / ENG.  BRUNO MESQUITA" }),
    ]);
    const [linha] = normalizarLinhas(validas);
    expect(linha.responsaveisTecnicos.map((p) => p.nome)).toEqual(["ARQ. MARCELO JOSÉ OHIRA", "ENG. BRUNO MESQUITA"]);
    expect(linha.responsaveisTecnicos.map((p) => p.tipoProfissionalSugerido)).toEqual(["ARQUITETO", "ENGENHEIRO"]);
  });

  it("mantém o prefixo por extenso ('Arquiteto'/'Engenheiro') no nome do responsável técnico", () => {
    const validas = validarLinhas([
      rawRow({ arquitetoEngenheiro: "Arquiteto Fernando Manzonni/ Engenheiro Brian" }),
    ]);
    const [linha] = normalizarLinhas(validas);
    expect(linha.responsaveisTecnicos.map((p) => p.nome)).toEqual(["Arquiteto Fernando Manzonni", "Engenheiro Brian"]);
    expect(linha.responsaveisTecnicos.map((p) => p.tipoProfissionalSugerido)).toEqual(["ARQUITETO", "ENGENHEIRO"]);
  });
});

describe("mapping (status legado -> canônico)", () => {
  const catalogo: CatalogoStatusObra = {
    porValorOrigem: new Map([
      ["EM ANÁLISE", "EM_ANALISE"],
      ["EM ANALISE", "EM_ANALISE"],
      ["OBRA LIBERADA", "LIBERADA"],
    ]),
  };

  it("mapeia MORADOR para ocupação, não para status de obra", () => {
    const validas = validarLinhas([rawRow({ status: "MORADOR" })]);
    const [mapeada] = mapearLinhas(normalizarLinhas(validas), catalogo);
    expect(mapeada.statusMapeado.tipo).toBe("OCUPACAO_MORADOR");
  });

  it("mapeia 'LOTE EM ALERTA' para alerta, não para status de obra", () => {
    const validas = validarLinhas([rawRow({ status: "LOTE EM ALERTA" })]);
    const [mapeada] = mapearLinhas(normalizarLinhas(validas), catalogo);
    expect(mapeada.statusMapeado.tipo).toBe("ALERTA");
  });

  it("resolve um status conhecido do catálogo legado", () => {
    const validas = validarLinhas([rawRow({ status: "EM ANÁLISE" })]);
    const [mapeada] = mapearLinhas(normalizarLinhas(validas), catalogo);
    expect(mapeada.statusMapeado.tipo).toBe("OBRA_STATUS");
    expect(mapeada.statusMapeado.statusObraCodigo).toBe("EM_ANALISE");
  });

  it("marca status desconhecido como AVISO, sem inventar correspondência", () => {
    const validas = validarLinhas([rawRow({ status: "SITUAÇÃO ESTRANHA XYZ" })]);
    const [mapeada] = mapearLinhas(normalizarLinhas(validas), catalogo);
    expect(mapeada.statusMapeado.tipo).toBe("DESCONHECIDO");
    expect(mapeada.problemas.some((p) => p.codigo === "STATUS_DESCONHECIDO")).toBe(true);
  });

  it("não infere status para célula vazia", () => {
    const validas = validarLinhas([rawRow({ status: null, proprietario: null })]);
    const [mapeada] = mapearLinhas(normalizarLinhas(validas), catalogo);
    expect(mapeada.statusMapeado.tipo).toBe("VAZIO");
  });
});
