import type { FastifyInstance } from "fastify";
import { listarHistoricoOcupacao } from "../lotes/service.js";
import { listarHistoricoStatusObra } from "../obras/service.js";
import { idParamSchema, respostasErroPadrao } from "../../lib/schemas.js";

/**
 * Módulo "Histórico" como ponto único de consulta a qualquer trilha de
 * auditoria específica do domínio (ocupação de lote, status de obra) — sem
 * duplicar a lógica: reaproveita os serviços de Lotes/Obras, que continuam
 * também expondo `/lotes/:id/historico-ocupacao` e `/obras/:id/historico-status`
 * para quem já está na tela do lote/obra e não precisa de outro endpoint.
 */
export default async function historicoRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get<{ Params: { id: string } }>(
    "/historico/lotes/:id/ocupacao",
    {
      schema: {
        tags: ["Histórico"],
        summary: "Histórico de ocupação de um lote (equivalente a /lotes/{id}/historico-ocupacao).",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: { type: "array", items: { type: "object", additionalProperties: true } }, ...respostasErroPadrao },
      },
    },
    async (request) => listarHistoricoOcupacao(fastify.pg, request.params.id)
  );

  fastify.get<{ Params: { id: string } }>(
    "/historico/obras/:id/status",
    {
      schema: {
        tags: ["Histórico"],
        summary: "Histórico de status de uma obra (equivalente a /obras/{id}/historico-status).",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: { type: "array", items: { type: "object", additionalProperties: true } }, ...respostasErroPadrao },
      },
    },
    async (request) => listarHistoricoStatusObra(fastify.pg, request.params.id)
  );
}
