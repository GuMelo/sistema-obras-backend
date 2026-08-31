import bcrypt from "bcryptjs";
import type { Pool } from "pg";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import {
  montarResultadoPaginado,
  resolverOrdenacao,
  resolverPaginacao,
  type PaginatedResult,
} from "../../lib/pagination.js";
import type { RoleUsuario } from "../../plugins/auth.js";

export interface UsuarioPublico {
  id: string;
  nome: string;
  email: string;
  role: RoleUsuario;
  ativo: boolean;
  criadoEm: string;
}

const COLUNAS_ORDENACAO: Record<string, string> = {
  nome: "nome",
  email: "email",
  criadoEm: "criado_em",
};

export async function listarUsuarios(
  pool: Pool,
  filtros: { role?: RoleUsuario; ativo?: boolean; page?: number; pageSize?: number; sort?: string }
): Promise<PaginatedResult<UsuarioPublico>> {
  const paginacao = resolverPaginacao(filtros);
  const ordenacao = resolverOrdenacao(filtros.sort, COLUNAS_ORDENACAO, "nome ASC");

  const condicoes: string[] = [];
  const params: unknown[] = [];
  if (filtros.role) {
    params.push(filtros.role);
    condicoes.push(`role = $${params.length}`);
  }
  if (filtros.ativo !== undefined) {
    params.push(filtros.ativo);
    condicoes.push(`ativo = $${params.length}`);
  }
  const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";

  const totalRes = await pool.query<{ total: string }>(`SELECT count(*) AS total FROM usuarios ${where}`, params);
  const dadosRes = await pool.query<{
    id: string;
    nome: string;
    email: string;
    role: RoleUsuario;
    ativo: boolean;
    criado_em: string;
  }>(
    `SELECT id, nome, email, role, ativo, criado_em FROM usuarios ${where}
     ORDER BY ${ordenacao} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, paginacao.limit, paginacao.offset]
  );

  return montarResultadoPaginado(
    dadosRes.rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      email: r.email,
      role: r.role,
      ativo: r.ativo,
      criadoEm: r.criado_em,
    })),
    Number(totalRes.rows[0].total),
    paginacao
  );
}

export async function buscarUsuarioPorId(pool: Pool, id: string): Promise<UsuarioPublico> {
  const res = await pool.query(
    `SELECT id, nome, email, role, ativo, criado_em FROM usuarios WHERE id = $1`,
    [id]
  );
  if (res.rowCount === 0) throw new NotFoundError("Usuário", id);
  const r = res.rows[0];
  return { id: r.id, nome: r.nome, email: r.email, role: r.role, ativo: r.ativo, criadoEm: r.criado_em };
}

export async function criarUsuario(
  pool: Pool,
  dados: { nome: string; email: string; senha: string; role: RoleUsuario }
): Promise<UsuarioPublico> {
  const existente = await pool.query(`SELECT 1 FROM usuarios WHERE email = $1`, [dados.email]);
  if ((existente.rowCount ?? 0) > 0) {
    throw new ConflictError(`Já existe um usuário com o e-mail ${dados.email}.`);
  }

  const senhaHash = await bcrypt.hash(dados.senha, 10);
  const res = await pool.query(
    `INSERT INTO usuarios (nome, email, senha_hash, role, atualizado_em)
     VALUES ($1, $2, $3, $4, now())
     RETURNING id, nome, email, role, ativo, criado_em`,
    [dados.nome, dados.email, senhaHash, dados.role]
  );
  const r = res.rows[0];
  return { id: r.id, nome: r.nome, email: r.email, role: r.role, ativo: r.ativo, criadoEm: r.criado_em };
}

export async function atualizarUsuario(
  pool: Pool,
  id: string,
  dados: Partial<{ nome: string; role: RoleUsuario; ativo: boolean; senha: string }>
): Promise<UsuarioPublico> {
  await buscarUsuarioPorId(pool, id); // 404 se não existir

  const senhaHash = dados.senha ? await bcrypt.hash(dados.senha, 10) : null;

  await pool.query(
    `UPDATE usuarios SET
       nome = COALESCE($2, nome),
       role = COALESCE($3, role),
       ativo = COALESCE($4, ativo),
       senha_hash = COALESCE($5, senha_hash),
       atualizado_em = now()
     WHERE id = $1`,
    [id, dados.nome ?? null, dados.role ?? null, dados.ativo ?? null, senhaHash]
  );

  return buscarUsuarioPorId(pool, id);
}
