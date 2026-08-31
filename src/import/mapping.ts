/**
 * Estágio "Mapping". Função pura: recebe NormalizedLoteRow[] + o catálogo de
 * status já carregado do banco (StatusObraLegacyMap), devolve
 * MappedLoteRow[]. Não faz nenhuma consulta a banco aqui — o catálogo é
 * injetado, o que mantém este estágio testável sem conexão real.
 *
 * Regra (ver REVISAO_MODELO_DOMINIO.md seção 5): o texto de STATUS da
 * planilha mistura três dimensões diferentes. Este estágio decide qual:
 *   - "MORADOR"          -> OCUPACAO_MORADOR (não é status de obra)
 *   - "LOTE EM ALERTA"    -> ALERTA (vira Lote.emAlerta, não status de obra)
 *   - vazio               -> VAZIO (nada é inferido — nunca vira "disponível")
 *   - qualquer outro texto -> procurado no catálogo de mapeamento legado;
 *     se não encontrado, DESCONHECIDO (AVISO, nada é inventado).
 */
import type { CatalogoStatusObra, MappedLoteRow, NormalizedLoteRow, ProblemaImportacao } from "./types.js";

function normalizarValorOrigem(texto: string): string {
  return texto.trim().replace(/\s+/g, " ");
}

export function mapearStatus(
  statusBruto: string | null,
  catalogo: CatalogoStatusObra
): { tipo: MappedLoteRow["statusMapeado"]["tipo"]; statusObraCodigo: string | null } {
  if (statusBruto === null) {
    return { tipo: "VAZIO", statusObraCodigo: null };
  }

  const normalizado = normalizarValorOrigem(statusBruto).toUpperCase();

  if (normalizado === "MORADOR") {
    return { tipo: "OCUPACAO_MORADOR", statusObraCodigo: null };
  }
  if (normalizado === "LOTE EM ALERTA") {
    return { tipo: "ALERTA", statusObraCodigo: null };
  }

  // Mapeamento legado é indexado pelo texto ORIGINAL (com case/espaço tal
  // qual apareciam na planilha), então buscamos com o texto normalizado só
  // por espaços, preservando maiúsculas/minúsculas originais na chave —
  // mas o catálogo em si já foi carregado com suas chaves normalizadas do
  // mesmo jeito (ver persistence.ts: carregarCatalogoStatusObra).
  const chave = normalizarValorOrigem(statusBruto);
  const codigoCanonico = catalogo.porValorOrigem.get(chave);

  if (codigoCanonico) {
    return { tipo: "OBRA_STATUS", statusObraCodigo: codigoCanonico };
  }

  return { tipo: "DESCONHECIDO", statusObraCodigo: null };
}

export function mapearLinhas(
  normalizadas: NormalizedLoteRow[],
  catalogo: CatalogoStatusObra
): MappedLoteRow[] {
  return normalizadas.map((linha) => {
    const statusMapeado = mapearStatus(linha.statusBruto, catalogo);
    const problemas: ProblemaImportacao[] = [...linha.problemas];

    if (statusMapeado.tipo === "DESCONHECIDO") {
      problemas.push({
        severidade: "AVISO",
        codigo: "STATUS_DESCONHECIDO",
        mensagem: `Status "${linha.statusBruto}" não consta no mapeamento legado. Nenhum status de obra foi atribuído — revisar manualmente.`,
        linha: linha.linha,
        dadosOriginais: linha.statusBruto ?? undefined,
      });
    }

    return { ...linha, statusMapeado, problemas };
  });
}
