import type { FastifyInstance } from "fastify";
import { alterarSenhaPropria, autenticar } from "./service.js";
import { respostasErroPadrao } from "../../lib/schemas.js";

interface LoginBody {
  email: string;
  senha: string;
}

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: LoginBody }>(
    "/auth/login",
    {
      schema: {
        tags: ["Auth"],
        summary: "Autentica um usuário e devolve um token JWT.",
        body: {
          type: "object",
          properties: {
            email: { type: "string", format: "email" },
            senha: { type: "string", minLength: 1 },
          },
          required: ["email", "senha"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              token: { type: "string" },
              usuario: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  nome: { type: "string" },
                  email: { type: "string" },
                  role: { type: "string", enum: ["ADMIN", "ANALISTA", "CONSULTA"] },
                },
              },
            },
          },
          ...respostasErroPadrao,
        },
      },
    },
    async (request) => {
      const { email, senha } = request.body;
      const usuario = await autenticar(fastify.pg, email, senha);
      const token = fastify.jwt.sign({ id: usuario.id, email: usuario.email, role: usuario.role });
      return { token, usuario };
    }
  );

  fastify.get(
    "/auth/me",
    {
      preHandler: fastify.authenticate,
      schema: {
        tags: ["Auth"],
        summary: "Dados do usuário autenticado (a partir do token).",
        security: [{ bearerAuth: [] }],
        response: { 200: { type: "object", additionalProperties: true }, ...respostasErroPadrao },
      },
    },
    async (request) => {
      return request.usuario;
    }
  );

  fastify.patch<{ Body: { senhaAtual: string; novaSenha: string } }>(
    "/auth/senha",
    {
      preHandler: fastify.authenticate,
      schema: {
        tags: ["Auth"],
        summary: "Troca a própria senha (qualquer papel autenticado).",
        description:
          "Exige a senha atual para confirmar a identidade. Só altera a senha do próprio usuário do token — " +
          "para um ADMIN redefinir a senha de outro usuário sem saber a senha atual dele, ver PATCH /users/:id.",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            senhaAtual: { type: "string", minLength: 1 },
            novaSenha: { type: "string", minLength: 8 },
          },
          required: ["senhaAtual", "novaSenha"],
        },
        response: { 204: { type: "null" }, ...respostasErroPadrao },
      },
    },
    async (request, reply) => {
      await alterarSenhaPropria(fastify.pg, request.usuario!.id, request.body.senhaAtual, request.body.novaSenha);
      reply.code(204);
    }
  );
}
