import ExcelJS from "exceljs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface LinhaFixture {
  quadra?: string | null;
  lote?: number | string | null;
  m2?: number | null;
  endereco?: string | null;
  proprietario?: string | null;
  arquitetoEngenheiro?: string | null;
  status?: string | null;
  loteApoio?: string | null;
  dataLiberacaoObra?: Date | string | null;
  vistoriaPosObra?: Date | string | null;
  liberadoParaMudanca?: string | null;
  dataMudanca?: Date | string | null;
  observacoes?: string | null;
}

const CABECALHO = [
  "QUADRA",
  "LOTE",
  "M2",
  "ENDEREÇO",
  "PROPRIETÁRIO",
  "ARQUITETO / ENGENHEIRO",
  "STATUS",
  "LOTE APOIO",
  "DATA DE LIBERAÇÃO DA OBRA",
  "VISTORIA PÓS OBRA",
  "LIBERADO PARA MUDANÇA?",
  "DATA DA MUDANÇA",
  "OBSERVAÇÕES",
];

/**
 * Gera um .xlsx no mesmo formato da planilha real: título na linha 1, célula
 * solta na linha 2, cabeçalho na linha 3, dados a partir da linha 4 — na aba
 * "CONTROLE DE OBRAS E PROJETOS".
 */
export async function criarPlanilhaFixture(
  linhas: LinhaFixture[],
  opcoes: { nomeAba?: string; omitirColunas?: string[] } = {}
): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const aba = workbook.addWorksheet(opcoes.nomeAba ?? "CONTROLE DE OBRAS E PROJETOS");

  aba.getRow(1).getCell(1).value = "CONTROLE E GESTÃO - OBRAS E PROJETOS";
  aba.getRow(2).getCell(4).value = 10;

  const cabecalho = CABECALHO.filter((c) => !(opcoes.omitirColunas ?? []).includes(c));
  cabecalho.forEach((titulo, idx) => {
    aba.getRow(3).getCell(idx + 1).value = titulo;
  });

  const indice = (nomeColuna: string) => cabecalho.indexOf(nomeColuna) + 1;

  linhas.forEach((linha, i) => {
    const row = aba.getRow(4 + i);
    const set = (coluna: string, valor: unknown) => {
      const idx = indice(coluna);
      if (idx > 0) row.getCell(idx).value = valor as ExcelJS.CellValue;
    };
    set("QUADRA", linha.quadra ?? null);
    set("LOTE", linha.lote ?? null);
    set("M2", linha.m2 ?? null);
    set("ENDEREÇO", linha.endereco ?? null);
    set("PROPRIETÁRIO", linha.proprietario ?? null);
    set("ARQUITETO / ENGENHEIRO", linha.arquitetoEngenheiro ?? null);
    set("STATUS", linha.status ?? null);
    set("LOTE APOIO", linha.loteApoio ?? null);
    set("DATA DE LIBERAÇÃO DA OBRA", linha.dataLiberacaoObra ?? null);
    set("VISTORIA PÓS OBRA", linha.vistoriaPosObra ?? null);
    set("LIBERADO PARA MUDANÇA?", linha.liberadoParaMudanca ?? null);
    set("DATA DA MUDANÇA", linha.dataMudanca ?? null);
    set("OBSERVAÇÕES", linha.observacoes ?? null);
  });

  const dir = mkdtempSync(path.join(tmpdir(), "import-fixture-"));
  const caminho = path.join(dir, "fixture.xlsx");
  await workbook.xlsx.writeFile(caminho);
  return caminho;
}

export async function criarArquivoInvalido(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "import-fixture-"));
  const caminho = path.join(dir, "invalido.xlsx");
  const fs = await import("node:fs/promises");
  await fs.writeFile(caminho, "isto nao e um arquivo excel de verdade");
  return caminho;
}
