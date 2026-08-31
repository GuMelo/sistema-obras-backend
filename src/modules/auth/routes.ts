import type { FastifyInstance } from "fastify";
import { autenticar } from "./service.js";
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
}
