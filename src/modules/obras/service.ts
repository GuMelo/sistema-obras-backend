import type { Pool } from "pg";
import { NotFoundError, ValidationAppError } from "../../lib/errors.js";
import { removerPrefixoProfissional } from "../../lib/pessoa.js";
import {
  montarResultadoPaginado,
  resolverOrdenacao,
  resolverPaginacao,
  type PaginatedResult,
} from "../../lib/pagination.js";

export interface Obra {
  id: string;
  loteId: string;
  quadraCodigo: string;
  loteNumero: number;
  tipo: "CONSTRUCAO_INICIAL" | "REFORMA" | null;
  statusAtual: string | null;
  dataLiberacao: string | null;
  dataVistoriaPosObra: string | null;
  liberadoParaMudanca: boolean;
  dataMudanca: string | null;
}

const COLUNAS_ORDENACAO: Record<string, string> = {
  criadoEm: "o.criado_em",
  dataLiberacao: "o.data_liberacao",
  numero: "l.numero",
};

const SELECT = `
  SELECT o.id, o.lote_id AS "loteId", q.codigo AS "quadraCodigo", l.numero AS "loteNumero",
         o.tipo, so.codigo AS "statusAtual", o.data_liberacao AS "dataLiberacao",
         o.data_vistoria_pos_obra AS "dataVistoriaPosObra",
         o.liberado_para_mudanca AS "liberadoParaMudanca", o.data_mudanca AS "dataMudanca"
  FROM obras o
  JOIN lotes l ON l.id = o.lote_id
  JOIN quadras q ON q.id = l.quadra_id
  LEFT JOIN obra_status_historico osh ON osh.obra_id = o.id AND osh.data_fim IS NULL
  LEFT JOIN status_obra so ON so.id = osh.status_id
`;

export interface ObraFiltros {
  loteId?: string;
  quadraCodigo?: string;
  statusCodigo?: string;
  tipo?: "CONSTRUCAO_INICIAL" | "REFORMA";
  liberadoParaMudanca?: boolean;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export async function listarObras(pool: Pool, filtros: ObraFiltros): Promise<PaginatedResult<Obra>> {
  const paginacao = resolverPaginacao(filtros);
  const ordenacao = resolverOrdenacao(filtros.sort, COLUNAS_ORDENACAO, "o.criado_em DESC");

  const condicoes: string[] = [];
  const params: unknown[] = [];
  if (filtros.loteId) {
    params.push(filtros.loteId);
    condicoes.push(`o.lote_id = $${params.length}`);
  }
  if (filtros.quadraCodigo) {
    params.push(filtros.quadraCodigo);
    condicoes.push(`q.codigo = $${params.length}`);
  }
  if (filtros.statusCodigo) {
    params.push(filtros.statusCodigo);
    condicoes.push(`so.codigo = $${params.length}`);
  }
  if (filtros.tipo) {
    params.push(filtros.tipo);
    condicoes.push(`o.tipo = $${params.length}`);
  }
  if (filtros.liberadoParaMudanca !== undefined) {
    params.push(filtros.liberadoParaMudanca);
    condicoes.push(`o.liberado_para_mudanca = $${params.length}`);
  }
  const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";

  const totalRes = await pool.query<{ total: string }>(
    `SELECT count(*) AS total FROM obras o
     JOIN lotes l ON l.id = o.lote_id JOIN quadras q ON q.id = l.quadra_id
     LEFT JOIN obra_status_historico osh ON osh.obra_id = o.id AND osh.data_fim IS NULL
     LEFT JOIN status_obra so ON so.id = osh.status_id ${where}`,
    params
  );

  const dadosRes = await pool.query<Obra>(
    `${SELECT} ${where} ORDER BY ${ordenacao} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, paginacao.limit, paginacao.offset]
  );

  return montarResultadoPaginado(dadosRes.rows, Number(totalRes.rows[0].total), paginacao);
}

export async function buscarObraPorId(pool: Pool, id: string): Promise<Obra> {
  const res = await pool.query<Obra>(`${SELECT} WHERE o.id = $1`, [id]);
  if (res.rowCount === 0) throw new NotFoundError("Obra", id);
  return res.rows[0];
}

export async function criarObra(
  pool: Pool,
  dados: { loteId: string; tipo?: "CONSTRUCAO_INICIAL" | "REFORMA" }
): Promise<Obra> {
  const lote = await pool.query(`SELECT 1 FROM lotes WHERE id = $1`, [dados.loteId]);
  if (lote.rowCount === 0) throw new NotFoundError("Lote", dados.loteId);

  const inserida = await pool.query<{ id: string }>(
    `INSERT INTO obras (lote_id, tipo, atualizado_em) VALUES ($1, $2, now()) RETURNING id`,
    [dados.loteId, dados.tipo ?? null]
  );
  return buscarObraPorId(pool, inserida.rows[0].id);
}

export async function atualizarObra(
  pool: Pool,
  id: string,
  dados: Partial<{
    tipo: "CONSTRUCAO_INICIAL" | "REFORMA";
    dataLiberacao: string;
    dataVistoriaPosObra: string;
    liberadoParaMudanca: boolean;
    dataMudanca: string;
  }>
): Promise<Obra> {
  await buscarObraPorId(pool, id);
  await pool.query(
    `UPDATE obras SET
       tipo = COALESCE($2, tipo),
       data_liberacao = COALESCE($3, data_liberacao),
       data_vistoria_pos_obra = COALESCE($4, data_vistoria_pos_obra),
       liberado_para_mudanca = COALESCE($5, liberado_para_mudanca),
       data_mudanca = COALESCE($6, data_mudanca),
       atualizado_em = now()
     WHERE id = $1`,
    [
      id,
      dados.tipo ?? null,
      dados.dataLiberacao ?? null,
      dados.dataVistoriaPosObra ?? null,
      dados.liberadoParaMudanca ?? null,
      dados.dataMudanca ?? null,
    ]
  );
  return buscarObraPorId(pool, id);
}

export interface StatusObraHistoricoItem {
  id: string;
  statusCodigo: string;
  dataInicio: string;
  dataFim: string | null;
  observacao: string | null;
}

export async function listarHistoricoStatusObra(pool: Pool, obraId: string): Promise<StatusObraHistoricoItem[]> {
  await buscarObraPorId(pool, obraId);
  const res = await pool.query(
    `SELECT osh.id, so.codigo AS "statusCodigo", osh.data_inicio AS "dataInicio",
            osh.data_fim AS "dataFim", osh.observacao
     FROM obra_status_historico osh JOIN status_obra so ON so.id = osh.status_id
     WHERE osh.obra_id = $1 ORDER BY osh.data_inicio DESC`,
    [obraId]
  );
  return res.rows;
}

export async function atualizarStatusObra(
  pool: Pool,
  obraId: string,
  statusCodigo: string,
  observacao: string | null,
  usuarioId: string | null
): Promise<StatusObraHistoricoItem> {
  await buscarObraPorId(pool, obraId);

  const status = await pool.query<{ id: string }>(`SELECT id FROM status_obra WHERE codigo = $1 AND ativo = true`, [
    statusCodigo,
  ]);
  if (status.rowCount === 0) {
    throw new ValidationAppError(`Status de obra desconhecido ou inativo: "${statusCodigo}".`);
  }

  const vigente = await pool.query<{ status_id: string }>(
    `SELECT status_id FROM obra_status_historico WHERE obra_id = $1 AND data_fim IS NULL`,
    [obraId]
  );
  if (vigente.rowCount && vigente.rows[0].status_id === status.rows[0].id) {
    throw new ValidationAppError(`A obra já está com o status "${statusCodigo}".`);
  }

  await pool.query(`UPDATE obra_status_historico SET data_fim = now() WHERE obra_id = $1 AND data_fim IS NULL`, [
    obraId,
  ]);

  const inserido = await pool.query(
    `INSERT INTO obra_status_historico (obra_id, status_id, data_inicio, observacao, usuario_id)
     VALUES ($1, $2, now(), $3, $4)
     RETURNING id, (SELECT codigo FROM status_obra WHERE id = $2) AS "statusCodigo",
       data_inicio AS "dataInicio", data_fim AS "dataFim", observacao`,
    [obraId, status.rows[0].id, observacao, usuarioId]
  );
  return inserido.rows[0];
}

export interface ResponsavelTecnicoDaObra {
  pessoaId: string;
  nome: string;
  papel: "ARQUITETO" | "ENGENHEIRO" | null;
}

/** `papel` vem de pessoa_dados_profissionais.tipo, não de obra_pessoa.papel
 * (sempre o literal "RESPONSAVEL_TECNICO" — único valor do enum
 * PapelObraPessoa hoje, não diz o cargo da pessoa). `nome` vem sem o prefixo
 * profissional cru do banco ("Arquiteto Fulano" -> "Fulano"), já que o cargo
 * aqui é estruturado em `papel` — mesmo critério de lotes/service.ts. */
export async function listarResponsaveisDaObra(pool: Pool, obraId: string): Promise<ResponsavelTecnicoDaObra[]> {
  await buscarObraPorId(pool, obraId);
  const res = await pool.query<ResponsavelTecnicoDaObra>(
    `SELECT p.id AS "pessoaId", p.nome, pdp.tipo AS papel
     FROM obra_pessoa op JOIN pessoas p ON p.id = op.pessoa_id
     LEFT JOIN pessoa_dados_profissionais pdp ON pdp.pessoa_id = p.id
     WHERE op.obra_id = $1 ORDER BY p.nome`,
    [obraId]
  );
  return res.rows.map((r) => ({ ...r, nome: removerPrefixoProfissional(r.nome) }));
}

export async function vincularResponsavelTecnico(pool: Pool, obraId: string, pessoaId: string): Promise<void> {
  await buscarObraPorId(pool, obraId);
  const pessoa = await pool.query(`SELECT 1 FROM pessoas WHERE id = $1`, [pessoaId]);
  if (pessoa.rowCount === 0) throw new NotFoundError("Pessoa", pessoaId);

  await pool.query(
    `INSERT INTO pessoa_dados_profissionais (pessoa_id) VALUES ($1) ON CONFLICT (pessoa_id) DO NOTHING`,
    [pessoaId]
  );
  await pool.query(
    `INSERT INTO obra_pessoa (obra_id, pessoa_id, papel) VALUES ($1, $2, 'RESPONSAVEL_TECNICO')
     ON CONFLICT DO NOTHING`,
    [obraId, pessoaId]
  );
}
