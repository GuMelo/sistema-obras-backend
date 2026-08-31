import type { FastifyInstance } from "fastify";
import {
  atualizarPessoa,
  buscarPessoaPorId,
  criarPessoa,
  listarLotesDaPessoa,
  listarObrasDaPessoa,
  listarPessoas,
} from "./service.js";
import { envelopePaginado, idParamSchema, paginacaoQuerySchema, respostasErroPadrao } from "../../lib/schemas.js";

const pessoaSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    nome: { type: "string" },
    tipoPessoa: { type: "string", enum: ["FISICA", "JURIDICA"] },
    documento: { type: ["string", "null"] },
    telefone: { type: ["string", "null"] },
    email: { type: ["string", "null"] },
    ehResponsavelTecnico: { type: "boolean" },
  },
} as const;

export default async function pessoasRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get<{ Querystring: { busca?: string; page?: number; pageSize?: number } }>(
    "/pessoas",
    {
      schema: {
        tags: ["Pessoas"],
        summary: "Lista pessoas (proprietários e/ou responsáveis técnicos), com busca por nome.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: { busca: { type: "string" }, ...paginacaoQuerySchema.properties },
        },
        response: { 200: envelopePaginado(pessoaSchema), ...respostasErroPadrao },
      },
    },
    async (request) => listarPessoas(fastify.pg, request.query)
  );

  fastify.get<{ Params: { id: string } }>(
    "/pessoas/:id",
    {
      schema: {
        tags: ["Pessoas"],
        summary: "Consulta uma pessoa por id.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: pessoaSchema, ...respostasErroPadrao },
      },
    },
    async (request) => buscarPessoaPorId(fastify.pg, request.params.id)
  );

  fastify.post<{
    Body: { nome: string; tipoPessoa: "FISICA" | "JURIDICA"; documento?: string; telefone?: string; email?: string };
  }>(
    "/pessoas",
    {
      preHandler: fastify.authorize("ADMIN", "ANALISTA"),
      schema: {
        tags: ["Pessoas"],
        summary: "Cadastra uma pessoa (ADMIN ou ANALISTA).",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            nome: { type: "string", minLength: 1 },
            tipoPessoa: { type: "string", enum: ["FISICA", "JURIDICA"] },
            documento: { type: "string" },
            telefone: { type: "string" },
            email: { type: "string", format: "email" },
          },
          required: ["nome", "tipoPessoa"],
        },
        response: { 201: pessoaSchema, ...respostasErroPadrao },
      },
    },
    async (request, reply) => {
      const criada = await criarPessoa(fastify.pg, request.body);
      reply.code(201);
      return criada;
    }
  );

  fastify.patch<{
    Params: { id: string };
    Body: Partial<{ nome: string; telefone: string; email: string; documento: string }>;
  }>(
    "/pessoas/:id",
    {
      preHandler: fastify.authorize("ADMIN", "ANALISTA"),
      schema: {
        tags: ["Pessoas"],
        summary: "Atualiza dados de uma pessoa (ADMIN ou ANALISTA).",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        body: {
          type: "object",
          properties: {
            nome: { type: "string" },
            telefone: { type: "string" },
            email: { type: "string", format: "email" },
            documento: { type: "string" },
          },
        },
        response: { 200: pessoaSchema, ...respostasErroPadrao },
      },
    },
    async (request) => atualizarPessoa(fastify.pg, request.params.id, request.body)
  );

  fastify.get<{ Params: { id: string } }>(
    "/pessoas/:id/lotes",
    {
      schema: {
        tags: ["Pessoas"],
        summary: "Lista os lotes em que esta pessoa é titular ou cotitular.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: { type: "array", items: { type: "object", additionalProperties: true } }, ...respostasErroPadrao },
      },
    },
    async (request) => listarLotesDaPessoa(fastify.pg, request.params.id)
  );

  fastify.get<{ Params: { id: string } }>(
    "/pessoas/:id/obras",
    {
      schema: {
        tags: ["Pessoas"],
        summary: "Lista as obras em que esta pessoa é responsável técnico.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: { type: "array", items: { type: "object", additionalProperties: true } }, ...respostasErroPadrao },
      },
    },
    async (request) => listarObrasDaPessoa(fastify.pg, request.params.id)
  );
}
