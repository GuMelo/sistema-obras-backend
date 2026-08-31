import type { FastifyInstance } from "fastify";
import { buscarAnotacaoPorId, criarAnotacao, listarAnotacoes } from "./service.js";
import { envelopePaginado, idParamSchema, paginacaoQuerySchema, respostasErroPadrao } from "../../lib/schemas.js";

const anotacaoSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    loteId: { type: ["string", "null"] },
    obraId: { type: ["string", "null"] },
    data: { type: "string" },
    texto: { type: "string" },
    autor: { type: ["string", "null"] },
    origem: { type: "string", enum: ["MANUAL", "IMPORTACAO_LEGADO"] },
  },
} as const;

export default async function anotacoesRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get<{ Querystring: { loteId?: string; obraId?: string; page?: number; pageSize?: number } }>(
    "/anotacoes",
    {
      schema: {
        tags: ["Anotações"],
        summary: "Lista anotações, filtradas por lote ou obra.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            loteId: { type: "string", format: "uuid" },
            obraId: { type: "string", format: "uuid" },
            ...paginacaoQuerySchema.properties,
          },
        },
        response: { 200: envelopePaginado(anotacaoSchema), ...respostasErroPadrao },
      },
    },
    async (request) => listarAnotacoes(fastify.pg, request.query)
  );

  fastify.get<{ Params: { id: string } }>(
    "/anotacoes/:id",
    {
      schema: {
        tags: ["Anotações"],
        summary: "Consulta uma anotação por id.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: anotacaoSchema, ...respostasErroPadrao },
      },
    },
    async (request) => buscarAnotacaoPorId(fastify.pg, request.params.id)
  );

  fastify.post<{ Body: { loteId?: string; obraId?: string; texto: string; autor?: string } }>(
    "/anotacoes",
    {
      preHandler: fastify.authorize("ADMIN", "ANALISTA"),
      schema: {
        tags: ["Anotações"],
        summary: "Cria uma anotação manual (ADMIN ou ANALISTA).",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            loteId: { type: "string", format: "uuid" },
            obraId: { type: "string", format: "uuid" },
            texto: { type: "string", minLength: 1 },
            autor: { type: "string" },
          },
          required: ["texto"],
        },
        response: { 201: anotacaoSchema, ...respostasErroPadrao },
      },
    },
    async (request, reply) => {
      const criada = await criarAnotacao(fastify.pg, request.body);
      reply.code(201);
      return criada;
    }
  );
}
