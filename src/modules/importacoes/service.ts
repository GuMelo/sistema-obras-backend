import type { Pool } from "pg";
import { NotFoundError } from "../../lib/errors.js";
import { montarResultadoPaginado, resolverPaginacao, type PaginatedResult } from "../../lib/pagination.js";

export interface ImportacaoResumo {
  id: string;
  origem: string;
  status: string;
  totalLinhas: number | null;
  linhasComSucesso: number | null;
  linhasComErro: number | null;
  iniciadoEm: string;
  finalizadoEm: string | null;
}

export async function listarImportacoes(
  pool: Pool,
  filtros: { page?: number; pageSize?: number }
): Promise<PaginatedResult<ImportacaoResumo>> {
  const paginacao = resolverPaginacao(filtros);
  const totalRes = await pool.query<{ total: string }>(`SELECT count(*) AS total FROM importacao_execucoes`);
  const dadosRes = await pool.query<ImportacaoResumo>(
    `SELECT id, origem, status, total_linhas AS "totalLinhas", linhas_com_sucesso AS "linhasComSucesso",
            linhas_com_erro AS "linhasComErro", iniciado_em AS "iniciadoEm", finalizado_em AS "finalizadoEm"
     FROM importacao_execucoes ORDER BY iniciado_em DESC LIMIT $1 OFFSET $2`,
    [paginacao.limit, paginacao.offset]
  );
  return montarResultadoPaginado(dadosRes.rows, Number(totalRes.rows[0].total), paginacao);
}

export interface ImportacaoDetalhe extends ImportacaoResumo {
  erros: Array<{ linha: number | null; mensagem: string; dadosOriginais: string | null }>;
}

export async function buscarImportacaoPorId(pool: Pool, id: string): Promise<ImportacaoDetalhe> {
  const res = await pool.query(
    `SELECT id, origem, status, total_linhas AS "totalLinhas", linhas_com_sucesso AS "linhasComSucesso",
            linhas_com_erro AS "linhasComErro", iniciado_em AS "iniciadoEm", finalizado_em AS "finalizadoEm"
     FROM importacao_execucoes WHERE id = $1`,
    [id]
  );
  if (res.rowCount === 0) throw new NotFoundError("Importação", id);

  const erros = await pool.query(
    `SELECT linha, mensagem, dados_originais AS "dadosOriginais" FROM importacao_erros
     WHERE importacao_id = $1 ORDER BY linha NULLS FIRST`,
    [id]
  );

  return { ...res.rows[0], erros: erros.rows };
}

export interface ImportacaoErroItem {
  id: string;
  linha: number | null;
  mensagem: string;
}

export async function listarErrosImportacao(pool: Pool, importacaoId: string): Promise<ImportacaoErroItem[]> {
  const importacao = await pool.query(`SELECT 1 FROM importacao_execucoes WHERE id = $1`, [importacaoId]);
  if (importacao.rowCount === 0) throw new NotFoundError("Importação", importacaoId);

  const erros = await pool.query<ImportacaoErroItem>(
    `SELECT id, linha, mensagem FROM importacao_erros
     WHERE importacao_id = $1 ORDER BY linha NULLS FIRST`,
    [importacaoId]
  );
  return erros.rows;
}
