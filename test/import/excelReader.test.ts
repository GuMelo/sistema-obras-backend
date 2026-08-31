import { describe, it, expect } from "vitest";
import { lerPlanilhaObras } from "../../src/import/excelReader.js";
import { criarPlanilhaFixture, criarArquivoInvalido } from "./helpers.js";

describe("excelReader — planilha válida / inválida", () => {
  it("lê uma planilha válida corretamente", async () => {
    const caminho = await criarPlanilhaFixture([
      { quadra: "A2", lote: 1, status: "MORADOR", proprietario: "Fulano de Tal" },
      { quadra: "A2", lote: 2, status: "EM ANÁLISE" },
    ]);

    const resultado = await lerPlanilhaObras(caminho);

    expect(resultado.abaEncontrada).toBe(true);
    expect(resultado.colunasFaltantes).toHaveLength(0);
    expect(resultado.linhas).toHaveLength(2);
    expect(resultado.problemas).toHaveLength(0);
  });

  it("rejeita um arquivo que não é um Excel válido", async () => {
    const caminho = await criarArquivoInvalido();

    const resultado = await lerPlanilhaObras(caminho);

    expect(resultado.abaEncontrada).toBe(false);
    expect(resultado.problemas.some((p) => p.codigo === "ARQUIVO_ILEGIVEL")).toBe(true);
  });

  it("detecta aba ausente", async () => {
    const caminho = await criarPlanilhaFixture([{ quadra: "A2", lote: 1 }], {
      nomeAba: "Aba Errada",
    });

    const resultado = await lerPlanilhaObras(caminho);

    expect(resultado.abaEncontrada).toBe(false);
    expect(resultado.problemas.some((p) => p.codigo === "ABA_AUSENTE")).toBe(true);
  });

  it("detecta coluna obrigatória ausente", async () => {
    const caminho = await criarPlanilhaFixture([{ quadra: "A2", lote: 1 }], {
      omitirColunas: ["QUADRA"],
    });

    const resultado = await lerPlanilhaObras(caminho);

    expect(resultado.abaEncontrada).toBe(true);
    expect(resultado.colunasFaltantes).toContain("QUADRA");
    expect(resultado.problemas.some((p) => p.codigo === "COLUNA_AUSENTE")).toBe(true);
    // Sem QUADRA nem LOTE não há como processar linha nenhuma com segurança.
    expect(resultado.linhas).toHaveLength(0);
  });

  it("tolera coluna não-crítica ausente (ex.: OBSERVAÇÕES) e continua lendo as linhas", async () => {
    const caminho = await criarPlanilhaFixture([{ quadra: "A2", lote: 1 }], {
      omitirColunas: ["OBSERVAÇÕES"],
    });

    const resultado = await lerPlanilhaObras(caminho);

    expect(resultado.colunasFaltantes).toContain("OBSERVAÇÕES");
    expect(resultado.linhas).toHaveLength(1);
  });
});
