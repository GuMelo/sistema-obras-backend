import type { Pool } from "pg";
import { ConflictError, NotFoundError } from "../../lib/errors.js";

export interface Quadra {
  id: string;
  condominioId: string;
  codigo: string;
}

export async function listarQuadras(pool: Pool, condominioId?: string): Promise<Quadra[]> {
  const params: unknown[] = [];
  let where = "";
  if (condominioId) {
    params.push(condominioId);
    where = `WHERE condominio_id = $1`;
  }
  const res = await pool.query(
    `SELECT id, condominio_id AS "condominioId", codigo FROM quadras ${where} ORDER BY codigo`,
    params
  );
  return res.rows;
}

export async function buscarQuadraPorId(pool: Pool, id: string): Promise<Quadra> {
  const res = await pool.query(
    `SELECT id, condominio_id AS "condominioId", codigo FROM quadras WHERE id = $1`,
    [id]
  );
  if (res.rowCount === 0) throw new NotFoundError("Quadra", id);
  return res.rows[0];
}

export async function criarQuadra(pool: Pool, dados: { condominioId: string; codigo: string }): Promise<Quadra> {
  const condominio = await pool.query(`SELECT 1 FROM condominios WHERE id = $1`, [dados.condominioId]);
  if (condominio.rowCount === 0) throw new NotFoundError("Condomínio", dados.condominioId);

  const existente = await pool.query(`SELECT 1 FROM quadras WHERE condominio_id = $1 AND codigo = $2`, [
    dados.condominioId,
    dados.codigo,
  ]);
  if ((existente.rowCount ?? 0) > 0) {
    throw new ConflictError(`Já existe uma quadra "${dados.codigo}" neste condomínio.`);
  }

  const res = await pool.query(
    `INSERT INTO quadras (condominio_id, codigo, atualizado_em) VALUES ($1, $2, now())
     RETURNING id, condominio_id AS "condominioId", codigo`,
    [dados.condominioId, dados.codigo]
  );
  return res.rows[0];
}
