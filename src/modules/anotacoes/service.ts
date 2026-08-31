import type { Pool } from "pg";
import { NotFoundError, ValidationAppError } from "../../lib/errors.js";
import { montarResultadoPaginado, resolverPaginacao, type PaginatedResult } from "../../lib/pagination.js";

export interface Anotacao {
  id: string;
  loteId: string | null;
  obraId: string | null;
  data: string;
  texto: string;
  autor: string | null;
  origem: "MANUAL" | "IMPORTACAO_LEGADO";
}

export async function listarAnotacoes(
  pool: Pool,
  filtros: { loteId?: string; obraId?: string; page?: number; pageSize?: number }
): Promise<PaginatedResult<Anotacao>> {
  const paginacao = resolverPaginacao(filtros);
  const condicoes: string[] = [];
  const params: unknown[] = [];
  if (filtros.loteId) {
    params.push(filtros.loteId);
    condicoes.push(`lote_id = $${params.length}`);
  }
  if (filtros.obraId) {
    params.push(filtros.obraId);
    condicoes.push(`obra_id = $${params.length}`);
  }
  const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";

  const totalRes = await pool.query<{ total: string }>(`SELECT count(*) AS total FROM anotacoes ${where}`, params);
  const dadosRes = await pool.query<Anotacao>(
    `SELECT id, lote_id AS "loteId", obra_id AS "obraId", data, texto, autor, origem
     FROM anotacoes ${where} ORDER BY data DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, paginacao.limit, paginacao.offset]
  );

  return montarResultadoPaginado(dadosRes.rows, Number(totalRes.rows[0].total), paginacao);
}

export async function criarAnotacao(
  pool: Pool,
  dados: { loteId?: string; obraId?: string; texto: string; autor?: string | null }
): Promise<Anotacao> {
  if ((dados.loteId ? 1 : 0) + (dados.obraId ? 1 : 0) !== 1) {
    throw new ValidationAppError("Informe exatamente um entre loteId e obraId.");
  }

  if (dados.loteId) {
    const existe = await pool.query(`SELECT 1 FROM lotes WHERE id = $1`, [dados.loteId]);
    if (existe.rowCount === 0) throw new NotFoundError("Lote", dados.loteId);
  }
  if (dados.obraId) {
    const existe = await pool.query(`SELECT 1 FROM obras WHERE id = $1`, [dados.obraId]);
    if (existe.rowCount === 0) throw new NotFoundError("Obra", dados.obraId);
  }

  const res = await pool.query<Anotacao>(
    `INSERT INTO anotacoes (lote_id, obra_id, data, texto, autor, origem)
     VALUES ($1, $2, now(), $3, $4, 'MANUAL')
     RETURNING id, lote_id AS "loteId", obra_id AS "obraId", data, texto, autor, origem`,
    [dados.loteId ?? null, dados.obraId ?? null, dados.texto, dados.autor ?? null]
  );
  return res.rows[0];
}

export async function buscarAnotacaoPorId(pool: Pool, id: string): Promise<Anotacao> {
  const res = await pool.query<Anotacao>(
    `SELECT id, lote_id AS "loteId", obra_id AS "obraId", data, texto, autor, origem FROM anotacoes WHERE id = $1`,
    [id]
  );
  if (res.rowCount === 0) throw new NotFoundError("Anotação", id);
  return res.rows[0];
}
