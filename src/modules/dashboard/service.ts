import type { Pool } from "pg";
import { ValidationAppError } from "../../lib/errors.js";

export interface DashboardResumo {
  totalLotes: number;
  lotesPorOcupacao: Array<{ ocupacao: string; quantidade: number }>;
  lotesEmAlerta: number;
  obrasPorStatus: Array<{ statusCodigo: string; descricao: string; quantidade: number }>;
  obrasPorTipo: Array<{ tipo: string; quantidade: number }>;
  totalPessoas: number;
  totalResponsaveisTecnicos: number;
  importacoesRecentes: Array<{
    id: string;
    status: string;
    iniciadoEm: string;
    linhasComSucesso: number | null;
    linhasComErro: number | null;
  }>;
}

/**
 * Todas as métricas são calculadas com agregação SQL (count/group by) — o
 * frontend nunca precisa buscar a lista completa de lotes para montar um
 * gráfico ou indicador.
 */
export async function obterResumoDashboard(pool: Pool): Promise<DashboardResumo> {
  const [totalLotes, ocupacao, alerta, statusObra, tipoObra, pessoas, responsaveis, importacoes] = await Promise.all([
    pool.query<{ total: string }>(`SELECT count(*) AS total FROM lotes`),
    pool.query<{ ocupacao: string | null; quantidade: string }>(
      `SELECT oc.ocupacao, count(*) AS quantidade
       FROM lotes l LEFT JOIN lote_ocupacao_historico oc ON oc.lote_id = l.id AND oc.data_fim IS NULL
       GROUP BY oc.ocupacao`
    ),
    pool.query<{ total: string }>(`SELECT count(*) AS total FROM lotes WHERE em_alerta = true`),
    pool.query<{ codigo: string; descricao: string; quantidade: string }>(
      `SELECT so.codigo, so.descricao, count(*) AS quantidade
       FROM obra_status_historico osh
       JOIN status_obra so ON so.id = osh.status_id
       WHERE osh.data_fim IS NULL
       GROUP BY so.codigo, so.descricao, so.ordem_exibicao
       ORDER BY so.ordem_exibicao`
    ),
    pool.query<{ tipo: string | null; quantidade: string }>(
      `SELECT tipo, count(*) AS quantidade FROM obras GROUP BY tipo`
    ),
    pool.query<{ total: string }>(`SELECT count(*) AS total FROM pessoas`),
    pool.query<{ total: string }>(`SELECT count(*) AS total FROM pessoa_dados_profissionais`),
    pool.query(
      `SELECT id, status, iniciado_em AS "iniciadoEm", linhas_com_sucesso AS "linhasComSucesso",
              linhas_com_erro AS "linhasComErro"
       FROM importacao_execucoes ORDER BY iniciado_em DESC LIMIT 5`
    ),
  ]);

  return {
    totalLotes: Number(totalLotes.rows[0].total),
    lotesPorOcupacao: ocupacao.rows.map((r) => ({
      ocupacao: r.ocupacao ?? "NAO_INFORMADO",
      quantidade: Number(r.quantidade),
    })),
    lotesEmAlerta: Number(alerta.rows[0].total),
    obrasPorStatus: statusObra.rows.map((r) => ({
      statusCodigo: r.codigo,
      descricao: r.descricao,
      quantidade: Number(r.quantidade),
    })),
    obrasPorTipo: tipoObra.rows.map((r) => ({
      tipo: r.tipo ?? "NAO_INFORMADO",
      quantidade: Number(r.quantidade),
    })),
    totalPessoas: Number(pessoas.rows[0].total),
    totalResponsaveisTecnicos: Number(responsaveis.rows[0].total),
    importacoesRecentes: importacoes.rows,
  };
}

export interface DashboardFiltros {
  quadraId?: string;
  statusObraId?: string;
  ocupacao?: "DISPONIVEL" | "MORADOR" | "NAO_INFORMADO";
  dataInicio?: string;
  dataFim?: string;
}

/**
 * Junção-base compartilhada por /indicadores: um lote, sua ocupação vigente
 * e a obra "atual" com seu status vigente — o mesmo desenho de join usado em
 * lotes/service.ts (SELECT_RESUMO), para que os dois endpoints concordem
 * sobre o que significa "status atual de um lote". A obra "atual" prioriza a
 * não-reforma, mas cai para a reforma quando essa é a única obra do lote
 * (ex.: lote cujo único registro de obra é "CASA EM REFORMA" — sem isso, o
 * LEFT JOIN simples deixava o lote sem obra nenhuma, mesmo tendo uma).
 */
const FROM_BASE = `
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

function montarFiltrosIndicadores(filtros: DashboardFiltros): { where: string; params: unknown[] } {
  const condicoes: string[] = [];
  const params: unknown[] = [];

  if (filtros.quadraId) {
    params.push(filtros.quadraId);
    condicoes.push(`q.id = $${params.length}`);
  }
  if (filtros.statusObraId) {
    params.push(filtros.statusObraId);
    condicoes.push(`so.id = $${params.length}`);
  }
  if (filtros.ocupacao === "NAO_INFORMADO") {
    condicoes.push(`oc.ocupacao IS NULL`);
  } else if (filtros.ocupacao) {
    params.push(filtros.ocupacao);
    condicoes.push(`oc.ocupacao = $${params.length}`);
  }
  // dataInicio/dataFim filtram pelo início do status vigente da obra — ou
  // seja, "indicadores considerando obras cujo status atual começou dentro
  // deste período". Lotes sem obra/status vigente saem do escopo quando
  // qualquer uma das duas datas é informada (osh.data_inicio é nulo).
  if (filtros.dataInicio) {
    params.push(filtros.dataInicio);
    condicoes.push(`osh.data_inicio >= $${params.length}`);
  }
  if (filtros.dataFim) {
    params.push(filtros.dataFim);
    condicoes.push(`osh.data_inicio <= $${params.length}`);
  }

  return { where: condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "", params };
}

export interface DashboardIndicadores {
  totalLotes: number;
  lotesPorOcupacao: Array<{ ocupacao: string; quantidade: number }>;
  lotesEmAlerta: number;
  obrasPorStatus: Array<{ statusCodigo: string; descricao: string; quantidade: number }>;
  obrasPorTipo: Array<{ tipo: string; quantidade: number }>;
  totalPessoas: number;
  totalResponsaveisTecnicos: number;
}

/**
 * Indicadores "no instante atual", com os mesmos filtros usados pela tela de
 * listagem de lotes (quadra, status de obra vigente, ocupação) mais um
 * recorte por período de início do status vigente. totalPessoas e
 * totalResponsaveisTecnicos ficam de fora do filtro: Pessoa não tem uma
 * relação direta com quadra/status/ocupação de lote, então filtrá-las por
 * esses eixos exigiria decidir uma regra de "pessoa pertence a este filtro"
 * que o domínio não define — por ora seguem como contagem global, igual a
 * /dashboard/resumo.
 */
export async function obterIndicadores(pool: Pool, filtros: DashboardFiltros): Promise<DashboardIndicadores> {
  const { where, params } = montarFiltrosIndicadores(filtros);

  const [totalLotes, ocupacao, alerta, statusObra, tipoObra, pessoas, responsaveis] = await Promise.all([
    pool.query<{ total: string }>(`SELECT count(DISTINCT l.id) AS total ${FROM_BASE} ${where}`, params),
    pool.query<{ ocupacao: string | null; quantidade: string }>(
      `SELECT oc.ocupacao, count(DISTINCT l.id) AS quantidade ${FROM_BASE} ${where} GROUP BY oc.ocupacao`,
      params
    ),
    pool.query<{ total: string }>(
      `SELECT count(DISTINCT l.id) AS total ${FROM_BASE} ${where ? `${where} AND` : "WHERE"} l.em_alerta = true`,
      params
    ),
    pool.query<{ codigo: string; descricao: string; quantidade: string }>(
      `SELECT so.codigo, so.descricao, count(DISTINCT o.id) AS quantidade ${FROM_BASE}
       ${where ? `${where} AND` : "WHERE"} so.id IS NOT NULL
       GROUP BY so.codigo, so.descricao, so.ordem_exibicao
       ORDER BY so.ordem_exibicao`,
      params
    ),
    pool.query<{ tipo: string | null; quantidade: string }>(
      `SELECT o.tipo, count(DISTINCT o.id) AS quantidade ${FROM_BASE}
       ${where ? `${where} AND` : "WHERE"} o.id IS NOT NULL
       GROUP BY o.tipo`,
      params
    ),
    pool.query<{ total: string }>(`SELECT count(*) AS total FROM pessoas`),
    pool.query<{ total: string }>(`SELECT count(*) AS total FROM pessoa_dados_profissionais`),
  ]);

  return {
    totalLotes: Number(totalLotes.rows[0].total),
    lotesPorOcupacao: ocupacao.rows.map((r) => ({
      ocupacao: r.ocupacao ?? "NAO_INFORMADO",
      quantidade: Number(r.quantidade),
    })),
    lotesEmAlerta: Number(alerta.rows[0].total),
    obrasPorStatus: statusObra.rows.map((r) => ({
      statusCodigo: r.codigo,
      descricao: r.descricao,
      quantidade: Number(r.quantidade),
    })),
    obrasPorTipo: tipoObra.rows.map((r) => ({
      tipo: r.tipo ?? "NAO_INFORMADO",
      quantidade: Number(r.quantidade),
    })),
    totalPessoas: Number(pessoas.rows[0].total),
    totalResponsaveisTecnicos: Number(responsaveis.rows[0].total),
  };
}

const GRANULARIDADE_SQL: Record<string, string> = {
  dia: "day",
  semana: "week",
  mes: "month",
};

export interface DashboardEvolucaoFiltros {
  quadraId?: string;
  statusObraId?: string;
  dataInicio?: string;
  dataFim?: string;
  granularidade?: string;
}

export interface DashboardEvolucaoPonto {
  periodo: string;
  statusCodigo: string;
  descricao: string;
  quantidade: number;
}

export interface DashboardEvolucao {
  granularidade: "dia" | "semana" | "mes";
  serie: DashboardEvolucaoPonto[];
}

/**
 * Evolução ao longo do tempo de quantas obras entraram em cada status
 * (contagem de linhas de obra_status_historico cujo início cai em cada
 * bucket de tempo). Formato "longo" (uma linha por período+status) em vez de
 * uma coluna por status, para o frontend poder montar qualquer gráfico
 * (linha por status, barras empilhadas etc.) sem o backend decidir o layout.
 */
export async function obterEvolucao(pool: Pool, filtros: DashboardEvolucaoFiltros): Promise<DashboardEvolucao> {
  const granularidade = filtros.granularidade ?? "mes";
  const truncBy = GRANULARIDADE_SQL[granularidade];
  if (!truncBy) {
    throw new ValidationAppError(
      `Granularidade inválida: "${filtros.granularidade}". Válidas: ${Object.keys(GRANULARIDADE_SQL).join(", ")}.`
    );
  }

  const condicoes: string[] = [];
  const params: unknown[] = [];

  if (filtros.quadraId) {
    params.push(filtros.quadraId);
    condicoes.push(`q.id = $${params.length}`);
  }
  if (filtros.statusObraId) {
    params.push(filtros.statusObraId);
    condicoes.push(`so.id = $${params.length}`);
  }
  if (filtros.dataInicio) {
    params.push(filtros.dataInicio);
    condicoes.push(`osh.data_inicio >= $${params.length}`);
  }
  if (filtros.dataFim) {
    params.push(filtros.dataFim);
    condicoes.push(`osh.data_inicio <= $${params.length}`);
  }
  const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";

  const res = await pool.query<{ periodoRaw: Date; codigo: string; descricao: string; quantidade: string }>(
    `SELECT date_trunc('${truncBy}', osh.data_inicio) AS "periodoRaw", so.codigo, so.descricao,
            count(DISTINCT osh.id) AS quantidade
     FROM obra_status_historico osh
     JOIN status_obra so ON so.id = osh.status_id
     JOIN obras o ON o.id = osh.obra_id
     JOIN lotes l ON l.id = o.lote_id
     JOIN quadras q ON q.id = l.quadra_id
     ${where}
     GROUP BY "periodoRaw", so.codigo, so.descricao, so.ordem_exibicao
     ORDER BY "periodoRaw" ASC, so.ordem_exibicao ASC`,
    params
  );

  const formatarPeriodo = (data: Date): string =>
    granularidade === "mes" ? data.toISOString().slice(0, 7) : data.toISOString().slice(0, 10);

  return {
    granularidade: granularidade as "dia" | "semana" | "mes",
    serie: res.rows.map((r) => ({
      periodo: formatarPeriodo(r.periodoRaw),
      statusCodigo: r.codigo,
      descricao: r.descricao,
      quantidade: Number(r.quantidade),
    })),
  };
}
