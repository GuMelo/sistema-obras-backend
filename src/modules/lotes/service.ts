import type { Pool } from "pg";
import { ConflictError, NotFoundError, ValidationAppError } from "../../lib/errors.js";
import { withTransaction, type Queryable } from "../../lib/db.js";
import { removerPrefixoProfissional } from "../../lib/pessoa.js";
import {
  montarResultadoPaginado,
  resolverOrdenacao,
  resolverPaginacao,
  type PaginatedResult,
} from "../../lib/pagination.js";

export interface PessoaResumo {
  pessoaId: string;
  nome: string;
  papel: string | null;
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
  cadastradoEm: string;
  atualizadoEm: string;
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

// responsaveisTecnicos.papel vem de pessoa_dados_profissionais.tipo
// (ARQUITETO/ENGENHEIRO/null) — não de obra_pessoa.papel, que é sempre o
// literal "RESPONSAVEL_TECNICO" (é o único valor do enum PapelObraPessoa
// hoje, ver schema.prisma) e não diz nada sobre o cargo da pessoa. O `nome`
// aqui ainda vem com o prefixo profissional cru do banco ("Arquiteto
// Fulano") — limparPrefixoResponsaveis() abaixo remove isso na resposta,
// já que o cargo agora vem estruturado em `papel` e repetir no texto do
// nome é redundante (não altera o valor armazenado).
//
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
    l.criado_em AS "cadastradoEm", l.atualizado_em AS "atualizadoEm",
    oc.ocupacao AS "ocupacaoAtual",
    so.codigo AS "statusObraAtual",
    o.id AS "obraEmAcompanhamentoId",
    COALESCE((
      SELECT json_agg(json_build_object('pessoaId', p.id, 'nome', p.nome, 'papel', lp.papel) ORDER BY lp.papel, p.nome)
      FROM lote_pessoa lp JOIN pessoas p ON p.id = lp.pessoa_id
      WHERE lp.lote_id = l.id
    ), '[]'::json) AS proprietarios,
    COALESCE((
      SELECT json_agg(json_build_object('pessoaId', p.id, 'nome', p.nome, 'papel', pdp.tipo) ORDER BY p.nome)
      FROM obra_pessoa op JOIN pessoas p ON p.id = op.pessoa_id
      LEFT JOIN pessoa_dados_profissionais pdp ON pdp.pessoa_id = p.id
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

function limparPrefixoResponsaveis(lote: LoteResumo): LoteResumo {
  return {
    ...lote,
    responsaveisTecnicos: lote.responsaveisTecnicos.map((r) => ({ ...r, nome: removerPrefixoProfissional(r.nome) })),
  };
}

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

  return montarResultadoPaginado(dadosRes.rows.map(limparPrefixoResponsaveis), Number(totalRes.rows[0].total), paginacao);
}

export async function buscarLotePorId(pool: Queryable, id: string): Promise<LoteResumo> {
  const res = await pool.query<LoteResumo>(`${SELECT_RESUMO} WHERE l.id = $1`, [id]);
  if (res.rowCount === 0) throw new NotFoundError("Lote", id);
  return limparPrefixoResponsaveis(res.rows[0]);
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
export async function listarApoiosDoLote(pool: Queryable, loteId: string): Promise<LoteApoioInfo[]> {
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

// ============================================================
// EDIÇÃO COMPLETA (PATCH /lotes/:id)
// ============================================================

export interface AtualizarLoteCompletoDados {
  enderecoLogradouro?: string | null;
  enderecoNumero?: string | null;
  emAlerta?: boolean;
  ocupacao?: "DISPONIVEL" | "MORADOR";
  ocupacaoObservacao?: string;
  proprietarios?: Array<{ pessoaId: string; papel: "TITULAR" | "COTITULAR" }>;
  responsaveisTecnicos?: Array<{ pessoaId: string; tipo?: "ARQUITETO" | "ENGENHEIRO" }>;
  loteApoioIds?: string[];
  obra?: {
    tipo?: "CONSTRUCAO_INICIAL" | "REFORMA";
    statusCodigo?: string;
    dataLiberacao?: string | null;
    dataVistoriaPosObra?: string | null;
    liberadoParaMudanca?: boolean;
    dataMudanca?: string | null;
  };
}

interface EventoEdicao {
  area: string;
  frase: string;
}

interface AuditLogPendente {
  entidade: "Lote" | "Obra";
  entidadeId: string;
  campoAlterado: string;
  valorAnterior: string | null;
  valorNovo: string | null;
}

const LABEL_OCUPACAO: Record<string, string> = { DISPONIVEL: "Disponível", MORADOR: "Morador" };
const LABEL_TIPO_OBRA: Record<string, string> = { CONSTRUCAO_INICIAL: "Construção inicial", REFORMA: "Reforma" };
const LABEL_TIPO_PROFISSIONAL: Record<string, string> = { ARQUITETO: "arquiteto", ENGENHEIRO: "engenheiro" };

function listaComE(itens: string[]): string {
  if (itens.length === 0) return "";
  if (itens.length === 1) return itens[0];
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

function construirResumo(eventos: EventoEdicao[]): string {
  const areas = [...new Set(eventos.map((e) => e.area))];
  if (areas.length === 1) {
    return eventos.map((e) => e.frase).join(" ");
  }
  return `Atualização do lote: ${listaComE(areas)}.`;
}

/** Diff genérico "conjunto atual -> conjunto novo": decide o que remover e o
 * que adicionar comparando dois `Set` de ids. Reaproveitado por
 * proprietários, responsáveis técnicos e lote de apoio — os três são
 * vínculos N:N onde o body do PATCH manda o conjunto final desejado, não
 * deltas (ver justificativa no plano de implementação). */
function diferencaDeConjuntos(atual: Set<string>, novo: Set<string>): { removidos: string[]; adicionados: string[] } {
  return {
    removidos: [...atual].filter((id) => !novo.has(id)),
    adicionados: [...novo].filter((id) => !atual.has(id)),
  };
}

async function validarPessoasExistem(client: Queryable, pessoaIds: string[]): Promise<void> {
  if (pessoaIds.length === 0) return;
  const res = await client.query<{ id: string }>(`SELECT id FROM pessoas WHERE id = ANY($1::uuid[])`, [pessoaIds]);
  const encontrados = new Set(res.rows.map((r) => r.id));
  const faltando = pessoaIds.find((id) => !encontrados.has(id));
  if (faltando) throw new NotFoundError("Pessoa", faltando);
}

export async function atualizarLoteCompleto(
  pool: Pool,
  loteId: string,
  dados: AtualizarLoteCompletoDados,
  usuarioId: string | null
): Promise<LoteResumo> {
  return withTransaction(pool, async (client) => {
    const loteAtualRes = await client.query<{
      enderecoLogradouro: string | null;
      enderecoNumero: string | null;
      emAlerta: boolean;
    }>(
      `SELECT endereco_logradouro AS "enderecoLogradouro", endereco_numero AS "enderecoNumero", em_alerta AS "emAlerta"
       FROM lotes WHERE id = $1`,
      [loteId]
    );
    if (loteAtualRes.rowCount === 0) throw new NotFoundError("Lote", loteId);
    const loteAtual = loteAtualRes.rows[0];

    // Validações que não dependem de nenhuma escrita — falham antes de
    // qualquer INSERT/UPDATE (a transação garante que nada fica parcial de
    // qualquer forma, mas falhar cedo evita trabalho à toa).
    if (dados.proprietarios) {
      await validarPessoasExistem(client, dados.proprietarios.map((p) => p.pessoaId));
      const idsUnicos = new Set(dados.proprietarios.map((p) => p.pessoaId));
      if (idsUnicos.size !== dados.proprietarios.length) {
        throw new ValidationAppError("Uma mesma pessoa não pode aparecer duas vezes em proprietários.");
      }
    }
    if (dados.responsaveisTecnicos) {
      await validarPessoasExistem(client, dados.responsaveisTecnicos.map((r) => r.pessoaId));
      const idsUnicos = new Set(dados.responsaveisTecnicos.map((r) => r.pessoaId));
      if (idsUnicos.size !== dados.responsaveisTecnicos.length) {
        throw new ValidationAppError("Uma mesma pessoa não pode aparecer duas vezes em responsáveis técnicos.");
      }
    }
    if (dados.loteApoioIds) {
      if (dados.loteApoioIds.includes(loteId)) {
        throw new ValidationAppError("Um lote não pode ser vinculado a ele mesmo como lote de apoio.");
      }
      if (dados.loteApoioIds.length > 0) {
        const res = await client.query<{ id: string }>(`SELECT id FROM lotes WHERE id = ANY($1::uuid[])`, [
          dados.loteApoioIds,
        ]);
        const encontrados = new Set(res.rows.map((r) => r.id));
        const faltando = dados.loteApoioIds.find((id) => !encontrados.has(id));
        if (faltando) throw new NotFoundError("Lote de apoio", faltando);
      }
    }
    let statusObraNovo: { id: string; codigo: string; descricao: string } | null = null;
    if (dados.obra?.statusCodigo) {
      const res = await client.query<{ id: string; codigo: string; descricao: string }>(
        `SELECT id, codigo, descricao FROM status_obra WHERE codigo = $1`,
        [dados.obra.statusCodigo]
      );
      if (res.rowCount === 0) throw new NotFoundError("Status de obra", dados.obra.statusCodigo);
      statusObraNovo = res.rows[0];
    }

    const eventos: EventoEdicao[] = [];
    const auditLogs: AuditLogPendente[] = [];
    let obraMudou = false;
    let obraCamposAtualizados = false;

    // ---- Lote: endereço e alerta ----
    const loteSets: string[] = [];
    const loteParams: unknown[] = [loteId];
    const addLoteSet = (coluna: string, valor: unknown) => {
      loteParams.push(valor);
      loteSets.push(`${coluna} = $${loteParams.length}`);
    };

    if (dados.enderecoLogradouro !== undefined && dados.enderecoLogradouro !== loteAtual.enderecoLogradouro) {
      addLoteSet("endereco_logradouro", dados.enderecoLogradouro);
      auditLogs.push({
        entidade: "Lote",
        entidadeId: loteId,
        campoAlterado: "enderecoLogradouro",
        valorAnterior: loteAtual.enderecoLogradouro,
        valorNovo: dados.enderecoLogradouro,
      });
      eventos.push({ area: "endereço", frase: "Endereço atualizado." });
    }
    if (dados.enderecoNumero !== undefined && dados.enderecoNumero !== loteAtual.enderecoNumero) {
      addLoteSet("endereco_numero", dados.enderecoNumero);
      auditLogs.push({
        entidade: "Lote",
        entidadeId: loteId,
        campoAlterado: "enderecoNumero",
        valorAnterior: loteAtual.enderecoNumero,
        valorNovo: dados.enderecoNumero,
      });
      if (!eventos.some((e) => e.area === "endereço")) {
        eventos.push({ area: "endereço", frase: "Endereço atualizado." });
      }
    }
    if (dados.emAlerta !== undefined && dados.emAlerta !== loteAtual.emAlerta) {
      addLoteSet("em_alerta", dados.emAlerta);
      auditLogs.push({
        entidade: "Lote",
        entidadeId: loteId,
        campoAlterado: "emAlerta",
        valorAnterior: String(loteAtual.emAlerta),
        valorNovo: String(dados.emAlerta),
      });
      eventos.push({ area: "alerta", frase: dados.emAlerta ? "Alerta ativado." : "Alerta desativado." });
    }

    if (loteSets.length > 0) {
      await client.query(`UPDATE lotes SET ${loteSets.join(", ")}, atualizado_em = now() WHERE id = $1`, loteParams);
    }

    // ---- Ocupação (histórico) ----
    if (dados.ocupacao !== undefined) {
      const vigente = await client.query<{ ocupacao: string }>(
        `SELECT ocupacao FROM lote_ocupacao_historico WHERE lote_id = $1 AND data_fim IS NULL`,
        [loteId]
      );
      const ocupacaoAtual = vigente.rows[0]?.ocupacao ?? null;
      if (ocupacaoAtual !== dados.ocupacao) {
        await client.query(
          `UPDATE lote_ocupacao_historico SET data_fim = now() WHERE lote_id = $1 AND data_fim IS NULL`,
          [loteId]
        );
        await client.query(
          `INSERT INTO lote_ocupacao_historico (lote_id, ocupacao, data_inicio, observacao, usuario_id)
           VALUES ($1, $2, now(), $3, $4)`,
          [loteId, dados.ocupacao, dados.ocupacaoObservacao ?? null, usuarioId]
        );
        eventos.push({
          area: "ocupação",
          frase: `Ocupação alterada de '${ocupacaoAtual ? LABEL_OCUPACAO[ocupacaoAtual] : "Não informado"}' para '${LABEL_OCUPACAO[dados.ocupacao]}'.`,
        });
      }
    }

    // ---- Proprietários (lote_pessoa) ----
    if (dados.proprietarios) {
      const atuaisRes = await client.query<{ pessoaId: string; papel: string }>(
        `SELECT pessoa_id AS "pessoaId", papel FROM lote_pessoa WHERE lote_id = $1`,
        [loteId]
      );
      const atuaisPorId = new Map(atuaisRes.rows.map((r) => [r.pessoaId, r.papel]));
      const { removidos, adicionados } = diferencaDeConjuntos(
        new Set(atuaisRes.rows.map((r) => r.pessoaId)),
        new Set(dados.proprietarios.map((p) => p.pessoaId))
      );
      const novosPorId = new Map(dados.proprietarios.map((p) => [p.pessoaId, p.papel]));

      for (const pessoaId of removidos) {
        await client.query(`DELETE FROM lote_pessoa WHERE lote_id = $1 AND pessoa_id = $2`, [loteId, pessoaId]);
        eventos.push({ area: "proprietário(s)", frase: `${atuaisPorId.get(pessoaId) === "TITULAR" ? "Titular" : "Cotitular"} removido.` });
      }
      for (const pessoaId of adicionados) {
        const papel = novosPorId.get(pessoaId)!;
        await client.query(`INSERT INTO lote_pessoa (lote_id, pessoa_id, papel) VALUES ($1, $2, $3)`, [
          loteId,
          pessoaId,
          papel,
        ]);
        eventos.push({ area: "proprietário(s)", frase: `${papel === "TITULAR" ? "Titular" : "Cotitular"} adicionado.` });
      }
      // Papel mudou para quem já era proprietário e continua, só com papel diferente.
      for (const [pessoaId, papelNovo] of novosPorId) {
        const papelAtual = atuaisPorId.get(pessoaId);
        if (papelAtual && papelAtual !== papelNovo) {
          await client.query(`UPDATE lote_pessoa SET papel = $3 WHERE lote_id = $1 AND pessoa_id = $2`, [
            loteId,
            pessoaId,
            papelNovo,
          ]);
          eventos.push({ area: "proprietário(s)", frase: `Papel de titularidade alterado para ${papelNovo === "TITULAR" ? "titular" : "cotitular"}.` });
        }
      }
    }

    // ---- Obra: resolve/cria a obra "atual" só se algo de obra for enviado ----
    const precisaObra =
      dados.obra !== undefined || dados.responsaveisTecnicos !== undefined;

    let obraId: string | null = null;
    let obraAtual: {
      tipo: string | null;
      dataLiberacao: string | null;
      dataVistoriaPosObra: string | null;
      liberadoParaMudanca: boolean;
      dataMudanca: string | null;
      statusId: string | null;
      statusCodigo: string | null;
      statusDescricao: string | null;
    } | null = null;

    if (precisaObra) {
      const obraRes = await client.query(
        `SELECT o.id, o.tipo, o.data_liberacao AS "dataLiberacao", o.data_vistoria_pos_obra AS "dataVistoriaPosObra",
                o.liberado_para_mudanca AS "liberadoParaMudanca", o.data_mudanca AS "dataMudanca",
                so.id AS "statusId", so.codigo AS "statusCodigo", so.descricao AS "statusDescricao"
         FROM (
           SELECT * FROM obras WHERE lote_id = $1 ORDER BY (tipo = 'REFORMA'), criado_em DESC LIMIT 1
         ) o
         LEFT JOIN obra_status_historico osh ON osh.obra_id = o.id AND osh.data_fim IS NULL
         LEFT JOIN status_obra so ON so.id = osh.status_id`,
        [loteId]
      );

      if (obraRes.rowCount && obraRes.rowCount > 0) {
        obraId = obraRes.rows[0].id;
        obraAtual = obraRes.rows[0];
      } else if (dados.obra !== undefined) {
        const inserida = await client.query<{ id: string }>(
          `INSERT INTO obras (lote_id, atualizado_em) VALUES ($1, now()) RETURNING id`,
          [loteId]
        );
        obraId = inserida.rows[0].id;
        // "Antes" da edição não existia obra nenhuma — representado como
        // todos os campos em seus valores-padrão (não o valor que vier em
        // `dados.obra`). Isso garante que o diff logo abaixo detecte e
        // registre CADA campo enviado como uma mudança real (histórico +
        // AuditLog), em vez de silenciosamente já considerá-los "iguais".
        obraAtual = {
          tipo: null,
          dataLiberacao: null,
          dataVistoriaPosObra: null,
          liberadoParaMudanca: false,
          dataMudanca: null,
          statusId: null,
          statusCodigo: null,
          statusDescricao: null,
        };
        obraMudou = true;
      }
    }

    if (obraId && obraAtual && dados.obra) {
      const obraSets: string[] = [];
      const obraParams: unknown[] = [obraId];
      const addObraSet = (coluna: string, valor: unknown) => {
        obraParams.push(valor);
        obraSets.push(`${coluna} = $${obraParams.length}`);
      };

      if (dados.obra.tipo !== undefined && dados.obra.tipo !== obraAtual.tipo) {
        addObraSet("tipo", dados.obra.tipo);
        auditLogs.push({
          entidade: "Obra",
          entidadeId: obraId,
          campoAlterado: "tipo",
          valorAnterior: obraAtual.tipo,
          valorNovo: dados.obra.tipo,
        });
        eventos.push({
          area: "tipo da obra",
          frase: `Tipo da obra alterado de '${obraAtual.tipo ? LABEL_TIPO_OBRA[obraAtual.tipo] : "não informado"}' para '${LABEL_TIPO_OBRA[dados.obra.tipo]}'.`,
        });
        obraMudou = true;
      }
      if (dados.obra.dataLiberacao !== undefined && dados.obra.dataLiberacao !== obraAtual.dataLiberacao) {
        addObraSet("data_liberacao", dados.obra.dataLiberacao);
        auditLogs.push({
          entidade: "Obra",
          entidadeId: obraId,
          campoAlterado: "dataLiberacao",
          valorAnterior: obraAtual.dataLiberacao,
          valorNovo: dados.obra.dataLiberacao,
        });
        eventos.push({ area: "informações da obra", frase: "Informações da obra atualizadas." });
        obraMudou = true;
      }
      if (
        dados.obra.dataVistoriaPosObra !== undefined &&
        dados.obra.dataVistoriaPosObra !== obraAtual.dataVistoriaPosObra
      ) {
        addObraSet("data_vistoria_pos_obra", dados.obra.dataVistoriaPosObra);
        auditLogs.push({
          entidade: "Obra",
          entidadeId: obraId,
          campoAlterado: "dataVistoriaPosObra",
          valorAnterior: obraAtual.dataVistoriaPosObra,
          valorNovo: dados.obra.dataVistoriaPosObra,
        });
        if (!eventos.some((e) => e.area === "informações da obra")) {
          eventos.push({ area: "informações da obra", frase: "Informações da obra atualizadas." });
        }
        obraMudou = true;
      }
      if (
        dados.obra.liberadoParaMudanca !== undefined &&
        dados.obra.liberadoParaMudanca !== obraAtual.liberadoParaMudanca
      ) {
        addObraSet("liberado_para_mudanca", dados.obra.liberadoParaMudanca);
        auditLogs.push({
          entidade: "Obra",
          entidadeId: obraId,
          campoAlterado: "liberadoParaMudanca",
          valorAnterior: String(obraAtual.liberadoParaMudanca),
          valorNovo: String(dados.obra.liberadoParaMudanca),
        });
        eventos.push({ area: "situação da mudança", frase: "Situação da mudança atualizada." });
        obraMudou = true;
      }
      if (dados.obra.dataMudanca !== undefined && dados.obra.dataMudanca !== obraAtual.dataMudanca) {
        addObraSet("data_mudanca", dados.obra.dataMudanca);
        auditLogs.push({
          entidade: "Obra",
          entidadeId: obraId,
          campoAlterado: "dataMudanca",
          valorAnterior: obraAtual.dataMudanca,
          valorNovo: dados.obra.dataMudanca,
        });
        if (!eventos.some((e) => e.area === "situação da mudança")) {
          eventos.push({ area: "situação da mudança", frase: "Situação da mudança atualizada." });
        }
        obraMudou = true;
      }

      if (obraSets.length > 0) {
        await client.query(`UPDATE obras SET ${obraSets.join(", ")}, atualizado_em = now() WHERE id = $1`, obraParams);
        obraCamposAtualizados = true;
      }

      if (statusObraNovo && statusObraNovo.id !== obraAtual.statusId) {
        await client.query(`UPDATE obra_status_historico SET data_fim = now() WHERE obra_id = $1 AND data_fim IS NULL`, [
          obraId,
        ]);
        await client.query(
          `INSERT INTO obra_status_historico (obra_id, status_id, data_inicio, usuario_id, observacao)
           VALUES ($1, $2, now(), $3, 'Edição manual do lote')`,
          [obraId, statusObraNovo.id, usuarioId]
        );
        auditLogs.push({
          entidade: "Obra",
          entidadeId: obraId,
          campoAlterado: "statusCodigo",
          valorAnterior: obraAtual.statusCodigo,
          valorNovo: statusObraNovo.codigo,
        });
        eventos.push({
          area: "status da obra",
          frase: `Status alterado de '${obraAtual.statusDescricao ?? "não informado"}' para '${statusObraNovo.descricao}'.`,
        });
        obraMudou = true;
      }
    }

    // ---- Responsáveis técnicos (obra_pessoa) ----
    if (dados.responsaveisTecnicos !== undefined && obraId) {
      const atuaisRes = await client.query<{ pessoaId: string }>(
        `SELECT pessoa_id AS "pessoaId" FROM obra_pessoa WHERE obra_id = $1 AND papel = 'RESPONSAVEL_TECNICO'`,
        [obraId]
      );
      const { removidos, adicionados } = diferencaDeConjuntos(
        new Set(atuaisRes.rows.map((r) => r.pessoaId)),
        new Set(dados.responsaveisTecnicos.map((r) => r.pessoaId))
      );

      for (const pessoaId of removidos) {
        await client.query(
          `DELETE FROM obra_pessoa WHERE obra_id = $1 AND pessoa_id = $2 AND papel = 'RESPONSAVEL_TECNICO'`,
          [obraId, pessoaId]
        );
        const tipoRes = await client.query<{ tipo: string | null }>(
          `SELECT tipo FROM pessoa_dados_profissionais WHERE pessoa_id = $1`,
          [pessoaId]
        );
        const tipo = tipoRes.rows[0]?.tipo ?? null;
        eventos.push({
          area: "responsáveis técnicos",
          frase: `Responsável técnico${tipo ? ` ${LABEL_TIPO_PROFISSIONAL[tipo] ?? tipo.toLowerCase()}` : ""} removido.`,
        });
      }
      for (const item of dados.responsaveisTecnicos) {
        if (!adicionados.includes(item.pessoaId)) continue;
        if (item.tipo) {
          await client.query(
            `INSERT INTO pessoa_dados_profissionais (pessoa_id, tipo) VALUES ($1, $2)
             ON CONFLICT (pessoa_id) DO UPDATE SET tipo = EXCLUDED.tipo`,
            [item.pessoaId, item.tipo]
          );
        }
        await client.query(
          `INSERT INTO obra_pessoa (obra_id, pessoa_id, papel) VALUES ($1, $2, 'RESPONSAVEL_TECNICO')`,
          [obraId, item.pessoaId]
        );
        eventos.push({
          area: "responsáveis técnicos",
          frase: `Responsável técnico${item.tipo ? ` ${LABEL_TIPO_PROFISSIONAL[item.tipo]}` : ""} adicionado.`,
        });
      }
    }

    // ---- Lote de apoio (lote_apoio, direção USA_APOIO a partir deste lote) ----
    if (dados.loteApoioIds !== undefined) {
      const atuaisRes = await client.query<{ loteApoioId: string }>(
        `SELECT lote_apoio_id AS "loteApoioId" FROM lote_apoio WHERE lote_em_obra_id = $1`,
        [loteId]
      );
      const { removidos, adicionados } = diferencaDeConjuntos(
        new Set(atuaisRes.rows.map((r) => r.loteApoioId)),
        new Set(dados.loteApoioIds)
      );

      for (const apoioId of removidos) {
        await client.query(`DELETE FROM lote_apoio WHERE lote_em_obra_id = $1 AND lote_apoio_id = $2`, [
          loteId,
          apoioId,
        ]);
      }
      for (const apoioId of adicionados) {
        await client.query(
          `INSERT INTO lote_apoio (lote_em_obra_id, lote_apoio_id, observacao) VALUES ($1, $2, 'Edição manual do lote')`,
          [loteId, apoioId]
        );
      }
      if (removidos.length > 0 || adicionados.length > 0) {
        eventos.push({ area: "lote de apoio", frase: "Lote de apoio alterado." });
      }
    }

    // ---- Nada mudou: no-op completo, sem histórico/audit/atualizado_em ----
    if (eventos.length === 0) {
      return buscarLotePorId(client, loteId);
    }

    // obraMudou cobre mudanças de status (grava em obra_status_historico, não
    // em `obras`) — só precisa deste UPDATE extra quando nenhum campo próprio
    // de `obras` mudou junto (senão o UPDATE lá em cima já tocou atualizado_em).
    if (obraMudou && obraId && !obraCamposAtualizados) {
      await client.query(`UPDATE obras SET atualizado_em = now() WHERE id = $1`, [obraId]);
    }

    for (const log of auditLogs) {
      await client.query(
        `INSERT INTO audit_logs (entidade, entidade_id, acao, campo_alterado, valor_anterior, valor_novo, usuario_id, observacao)
         VALUES ($1, $2, 'UPDATE', $3, $4, $5, $6, 'Edição completa do lote')`,
        [log.entidade, log.entidadeId, log.campoAlterado, log.valorAnterior, log.valorNovo, usuarioId]
      );
    }

    await client.query(
      `INSERT INTO anotacoes (lote_id, data, texto, origem) VALUES ($1, now(), $2, 'EDICAO_SISTEMA')`,
      [loteId, construirResumo(eventos)]
    );

    return buscarLotePorId(client, loteId);
  });
}
