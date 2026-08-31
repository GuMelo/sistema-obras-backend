import type { FastifyInstance } from "fastify";
import { listarAuditLogs } from "./service.js";
import { envelopePaginado, paginacaoQuerySchema, respostasErroPadrao } from "../../lib/schemas.js";

export default async function auditoriaRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.authorize("ADMIN"));

  fastify.get<{
    Querystring: { entidade?: string; entidadeId?: string; usuarioId?: string; page?: number; pageSize?: number };
  }>(
    "/auditoria",
    {
      schema: {
        tags: ["Auditoria"],
        summary: "Consulta o log de auditoria (somente ADMIN).",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            entidade: { type: "string" },
            entidadeId: { type: "string", format: "uuid" },
            usuarioId: { type: "string", format: "uuid" },
            ...paginacaoQuerySchema.properties,
          },
        },
        response: { 200: envelopePaginado({ type: "object", additionalProperties: true }), ...respostasErroPadrao },
      },
    },
    async (request) => listarAuditLogs(fastify.pg, request.query)
  );
}
