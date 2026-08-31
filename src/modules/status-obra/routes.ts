import type { FastifyInstance } from "fastify";
import { listarStatusObra } from "./service.js";
import { respostasErroPadrao } from "../../lib/schemas.js";

const statusObraSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    codigo: { type: "string" },
    descricao: { type: "string" },
    ordemExibicao: { type: "integer" },
    ativo: { type: "boolean" },
  },
} as const;

/**
 * Catálogo fechado de status de obra (hoje 8 registros, cadastrados via
 * seed). Não expõe cor: cor é um detalhe de apresentação, não um dado de
 * domínio — o frontend mapeia `codigo` -> cor localmente, como já faz para
 * outros enums (ex.: OcupacaoLote).
 */
export default async function statusObraRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get(
    "/status-obra",
    {
      schema: {
        tags: ["Status de Obra"],
        summary: "Lista o catálogo canônico de status de obra, ordenado por ordem de exibição.",
        security: [{ bearerAuth: [] }],
        response: { 200: { type: "array", items: statusObraSchema }, ...respostasErroPadrao },
      },
    },
    async () => listarStatusObra(fastify.pg)
  );
}
