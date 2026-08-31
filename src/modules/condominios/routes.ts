import type { FastifyInstance } from "fastify";
import {
  atualizarCondominio,
  buscarCondominioPorId,
  criarCondominio,
  listarCondominios,
} from "./service.js";
import { idParamSchema, respostasErroPadrao } from "../../lib/schemas.js";

const condominioSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    nome: { type: "string" },
    cnpj: { type: ["string", "null"] },
    endereco: { type: ["string", "null"] },
  },
} as const;

export default async function condominiosRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get(
    "/condominios",
    {
      schema: {
        tags: ["Condomínios"],
        summary: "Lista condomínios cadastrados.",
        security: [{ bearerAuth: [] }],
        response: { 200: { type: "array", items: condominioSchema }, ...respostasErroPadrao },
      },
    },
    async () => listarCondominios(fastify.pg)
  );

  fastify.get<{ Params: { id: string } }>(
    "/condominios/:id",
    {
      schema: {
        tags: ["Condomínios"],
        summary: "Consulta um condomínio por id.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: condominioSchema, ...respostasErroPadrao },
      },
    },
    async (request) => buscarCondominioPorId(fastify.pg, request.params.id)
  );

  fastify.post<{ Body: { nome: string; cnpj?: string; endereco?: string } }>(
    "/condominios",
    {
      preHandler: fastify.authorize("ADMIN"),
      schema: {
        tags: ["Condomínios"],
        summary: "Cria um condomínio (somente ADMIN).",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            nome: { type: "string", minLength: 1 },
            cnpj: { type: "string" },
            endereco: { type: "string" },
          },
          required: ["nome"],
        },
        response: { 201: condominioSchema, ...respostasErroPadrao },
      },
    },
    async (request, reply) => {
      const criado = await criarCondominio(fastify.pg, request.body);
      reply.code(201);
      return criado;
    }
  );

  fastify.patch<{ Params: { id: string }; Body: Partial<{ nome: string; cnpj: string; endereco: string }> }>(
    "/condominios/:id",
    {
      preHandler: fastify.authorize("ADMIN"),
      schema: {
        tags: ["Condomínios"],
        summary: "Atualiza um condomínio (somente ADMIN).",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        body: {
          type: "object",
          properties: { nome: { type: "string" }, cnpj: { type: "string" }, endereco: { type: "string" } },
        },
        response: { 200: condominioSchema, ...respostasErroPadrao },
      },
    },
    async (request) => atualizarCondominio(fastify.pg, request.params.id, request.body)
  );
}
