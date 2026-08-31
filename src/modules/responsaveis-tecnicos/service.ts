import type { Pool } from "pg";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { montarResultadoPaginado, resolverPaginacao, type PaginatedResult } from "../../lib/pagination.js";

export interface ResponsavelTecnico {
  pessoaId: string;
  nome: string;
  tipo: string | null;
  registroProfissional: string | null;
  telefone: string | null;
  email: string | null;
  totalObras: number;
}

const SELECT = `
  SELECT p.id AS "pessoaId", p.nome, pdp.tipo, pdp.registro_profissional AS "registroProfissional",
         p.telefone, p.email,
         (SELECT count(*)::int FROM obra_pessoa op WHERE op.pessoa_id = p.id) AS "totalObras"
  FROM pessoa_dados_profissionais pdp
  JOIN pessoas p ON p.id = pdp.pessoa_id
`;

export async function listarResponsaveisTecnicos(
  pool: Pool,
  filtros: { busca?: string; page?: number; pageSize?: number }
): Promise<PaginatedResult<ResponsavelTecnico>> {
  const paginacao = resolverPaginacao(filtros);
  const condicoes: string[] = [];
  const params: unknown[] = [];
  if (filtros.busca) {
    params.push(`%${filtros.busca.toLowerCase()}%`);
    condicoes.push(`lower(p.nome) LIKE $${params.length}`);
  }
  const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";

  const totalRes = await pool.query<{ total: string }>(
    `SELECT count(*) AS total FROM pessoa_dados_profissionais pdp JOIN pessoas p ON p.id = pdp.pessoa_id ${where}`,
    params
  );
  const dadosRes = await pool.query<ResponsavelTecnico>(
    `${SELECT} ${where} ORDER BY p.nome LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, paginacao.limit, paginacao.offset]
  );
  return montarResultadoPaginado(dadosRes.rows, Number(totalRes.rows[0].total), paginacao);
}

export async function buscarResponsavelTecnicoPorId(pool: Pool, pessoaId: string): Promise<ResponsavelTecnico> {
  const res = await pool.query<ResponsavelTecnico>(`${SELECT} WHERE p.id = $1`, [pessoaId]);
  if (res.rowCount === 0) throw new NotFoundError("Responsável técnico", pessoaId);
  return res.rows[0];
}

/** "Promove" uma Pessoa já existente a responsável técnico (cria a extensão
 * 1:1 `PessoaDadosProfissionais`) — não cria uma Pessoa nova, evitando
 * duplicar quem já é proprietário e agora também atua como técnico. */
export async function tornarResponsavelTecnico(
  pool: Pool,
  pessoaId: string,
  dados: { tipo?: string; registroProfissional?: string }
): Promise<ResponsavelTecnico> {
  const pessoa = await pool.query(`SELECT 1 FROM pessoas WHERE id = $1`, [pessoaId]);
  if (pessoa.rowCount === 0) throw new NotFoundError("Pessoa", pessoaId);

  if (dados.registroProfissional) {
    const existente = await pool.query(
      `SELECT 1 FROM pessoa_dados_profissionais WHERE registro_profissional = $1 AND pessoa_id <> $2`,
      [dados.registroProfissional, pessoaId]
    );
    if ((existente.rowCount ?? 0) > 0) {
      throw new ConflictError(`Já existe outro responsável técnico com o registro ${dados.registroProfissional}.`);
    }
  }

  await pool.query(
    `INSERT INTO pessoa_dados_profissionais (pessoa_id, tipo, registro_profissional)
     VALUES ($1, $2, $3)
     ON CONFLICT (pessoa_id) DO UPDATE SET
       tipo = COALESCE(EXCLUDED.tipo, pessoa_dados_profissionais.tipo),
       registro_profissional = COALESCE(EXCLUDED.registro_profissional, pessoa_dados_profissionais.registro_profissional)`,
    [pessoaId, dados.tipo ?? null, dados.registroProfissional ?? null]
  );

  return buscarResponsavelTecnicoPorId(pool, pessoaId);
}
