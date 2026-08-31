import type { Pool } from "pg";
import { ConflictError, NotFoundError } from "../../lib/errors.js";

export interface Condominio {
  id: string;
  nome: string;
  cnpj: string | null;
  endereco: string | null;
}

export async function listarCondominios(pool: Pool): Promise<Condominio[]> {
  const res = await pool.query(`SELECT id, nome, cnpj, endereco FROM condominios ORDER BY nome`);
  return res.rows;
}

export async function buscarCondominioPorId(pool: Pool, id: string): Promise<Condominio> {
  const res = await pool.query(`SELECT id, nome, cnpj, endereco FROM condominios WHERE id = $1`, [id]);
  if (res.rowCount === 0) throw new NotFoundError("Condomínio", id);
  return res.rows[0];
}

export async function criarCondominio(
  pool: Pool,
  dados: { nome: string; cnpj?: string | null; endereco?: string | null }
): Promise<Condominio> {
  const existente = await pool.query(`SELECT 1 FROM condominios WHERE nome = $1`, [dados.nome]);
  if ((existente.rowCount ?? 0) > 0) {
    throw new ConflictError(`Já existe um condomínio chamado "${dados.nome}".`);
  }
  const res = await pool.query(
    `INSERT INTO condominios (nome, cnpj, endereco, atualizado_em) VALUES ($1, $2, $3, now())
     RETURNING id, nome, cnpj, endereco`,
    [dados.nome, dados.cnpj ?? null, dados.endereco ?? null]
  );
  return res.rows[0];
}

export async function atualizarCondominio(
  pool: Pool,
  id: string,
  dados: Partial<{ nome: string; cnpj: string | null; endereco: string | null }>
): Promise<Condominio> {
  await buscarCondominioPorId(pool, id);
  await pool.query(
    `UPDATE condominios SET
       nome = COALESCE($2, nome),
       cnpj = COALESCE($3, cnpj),
       endereco = COALESCE($4, endereco),
       atualizado_em = now()
     WHERE id = $1`,
    [id, dados.nome ?? null, dados.cnpj ?? null, dados.endereco ?? null]
  );
  return buscarCondominioPorId(pool, id);
}
