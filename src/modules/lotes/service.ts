import type { Pool } from "pg";
import { ConflictError, NotFoundError, ValidationAppError } from "../../lib/errors.js";
import {
  montarResultadoPaginado,
  resolverOrdenacao,
  resolverPaginacao,
  type PaginatedResult,
} from "../../lib/pagination.js";

export interface PessoaResumo {
  pessoaId: string;
  nome: string;
  papel: string;
}

export interface LoteResumo {
  id: string;
  quadraId: string;
  quadraCodigo: string;
  numero: number;
  areaM2: number | null;
  enderecoLogradouro: string | null;
  enderecoNumero: string | null;
  emAlerta: boolean;
  ocupacaoAtual: "DISPONIVEL" | "MORADOR" | null;
  statusObraAtual: string | null;
  obraEmAcompanhamentoId: string | null;
  proprietarios: PessoaResumo[];
  responsaveisTecnicos: PessoaResumo[];
  temLoteApoio: boolean;
}

export interface LoteFiltros {
  condominioId?: string;
  quadraCodigo?: string;
  ocupacao?: "DISPONIVEL" | "MORADOR" | "NAO_INFORMADO";
  emAlerta?: boolean;
  statusObraCodigo?: string;
  busca?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}

const COLUNAS_ORDENACAO: Record<string, string> = {
  numero: "l.numero",
  quadraCodigo: "q.codigo",
  areaM2: "l.area_m2",
  criadoEm: "l.criado_em",
  atualizadoEm: "l.atualizado_em",
};

// proprietarios/responsaveisTecnicos usam subqueries correlacionadas (não
// JOIN direto) de propósito: um lote pode ter N titulares/cotitulares e uma
// obra pode ter N responsáveis técnicos, e um JOIN multiplicaria as linhas
// de `l`/`o` — quebrando a paginação (LIMIT/OFFSET) e os agregados de
// emAlerta/ocupacao/status mais acima. json_agg dentro da subquery mantém
// exatamente uma linha por lote.
//
// `o` (obra "atual" do lote) usa LATERAL em vez de um LEFT JOIN simples
// filtrando `tipo IS DISTINCT FROM 'REFORMA'`: isso deixava sem obra (e sem
// status/responsáveis técnicos) qualquer lote cuja ÚNICA obra registrada
// fosse uma reforma (ex.: status de origem "CASA EM REFORMA" sem uma obra de
// construção inicial separada) — o LATERAL prioriza a não-reforma, mas cai
// para a reforma quando é a única que existe.
const SELECT_RESUMO = `
  SELECT
    l.id, l.quadra_id AS "quadraId", q.codigo AS "quadraCodigo", l.numero,
    l.area_m2::float AS "areaM2", l.endereco_logradouro AS "enderecoLogradouro",
    l.endereco_numero AS "enderecoNumero", l.em_alerta AS "emAlerta",
    oc.ocupacao AS "ocupacaoAtual",
    so.codigo AS "statusObraAtual",
    o.id AS "obraEmAcompanhamentoId",
    COALESCE((
      SELECT json_agg(json_build_object('pessoaId', p.id, 'nome', p.nome, 'papel', lp.papel) ORDER BY lp.papel, p.nome)
      FROM lote_pessoa lp JOIN pessoas p ON p.id = lp.pessoa_id
      WHERE lp.lote_id = l.id
    ), '[]'::json) AS proprietarios,
    COALESCE((
      SELECT json_agg(json_build_object('pessoaId', p.id, 'nome', p.nome, 'papel', op.papel) ORDER BY p.nome)
      FROM obra_pessoa op JOIN pessoas p ON p.id = op.pessoa_id
      WHERE op.obra_id = o.id
    ), '[]'::json) AS "responsaveisTecnicos",
    EXISTS (SELECT 1 FROM lote_apoio la WHERE la.lote_em_obra_id = l.id) AS "temLoteApoio"
  FROM lotes l
  JOIN quadras q ON q.id = l.quadra_id
  LEFT JOIN lote_ocupacao_historico oc ON oc.lote_id = l.id AND oc.data_fim IS NULL
  LEFT JOIN LATERAL (
    SELECT * FROM obras ob WHERE ob.lote_id = l.id
    ORDER BY (ob.tipo = 'REFORMA'), ob.criado_em DESC
    LIMIT 1
  ) o ON true
  LEFT JOIN obra_status_historico osh ON osh.obra_id = o.id AND osh.data_fim IS NULL
  LEFT JOIN status_obra so ON so.id = osh.status_id
`;

export async function listarLotes(pool: Pool, filtros: LoteFiltros): Promise<PaginatedResult<LoteResumo>> {
  const paginacao = resolverPaginacao(filtros);
  const ordenacao = resolverOrdenacao(filtros.sort, COLUNAS_ORDENACAO, "q.codigo ASC, l.numero ASC");

  const condicoes: string[] = [];
  const params: unknown[] = [];

  if (filtros.condominioId) {
    params.push(filtros.condominioId);
    condicoes.push(`q.condominio_id = $${params.length}`);
  }
  if (filtros.quadraCodigo) {
    params.push(filtros.quadraCodigo);
    condicoes.push(`q.codigo = $${params.length}`);
  }
  if (filtros.emAlerta !== undefined) {
    params.push(filtros.emAlerta);
    condicoes.push(`l.em_alerta = $${params.length}`);
  }
  if (filtros.ocupacao === "NAO_INFORMADO") {
    condicoes.push(`oc.ocupacao IS NULL`);
  } else if (filtros.ocupacao) {
    params.push(filtros.ocupacao);
    condicoes.push(`oc.ocupacao = $${params.length}`);
  }
  if (filtros.statusObraCodigo) {
    params.push(filtros.statusObraCodigo);
    condicoes.push(`so.codigo = $${params.length}`);
  }
  if (filtros.busca) {
    params.push(`%${filtros.busca.toLowerCase()}%`);
    const idx = params.length;
    condicoes.push(
      `(lower(q.codigo || ' ' || l.numero::text) LIKE $${idx}
        OR lower(coalesce(l.endereco_logradouro, '')) LIKE $${idx}
        OR EXISTS (
             SELECT 1 FROM lote_pessoa lp JOIN pessoas p ON p.id = lp.pessoa_id
             WHERE lp.lote_id = l.id AND lower(p.nome) LIKE $${idx}
           ))`
    );
  }

  const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";

  const totalRes = await pool.query<{ total: string }>(
    `SELECT count(*) AS total FROM lotes l JOIN quadras q ON q.id = l.quadra_id
     LEFT JOIN lote_ocupacao_historico oc ON oc.lote_id = l.id AND oc.data_fim IS NULL
     LEFT JOIN LATERAL (
    SELECT * FROM obras ob WHERE ob.lote_id = l.id
    ORDER BY (ob.tipo = 'REFORMA'), ob.criado_em DESC
    LIMIT 1
  ) o ON true
     LEFT JOIN obra_status_historico osh ON osh.obra_id = o.id AND osh.data_fim IS NULL
     LEFT JOIN status_obra so ON so.id = osh.status_id
     ${where}`,
    params
  );

  const dadosRes = await pool.query<LoteResumo>(
    `${SELECT_RESUMO} ${where} ORDER BY ${ordenacao} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, paginacao.limit, paginacao.offset]
  );

  return montarResultadoPaginado(dadosRes.rows, Number(totalRes.rows[0].total), paginacao);
}

export async function buscarLotePorId(pool: Pool, id: string): Promise<LoteResumo> {
  const res = await pool.query<LoteResumo>(`${SELECT_RESUMO} WHERE l.id = $1`, [id]);
  if (res.rowCount === 0) throw new NotFoundError("Lote", id);
  return res.rows[0];
}

export async function criarLote(
  pool: Pool,
  dados: {
    quadraId: string;
    numero: number;
    areaM2?: number | null;
    enderecoLogradouro?: string | null;
    enderecoNumero?: string | null;
  }
): Promise<LoteResumo> {
  const quadra = await pool.query(`SELECT 1 FROM quadras WHERE id = $1`, [dados.quadraId]);
  if (quadra.rowCount === 0) throw new NotFoundError("Quadra", dados.quadraId);

  const existente = await pool.query(`SELECT 1 FROM lotes WHERE quadra_id = $1 AND numero = $2`, [
    dados.quadraId,
    dados.numero,
  ]);
  if ((existente.rowCount ?? 0) > 0) {
    throw new ConflictError(`Já existe um lote de número ${dados.numero} nesta quadra.`);
  }

  const inserido = await pool.query<{ id: string }>(
    `INSERT INTO lotes (quadra_id, numero, area_m2, endereco_logradouro, endereco_numero, atualizado_em)
     VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
    [dados.quadraId, dados.numero, dados.areaM2 ?? null, dados.enderecoLogradouro ?? null, dados.enderecoNumero ?? null]
  );
  return buscarLotePorId(pool, inserido.rows[0].id);
}

export async function atualizarLote(
  pool: Pool,
  id: string,
  dados: Partial<{
    areaM2: number | null;
    enderecoLogradouro: string | null;
    enderecoNumero: string | null;
    emAlerta: boolean;
  }>,
  usuarioId: string | null
): Promise<LoteResumo> {
  const atual = await buscarLotePorId(pool, id);

  if (dados.emAlerta !== undefined && dados.emAlerta !== atual.emAlerta) {
    await pool.query(
      `INSERT INTO audit_logs (entidade, entidade_id, acao, campo_alterado, valor_anterior, valor_novo, usuario_id)
       VALUES ('Lote', $1, 'UPDATE', 'emAlerta', $2, $3, $4)`,
      [id, String(atual.emAlerta), String(dados.emAlerta), usuarioId]
    );
  }

  await pool.query(
    `UPDATE lotes SET
       area_m2 = COALESCE($2, area_m2),
       endereco_logradouro = COALESCE($3, endereco_logradouro),
       endereco_numero = COALESCE($4, endereco_numero),
       em_alerta = COALESCE($5, em_alerta),
       atualizado_em = now()
     WHERE id = $1`,
    [id, dados.areaM2 ?? null, dados.enderecoLogradouro ?? null, dados.enderecoNumero ?? null, dados.emAlerta ?? null]
  );

  return buscarLotePorId(pool, id);
}

export interface OcupacaoHistoricoItem {
  id: string;
  ocupacao: "DISPONIVEL" | "MORADOR";
  dataInicio: string;
  dataFim: string | null;
  observacao: string | null;
}

export async function listarHistoricoOcupacao(pool: Pool, loteId: string): Promise<OcupacaoHistoricoItem[]> {
  await buscarLotePorId(pool, loteId);
  const res = await pool.query(
    `SELECT id, ocupacao, data_inicio AS "dataInicio", data_fim AS "dataFim", observacao
     FROM lote_ocupacao_historico WHERE lote_id = $1 ORDER BY data_inicio DESC`,
    [loteId]
  );
  return res.rows;
}

export async function atualizarOcupacao(
  pool: Pool,
  loteId: string,
  ocupacao: "DISPONIVEL" | "MORADOR",
  observacao: string | null,
  usuarioId: string | null
): Promise<OcupacaoHistoricoItem> {
  await buscarLotePorId(pool, loteId);

  const vigente = await pool.query<{ id: string; ocupacao: string }>(
    `SELECT id, ocupacao FROM lote_ocupacao_historico WHERE lote_id = $1 AND data_fim IS NULL`,
    [loteId]
  );

  if (vigente.rowCount && vigente.rows[0].ocupacao === ocupacao) {
    throw new ValidationAppError(`O lote já está com ocupação "${ocupacao}".`);
  }

  await pool.query(`UPDATE lote_ocupacao_historico SET data_fim = now() WHERE lote_id = $1 AND data_fim IS NULL`, [
    loteId,
  ]);

  const inserido = await pool.query(
    `INSERT INTO lote_ocupacao_historico (lote_id, ocupacao, data_inicio, observacao, usuario_id)
     VALUES ($1, $2, now(), $3, $4)
     RETURNING id, ocupacao, data_inicio AS "dataInicio", data_fim AS "dataFim", observacao`,
    [loteId, ocupacao, observacao, usuarioId]
  );
  return inserido.rows[0];
}

export interface PessoaDoLote {
  pessoaId: string;
  nome: string;
  papel: "TITULAR" | "COTITULAR";
}

export async function listarPessoasDoLote(pool: Pool, loteId: string): Promise<PessoaDoLote[]> {
  await buscarLotePorId(pool, loteId);
  const res = await pool.query(
    `SELECT p.id AS "pessoaId", p.nome, lp.papel
     FROM lote_pessoa lp JOIN pessoas p ON p.id = lp.pessoa_id
     WHERE lp.lote_id = $1 ORDER BY lp.papel, p.nome`,
    [loteId]
  );
  return res.rows;
}

export interface ObraDoLote {
  id: string;
  tipo: string | null;
  statusAtual: string | null;
  dataLiberacao: string | null;
  liberadoParaMudanca: boolean;
}

export async function listarObrasDoLote(pool: Pool, loteId: string): Promise<ObraDoLote[]> {
  await buscarLotePorId(pool, loteId);
  const res = await pool.query(
    `SELECT o.id, o.tipo, so.codigo AS "statusAtual",
            o.data_liberacao AS "dataLiberacao", o.liberado_para_mudanca AS "liberadoParaMudanca"
     FROM obras o
     LEFT JOIN obra_status_historico osh ON osh.obra_id = o.id AND osh.data_fim IS NULL
     LEFT JOIN status_obra so ON so.id = osh.status_id
     WHERE o.lote_id = $1 ORDER BY o.criado_em`,
    [loteId]
  );
  return res.rows;
}

export interface LoteApoioInfo {
  id: string;
  direcao: "USA_APOIO" | "E_APOIO_DE";
  loteId: string;
  quadraCodigo: string;
  loteNumero: number;
  dataAutorizacao: string | null;
  dataDevolucaoPrevista: string | null;
  dataDevolucaoEfetiva: string | null;
  observacao: string | null;
}

/**
 * LoteApoio é uma relação de mão dupla entre dois lotes (o modelo é uma
 * auto-relação N:N com atributos — ver DOMAIN_MODEL.md). "direcao" existe
 * porque este lote pode aparecer nos dois papéis: usando outro lote como
 * apoio de obra (USA_APOIO) ou emprestado como apoio para a obra de outro
 * lote (E_APOIO_DE) — nunca os dois na mesma linha.
 */
export async function listarApoiosDoLote(pool: Pool, loteId: string): Promise<LoteApoioInfo[]> {
  await buscarLotePorId(pool, loteId);
  const res = await pool.query<LoteApoioInfo>(
    `SELECT la.id, 'USA_APOIO' AS direcao, l2.id AS "loteId", q2.codigo AS "quadraCodigo", l2.numero AS "loteNumero",
            la.data_autorizacao AS "dataAutorizacao", la.data_devolucao_prevista AS "dataDevolucaoPrevista",
            la.data_devolucao_efetiva AS "dataDevolucaoEfetiva", la.observacao
     FROM lote_apoio la
     JOIN lotes l2 ON l2.id = la.lote_apoio_id
     JOIN quadras q2 ON q2.id = l2.quadra_id
     WHERE la.lote_em_obra_id = $1
     UNION ALL
     SELECT la.id, 'E_APOIO_DE' AS direcao, l2.id AS "loteId", q2.codigo AS "quadraCodigo", l2.numero AS "loteNumero",
            la.data_autorizacao AS "dataAutorizacao", la.data_devolucao_prevista AS "dataDevolucaoPrevista",
            la.data_devolucao_efetiva AS "dataDevolucaoEfetiva", la.observacao
     FROM lote_apoio la
     JOIN lotes l2 ON l2.id = la.lote_em_obra_id
     JOIN quadras q2 ON q2.id = l2.quadra_id
     WHERE la.lote_apoio_id = $1
     ORDER BY "quadraCodigo", "loteNumero"`,
    [loteId]
  );
  return res.rows;
}
