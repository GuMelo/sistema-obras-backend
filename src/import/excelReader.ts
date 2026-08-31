/**
 * Estágio "Excel -> Parser -> RawData".
 *
 * Único módulo do pipeline que sabe que a fonte é um arquivo .xlsx. Extrai
 * os valores de célula sem interpretar seu significado de negócio — isso é
 * responsabilidade dos estágios seguintes (validation/normalization).
 *
 * A aba lida é sempre "CONTROLE DE OBRAS E PROJETOS", com cabeçalho na
 * linha 3 (linhas 1-2 são título/célula solta) — ver documento de análise
 * de dados original. Nenhuma outra aba do arquivo é lida.
 */
import ExcelJS from "exceljs";
import type { ProblemaImportacao, RawLoteRow, RawWorkbookResult } from "./types.js";

const NOME_ABA = "CONTROLE DE OBRAS E PROJETOS";
const LINHA_CABECALHO = 3;

// Mapa coluna-esperada -> nome exato do cabeçalho na planilha de origem.
const COLUNAS_ESPERADAS: Record<keyof Omit<RawLoteRow, "linha">, string> = {
  quadra: "QUADRA",
  lote: "LOTE",
  m2: "M2",
  endereco: "ENDEREÇO",
  proprietario: "PROPRIETÁRIO",
  arquitetoEngenheiro: "ARQUITETO / ENGENHEIRO",
  status: "STATUS",
  loteApoio: "LOTE APOIO",
  dataLiberacaoObra: "DATA DE LIBERAÇÃO DA OBRA",
  vistoriaPosObra: "VISTORIA PÓS OBRA",
  liberadoParaMudanca: "LIBERADO PARA MUDANÇA?",
  dataMudanca: "DATA DA MUDANÇA",
  observacoes: "OBSERVAÇÕES",
};

function normalizarCabecalho(valor: unknown): string {
  return String(valor ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

export async function lerPlanilhaObras(caminhoArquivo: string): Promise<RawWorkbookResult> {
  const problemas: ProblemaImportacao[] = [];
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.readFile(caminhoArquivo);
  } catch (err) {
    return {
      arquivo: caminhoArquivo,
      abaEncontrada: false,
      colunasEncontradas: [],
      colunasFaltantes: Object.values(COLUNAS_ESPERADAS),
      linhas: [],
      problemas: [
        {
          severidade: "ERRO",
          codigo: "ARQUIVO_ILEGIVEL",
          mensagem: `Não foi possível ler o arquivo como planilha Excel: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    };
  }

  const planilha = workbook.getWorksheet(NOME_ABA);
  if (!planilha) {
    return {
      arquivo: caminhoArquivo,
      abaEncontrada: false,
      colunasEncontradas: [],
      colunasFaltantes: Object.values(COLUNAS_ESPERADAS),
      linhas: [],
      problemas: [
        {
          severidade: "ERRO",
          codigo: "ABA_AUSENTE",
          mensagem: `Aba "${NOME_ABA}" não encontrada no arquivo.`,
        },
      ],
    };
  }

  const linhaCabecalho = planilha.getRow(LINHA_CABECALHO);
  const indicePorCampo = new Map<keyof Omit<RawLoteRow, "linha">, number>();
  const colunasEncontradas: string[] = [];

  linhaCabecalho.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const texto = normalizarCabecalho(cell.value);
    colunasEncontradas.push(texto);
    for (const [campo, nomeEsperado] of Object.entries(COLUNAS_ESPERADAS) as Array<
      [keyof Omit<RawLoteRow, "linha">, string]
    >) {
      if (texto === nomeEsperado) {
        indicePorCampo.set(campo, colNumber);
      }
    }
  });

  const colunasFaltantes = Object.entries(COLUNAS_ESPERADAS)
    .filter(([campo]) => !indicePorCampo.has(campo as keyof Omit<RawLoteRow, "linha">))
    .map(([, nome]) => nome);

  for (const nomeColuna of colunasFaltantes) {
    problemas.push({
      severidade: "ERRO",
      codigo: "COLUNA_AUSENTE",
      mensagem: `Coluna obrigatória "${nomeColuna}" não encontrada no cabeçalho (linha ${LINHA_CABECALHO}).`,
    });
  }

  // Sem QUADRA ou LOTE não há como identificar o lote — colunas mínimas
  // para sequer tentar processar o arquivo linha a linha.
  const colunasMinimas: Array<keyof Omit<RawLoteRow, "linha">> = ["quadra", "lote"];
  const faltaColunaMinima = colunasMinimas.some((c) => !indicePorCampo.has(c));

  if (faltaColunaMinima) {
    return {
      arquivo: caminhoArquivo,
      abaEncontrada: true,
      colunasEncontradas,
      colunasFaltantes,
      linhas: [],
      problemas,
    };
  }

  const linhas: RawLoteRow[] = [];
  const getCell = (row: ExcelJS.Row, campo: keyof Omit<RawLoteRow, "linha">): unknown => {
    const idx = indicePorCampo.get(campo);
    if (idx === undefined) return null;
    const cell = row.getCell(idx);
    return cell.value;
  };

  planilha.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= LINHA_CABECALHO) return; // pula título + célula solta + cabeçalho

    linhas.push({
      linha: rowNumber,
      quadra: getCell(row, "quadra"),
      lote: getCell(row, "lote"),
      m2: getCell(row, "m2"),
      endereco: getCell(row, "endereco"),
      proprietario: getCell(row, "proprietario"),
      arquitetoEngenheiro: getCell(row, "arquitetoEngenheiro"),
      status: getCell(row, "status"),
      loteApoio: getCell(row, "loteApoio"),
      dataLiberacaoObra: getCell(row, "dataLiberacaoObra"),
      vistoriaPosObra: getCell(row, "vistoriaPosObra"),
      liberadoParaMudanca: getCell(row, "liberadoParaMudanca"),
      dataMudanca: getCell(row, "dataMudanca"),
      observacoes: getCell(row, "observacoes"),
    });
  });

  return {
    arquivo: caminhoArquivo,
    abaEncontrada: true,
    colunasEncontradas,
    colunasFaltantes,
    linhas,
    problemas,
  };
}
