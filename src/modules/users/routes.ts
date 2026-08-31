import type { FastifyInstance } from "fastify";
import {
  atualizarUsuario,
  buscarUsuarioPorId,
  criarUsuario,
  listarUsuarios,
} from "./service.js";
import { envelopePaginado, idParamSchema, paginacaoQuerySchema, respostasErroPadrao } from "../../lib/schemas.js";

const usuarioSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    nome: { type: "string" },
    email: { type: "string" },
    role: { type: "string", enum: ["ADMIN", "ANALISTA", "CONSULTA"] },
    ativo: { type: "boolean" },
    criadoEm: { type: "string" },
  },
} as const;

export default async function usersRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.authorize("ADMIN"));

  fastify.get<{ Querystring: { role?: string; ativo?: boolean; page?: number; pageSize?: number; sort?: string } }>(
    "/users",
    {
      schema: {
        tags: ["Users"],
        summary: "Lista usuários do sistema (somente ADMIN).",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            role: { type: "string", enum: ["ADMIN", "ANALISTA", "CONSULTA"] },
            ativo: { type: "boolean" },
            ...paginacaoQuerySchema.properties,
          },
        },
        response: { 200: envelopePaginado(usuarioSchema), ...respostasErroPadrao },
      },
    },
    async (request) => {
      const q = request.query;
      return listarUsuarios(fastify.pg, {
        role: q.role as "ADMIN" | "ANALISTA" | "CONSULTA" | undefined,
        ativo: q.ativo,
        page: q.page,
        pageSize: q.pageSize,
        sort: q.sort,
      });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    "/users/:id",
    {
      schema: {
        tags: ["Users"],
        summary: "Consulta um usuário por id (somente ADMIN).",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: usuarioSchema, ...respostasErroPadrao },
      },
    },
    async (request) => buscarUsuarioPorId(fastify.pg, request.params.id)
  );

  fastify.post<{ Body: { nome: string; email: string; senha: string; role: "ADMIN" | "ANALISTA" | "CONSULTA" } }>(
    "/users",
    {
      schema: {
        tags: ["Users"],
        summary: "Cria um usuário (somente ADMIN).",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            nome: { type: "string", minLength: 1 },
            email: { type: "string", format: "email" },
            senha: { type: "string", minLength: 8 },
            role: { type: "string", enum: ["ADMIN", "ANALISTA", "CONSULTA"] },
          },
          required: ["nome", "email", "senha", "role"],
        },
        response: { 201: usuarioSchema, ...respostasErroPadrao },
      },
    },
    async (request, reply) => {
      const usuario = await criarUsuario(fastify.pg, request.body);
      reply.code(201);
      return usuario;
    }
  );

  fastify.patch<{
    Params: { id: string };
    Body: Partial<{ nome: string; role: "ADMIN" | "ANALISTA" | "CONSULTA"; ativo: boolean; senha: string }>;
  }>(
    "/users/:id",
    {
      schema: {
        tags: ["Users"],
        summary: "Atualiza dados de um usuário (somente ADMIN).",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        body: {
          type: "object",
          properties: {
            nome: { type: "string", minLength: 1 },
            role: { type: "string", enum: ["ADMIN", "ANALISTA", "CONSULTA"] },
            ativo: { type: "boolean" },
            senha: { type: "string", minLength: 8 },
          },
        },
        response: { 200: usuarioSchema, ...respostasErroPadrao },
      },
    },
    async (request) => atualizarUsuario(fastify.pg, request.params.id, request.body)
  );
}
