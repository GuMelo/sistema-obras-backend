import type { FastifyInstance } from "fastify";
import { buscarQuadraPorId, criarQuadra, listarQuadras } from "./service.js";
import { idParamSchema, respostasErroPadrao } from "../../lib/schemas.js";

const quadraSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    condominioId: { type: "string" },
    codigo: { type: "string" },
  },
} as const;

export default async function quadrasRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get<{ Querystring: { condominioId?: string } }>(
    "/quadras",
    {
      schema: {
        tags: ["Quadras"],
        summary: "Lista quadras, opcionalmente filtradas por condomínio.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: { condominioId: { type: "string", format: "uuid" } },
        },
        response: { 200: { type: "array", items: quadraSchema }, ...respostasErroPadrao },
      },
    },
    async (request) => listarQuadras(fastify.pg, request.query.condominioId)
  );

  fastify.get<{ Params: { id: string } }>(
    "/quadras/:id",
    {
      schema: {
        tags: ["Quadras"],
        summary: "Consulta uma quadra por id.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: quadraSchema, ...respostasErroPadrao },
      },
    },
    async (request) => buscarQuadraPorId(fastify.pg, request.params.id)
  );

  fastify.post<{ Body: { condominioId: string; codigo: string } }>(
    "/quadras",
    {
      preHandler: fastify.authorize("ADMIN"),
      schema: {
        tags: ["Quadras"],
        summary: "Cria uma quadra (somente ADMIN).",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            condominioId: { type: "string", format: "uuid" },
            codigo: { type: "string", minLength: 1 },
          },
          required: ["condominioId", "codigo"],
        },
        response: { 201: quadraSchema, ...respostasErroPadrao },
      },
    },
    async (request, reply) => {
      const criada = await criarQuadra(fastify.pg, request.body);
      reply.code(201);
      return criada;
    }
  );
}
