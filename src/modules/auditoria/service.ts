import type { Pool } from "pg";
import { montarResultadoPaginado, resolverPaginacao, type PaginatedResult } from "../../lib/pagination.js";

export interface AuditLogItem {
  id: string;
  entidade: string;
  entidadeId: string;
  acao: string;
  campoAlterado: string | null;
  valorAnterior: string | null;
  valorNovo: string | null;
  usuarioId: string | null;
  dataHora: string;
  observacao: string | null;
}

export async function listarAuditLogs(
  pool: Pool,
  filtros: { entidade?: string; entidadeId?: string; usuarioId?: string; page?: number; pageSize?: number }
): Promise<PaginatedResult<AuditLogItem>> {
  const paginacao = resolverPaginacao(filtros);
  const condicoes: string[] = [];
  const params: unknown[] = [];
  if (filtros.entidade) {
    params.push(filtros.entidade);
    condicoes.push(`entidade = $${params.length}`);
  }
  if (filtros.entidadeId) {
    params.push(filtros.entidadeId);
    condicoes.push(`entidade_id = $${params.length}`);
  }
  if (filtros.usuarioId) {
    params.push(filtros.usuarioId);
    condicoes.push(`usuario_id = $${params.length}`);
  }
  const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";

  const totalRes = await pool.query<{ total: string }>(`SELECT count(*) AS total FROM audit_logs ${where}`, params);
  const dadosRes = await pool.query<AuditLogItem>(
    `SELECT id, entidade, entidade_id AS "entidadeId", acao, campo_alterado AS "campoAlterado",
            valor_anterior AS "valorAnterior", valor_novo AS "valorNovo", usuario_id AS "usuarioId",
            data_hora AS "dataHora", observacao
     FROM audit_logs ${where} ORDER BY data_hora DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, paginacao.limit, paginacao.offset]
  );
  return montarResultadoPaginado(dadosRes.rows, Number(totalRes.rows[0].total), paginacao);
}
