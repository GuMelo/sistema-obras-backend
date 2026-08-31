import type { FastifyInstance } from "fastify";
import { obterEvolucao, obterIndicadores, obterResumoDashboard } from "./service.js";
import { respostasErroPadrao } from "../../lib/schemas.js";

const indicadoresQuerySchema = {
  type: "object",
  properties: {
    quadraId: { type: "string", format: "uuid" },
    statusObraId: { type: "string", format: "uuid" },
    ocupacao: { type: "string", enum: ["DISPONIVEL", "MORADOR", "NAO_INFORMADO"] },
    dataInicio: { type: "string", format: "date" },
    dataFim: { type: "string", format: "date" },
  },
} as const;

const indicadoresResponseSchema = {
  type: "object",
  properties: {
    totalLotes: { type: "integer" },
    lotesPorOcupacao: {
      type: "array",
      items: {
        type: "object",
        properties: { ocupacao: { type: "string" }, quantidade: { type: "integer" } },
      },
    },
    lotesEmAlerta: { type: "integer" },
    obrasPorStatus: {
      type: "array",
      items: {
        type: "object",
        properties: {
          statusCodigo: { type: "string" },
          descricao: { type: "string" },
          quantidade: { type: "integer" },
        },
      },
    },
    obrasPorTipo: {
      type: "array",
      items: {
        type: "object",
        properties: { tipo: { type: "string" }, quantidade: { type: "integer" } },
      },
    },
    totalPessoas: { type: "integer" },
    totalResponsaveisTecnicos: { type: "integer" },
  },
} as const;

const evolucaoResponseSchema = {
  type: "object",
  properties: {
    granularidade: { type: "string", enum: ["dia", "semana", "mes"] },
    serie: {
      type: "array",
      items: {
        type: "object",
        properties: {
          periodo: { type: "string" },
          statusCodigo: { type: "string" },
          descricao: { type: "string" },
          quantidade: { type: "integer" },
        },
      },
    },
  },
} as const;

export default async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get(
    "/dashboard/resumo",
    {
      schema: {
        tags: ["Dashboard"],
        summary: "Indicadores agregados do sistema (todos calculados via SQL, sem carregar todos os lotes).",
        security: [{ bearerAuth: [] }],
        response: { 200: { type: "object", additionalProperties: true }, ...respostasErroPadrao },
      },
    },
    async () => obterResumoDashboard(fastify.pg)
  );

  fastify.get<{
    Querystring: {
      quadraId?: string;
      statusObraId?: string;
      ocupacao?: "DISPONIVEL" | "MORADOR" | "NAO_INFORMADO";
      dataInicio?: string;
      dataFim?: string;
    };
  }>(
    "/dashboard/indicadores",
    {
      schema: {
        tags: ["Dashboard"],
        summary: "Indicadores agregados no instante atual, filtráveis por quadra, status de obra e ocupação.",
        description:
          "dataInicio/dataFim filtram pelo início do status vigente da obra (osh.data_inicio) — ou seja, " +
          "'obras cujo status atual começou neste período'. totalPessoas e totalResponsaveisTecnicos são " +
          "contagens globais (Pessoa não tem relação direta com quadra/status/ocupação de lote).",
        security: [{ bearerAuth: [] }],
        querystring: indicadoresQuerySchema,
        response: { 200: indicadoresResponseSchema, ...respostasErroPadrao },
      },
    },
    async (request) => obterIndicadores(fastify.pg, request.query)
  );

  fastify.get<{
    Querystring: {
      quadraId?: string;
      statusObraId?: string;
      dataInicio?: string;
      dataFim?: string;
      granularidade?: string;
    };
  }>(
    "/dashboard/evolucao",
    {
      schema: {
        tags: ["Dashboard"],
        summary: "Série temporal de quantas obras entraram em cada status, agrupada por período.",
        description:
          "Uma linha por período+status (formato longo), contando osh.data_inicio dentro de cada bucket de " +
          "tempo — permite montar qualquer tipo de gráfico (linha por status, barras empilhadas etc.) sem o " +
          "backend decidir o layout.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            quadraId: { type: "string", format: "uuid" },
            statusObraId: { type: "string", format: "uuid" },
            dataInicio: { type: "string", format: "date" },
            dataFim: { type: "string", format: "date" },
            granularidade: { type: "string", enum: ["dia", "semana", "mes"], default: "mes" },
          },
        },
        response: { 200: evolucaoResponseSchema, ...respostasErroPadrao },
      },
    },
    async (request) => obterEvolucao(fastify.pg, request.query)
  );
}
