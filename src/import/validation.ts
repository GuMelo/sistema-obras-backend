/**
 * Estágio "Validation". Função pura: recebe RawLoteRow[], devolve
 * ValidatedLoteRow[] — não toca banco nem arquivo.
 *
 * Responsabilidade: garantir que os tipos básicos estão corretos (QUADRA é
 * texto não vazio, LOTE é número, datas são datas válidas), detectar linhas
 * totalmente vazias (separadoras — ignoradas silenciosamente, não são erro)
 * e detectar duplicatas de (QUADRA, LOTE) dentro do próprio arquivo.
 *
 * Não decide nada sobre STATUS, PROPRIETÁRIO ou LOTE APOIO além de "é texto
 * ou está vazio" — a interpretação de negócio desses campos é dos estágios
 * de normalização/mapping.
 */
import type { ProblemaImportacao, RawLoteRow, ValidatedLoteRow } from "./types.js";

function paraTextoOuNulo(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "object" && "richText" in (valor as Record<string, unknown>)) {
    // células de texto rico do ExcelJS
    const rich = (valor as { richText: Array<{ text: string }> }).richText;
    const texto = rich.map((r) => r.text).join("");
    return texto.trim() === "" ? null : texto;
  }
  const texto = String(valor).trim();
  return texto === "" ? null : texto;
}

function paraNumeroOuNulo(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return valor;
  const texto = String(valor).trim().replace(",", ".");
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
}

function paraDataOuNulo(valor: unknown): Date | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === "string") {
    const texto = valor.trim().toUpperCase();
    if (texto === "OK" || texto === "") return null; // convenção da planilha original
    const data = new Date(texto);
    return Number.isNaN(data.getTime()) ? null : data;
  }
  return null;
}

function paraBooleanoOuNulo(valor: unknown): boolean | null {
  const texto = paraTextoOuNulo(valor);
  if (texto === null) return null;
  return texto.trim().toUpperCase() === "SIM";
}

function linhaTotalmenteVazia(raw: RawLoteRow): boolean {
  return (
    paraTextoOuNulo(raw.quadra) === null &&
    paraNumeroOuNulo(raw.lote) === null &&
    paraTextoOuNulo(raw.status) === null &&
    paraTextoOuNulo(raw.proprietario) === null
  );
}

export function validarLinhas(rawRows: RawLoteRow[]): ValidatedLoteRow[] {
  const resultado: ValidatedLoteRow[] = [];
  const chavesVistas = new Map<string, number>(); // "QUADRA|LOTE" -> primeira linha

  for (const raw of rawRows) {
    if (linhaTotalmenteVazia(raw)) {
      // Linha separadora entre blocos de quadra na planilha original — não é
      // um lote, não é erro, simplesmente não entra no resultado.
      continue;
    }

    const problemas: ProblemaImportacao[] = [];
    const quadraCodigo = paraTextoOuNulo(raw.quadra)?.toUpperCase().replace(/\s+/g, "") ?? null;
    const loteNumeroBruto = paraNumeroOuNulo(raw.lote);
    const loteNumero =
      loteNumeroBruto !== null && Number.isInteger(loteNumeroBruto) ? loteNumeroBruto : null;

    if (!quadraCodigo) {
      problemas.push({
        severidade: "ERRO",
        codigo: "QUADRA_AUSENTE",
        mensagem: "Coluna QUADRA vazia ou inválida.",
        linha: raw.linha,
      });
    }
    if (raw.lote !== null && raw.lote !== undefined && loteNumeroBruto === null) {
      problemas.push({
        severidade: "ERRO",
        codigo: "LOTE_NAO_NUMERICO",
        mensagem: `Valor de LOTE não é numérico: ${JSON.stringify(raw.lote)}.`,
        linha: raw.linha,
      });
    } else if (loteNumeroBruto !== null && !Number.isInteger(loteNumeroBruto)) {
      problemas.push({
        severidade: "ERRO",
        codigo: "LOTE_NAO_INTEIRO",
        mensagem: `Valor de LOTE não é um número inteiro: ${loteNumeroBruto}.`,
        linha: raw.linha,
      });
    } else if (loteNumero === null) {
      problemas.push({
        severidade: "ERRO",
        codigo: "LOTE_AUSENTE",
        mensagem: "Coluna LOTE vazia ou inválida.",
        linha: raw.linha,
      });
    }

    if (quadraCodigo && loteNumero !== null) {
      const chave = `${quadraCodigo}|${loteNumero}`;
      const primeiraLinha = chavesVistas.get(chave);
      if (primeiraLinha !== undefined) {
        problemas.push({
          severidade: "ERRO",
          codigo: "LOTE_DUPLICADO_NO_ARQUIVO",
          mensagem: `Combinação QUADRA+LOTE (${quadraCodigo} ${loteNumero}) já apareceu na linha ${primeiraLinha}.`,
          linha: raw.linha,
        });
      } else {
        chavesVistas.set(chave, raw.linha);
      }
    }

    const valido = !problemas.some((p) => p.severidade === "ERRO");

    resultado.push({
      linha: raw.linha,
      valido,
      quadraCodigo,
      loteNumero,
      m2: paraNumeroOuNulo(raw.m2),
      endereco: paraTextoOuNulo(raw.endereco),
      proprietarioBruto: paraTextoOuNulo(raw.proprietario),
      arquitetoEngenheiroBruto: paraTextoOuNulo(raw.arquitetoEngenheiro),
      statusBruto: paraTextoOuNulo(raw.status),
      loteApoioBruto: paraTextoOuNulo(raw.loteApoio),
      dataLiberacaoObra: paraDataOuNulo(raw.dataLiberacaoObra),
      vistoriaPosObra: paraDataOuNulo(raw.vistoriaPosObra),
      liberadoParaMudanca: paraBooleanoOuNulo(raw.liberadoParaMudanca),
      dataMudanca: paraDataOuNulo(raw.dataMudanca),
      observacoesBruto: paraTextoOuNulo(raw.observacoes),
      problemas,
    });
  }

  return resultado;
}
