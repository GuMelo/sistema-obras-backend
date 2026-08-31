import type { Pool } from "pg";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import {
  montarResultadoPaginado,
  resolverPaginacao,
  type PaginatedResult,
} from "../../lib/pagination.js";

export interface Pessoa {
  id: string;
  nome: string;
  tipoPessoa: "FISICA" | "JURIDICA";
  documento: string | null;
  telefone: string | null;
  email: string | null;
  ehResponsavelTecnico: boolean;
}

const SELECT = `
  SELECT p.id, p.nome, p.tipo_pessoa AS "tipoPessoa", p.documento, p.telefone, p.email,
         (pdp.pessoa_id IS NOT NULL) AS "ehResponsavelTecnico"
  FROM pessoas p
  LEFT JOIN pessoa_dados_profissionais pdp ON pdp.pessoa_id = p.id
`;

export async function listarPessoas(
  pool: Pool,
  filtros: { busca?: string; page?: number; pageSize?: number }
): Promise<PaginatedResult<Pessoa>> {
  const paginacao = resolverPaginacao(filtros);
  const condicoes: string[] = [];
  const params: unknown[] = [];
  if (filtros.busca) {
    params.push(`%${filtros.busca.toLowerCase()}%`);
    condicoes.push(`lower(p.nome) LIKE $${params.length}`);
  }
  const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";

  const totalRes = await pool.query<{ total: string }>(`SELECT count(*) AS total FROM pessoas p ${where}`, params);
  const dadosRes = await pool.query<Pessoa>(
    `${SELECT} ${where} ORDER BY p.nome LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, paginacao.limit, paginacao.offset]
  );
  return montarResultadoPaginado(dadosRes.rows, Number(totalRes.rows[0].total), paginacao);
}

export async function buscarPessoaPorId(pool: Pool, id: string): Promise<Pessoa> {
  const res = await pool.query<Pessoa>(`${SELECT} WHERE p.id = $1`, [id]);
  if (res.rowCount === 0) throw new NotFoundError("Pessoa", id);
  return res.rows[0];
}

export async function criarPessoa(
  pool: Pool,
  dados: { nome: string; tipoPessoa: "FISICA" | "JURIDICA"; documento?: string; telefone?: string; email?: string }
): Promise<Pessoa> {
  if (dados.documento) {
    const existente = await pool.query(`SELECT 1 FROM pessoas WHERE documento = $1`, [dados.documento]);
    if ((existente.rowCount ?? 0) > 0) {
      throw new ConflictError(`Já existe uma pessoa cadastrada com o documento ${dados.documento}.`);
    }
  }
  const res = await pool.query<{ id: string }>(
    `INSERT INTO pessoas (nome, tipo_pessoa, documento, telefone, email, atualizado_em)
     VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
    [dados.nome, dados.tipoPessoa, dados.documento ?? null, dados.telefone ?? null, dados.email ?? null]
  );
  return buscarPessoaPorId(pool, res.rows[0].id);
}

export async function atualizarPessoa(
  pool: Pool,
  id: string,
  dados: Partial<{ nome: string; telefone: string; email: string; documento: string }>
): Promise<Pessoa> {
  await buscarPessoaPorId(pool, id);
  await pool.query(
    `UPDATE pessoas SET
       nome = COALESCE($2, nome),
       telefone = COALESCE($3, telefone),
       email = COALESCE($4, email),
       documento = COALESCE($5, documento),
       atualizado_em = now()
     WHERE id = $1`,
    [id, dados.nome ?? null, dados.telefone ?? null, dados.email ?? null, dados.documento ?? null]
  );
  return buscarPessoaPorId(pool, id);
}

export interface LoteDaPessoa {
  loteId: string;
  quadraCodigo: string;
  loteNumero: number;
  papel: "TITULAR" | "COTITULAR";
}

export async function listarLotesDaPessoa(pool: Pool, pessoaId: string): Promise<LoteDaPessoa[]> {
  await buscarPessoaPorId(pool, pessoaId);
  const res = await pool.query(
    `SELECT l.id AS "loteId", q.codigo AS "quadraCodigo", l.numero AS "loteNumero", lp.papel
     FROM lote_pessoa lp JOIN lotes l ON l.id = lp.lote_id JOIN quadras q ON q.id = l.quadra_id
     WHERE lp.pessoa_id = $1 ORDER BY q.codigo, l.numero`,
    [pessoaId]
  );
  return res.rows;
}

export interface ObraDaPessoa {
  obraId: string;
  quadraCodigo: string;
  loteNumero: number;
  statusAtual: string | null;
}

export async function listarObrasDaPessoa(pool: Pool, pessoaId: string): Promise<ObraDaPessoa[]> {
  await buscarPessoaPorId(pool, pessoaId);
  const res = await pool.query(
    `SELECT o.id AS "obraId", q.codigo AS "quadraCodigo", l.numero AS "loteNumero", so.codigo AS "statusAtual"
     FROM obra_pessoa op
     JOIN obras o ON o.id = op.obra_id
     JOIN lotes l ON l.id = o.lote_id JOIN quadras q ON q.id = l.quadra_id
     LEFT JOIN obra_status_historico osh ON osh.obra_id = o.id AND osh.data_fim IS NULL
     LEFT JOIN status_obra so ON so.id = osh.status_id
     WHERE op.pessoa_id = $1 ORDER BY q.codigo, l.numero`,
    [pessoaId]
  );
  return res.rows;
}
