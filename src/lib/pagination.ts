import { ValidationAppError } from "./errors.js";

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

export interface PaginationResolved {
  page: number;
  pageSize: number;
  offset: number;
  limit: number;
}

const PAGE_SIZE_PADRAO = 20;
const PAGE_SIZE_MAXIMO = 100;

export function resolverPaginacao(query: PaginationQuery): PaginationResolved {
  const page = query.page && query.page > 0 ? Math.floor(query.page) : 1;
  const pageSizeBruto = query.pageSize && query.pageSize > 0 ? Math.floor(query.pageSize) : PAGE_SIZE_PADRAO;
  const pageSize = Math.min(pageSizeBruto, PAGE_SIZE_MAXIMO);
  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}

export interface PaginatedResult<T> {
  dados: T[];
  paginacao: {
    page: number;
    pageSize: number;
    total: number;
    totalPaginas: number;
  };
}

export function montarResultadoPaginado<T>(
  dados: T[],
  total: number,
  resolvido: PaginationResolved
): PaginatedResult<T> {
  return {
    dados,
    paginacao: {
      page: resolvido.page,
      pageSize: resolvido.pageSize,
      total,
      totalPaginas: Math.max(1, Math.ceil(total / resolvido.pageSize)),
    },
  };
}

/**
 * Resolve um parâmetro `sort` (ex.: "numero", "-criadoEm") contra uma lista
 * de colunas permitidas, devolvendo SQL seguro (nunca interpola o valor cru
 * do usuário na query). Lança ValidationAppError se a coluna não for
 * reconhecida — nunca ordena silenciosamente por algo não pedido.
 */
export function resolverOrdenacao(
  sort: string | undefined,
  colunasPermitidas: Record<string, string>,
  padrao: string
): string {
  if (!sort) return padrao;
  const decrescente = sort.startsWith("-");
  const chave = decrescente ? sort.slice(1) : sort;
  const coluna = colunasPermitidas[chave];
  if (!coluna) {
    throw new ValidationAppError(
      `Campo de ordenação inválido: "${chave}". Válidos: ${Object.keys(colunasPermitidas).join(", ")}.`
    );
  }
  return `${coluna} ${decrescente ? "DESC" : "ASC"}`;
}
