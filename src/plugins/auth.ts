/**
 * Autenticação e autorização — aplicadas SEMPRE no backend, nunca confiando
 * no frontend (o frontend só decide o que MOSTRAR; o que é PERMITIDO é
 * decidido aqui, em cada rota).
 *
 * - `authenticate`: preHandler que exige um JWT válido, decorando
 *   `request.usuario` com { id, email, role }.
 * - `authorize(...roles)`: preHandler factory que exige que o usuário
 *   autenticado tenha um dos papéis informados. Lança ForbiddenError (403)
 *   caso contrário — nunca falha silenciosamente permitindo o acesso.
 */
import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ForbiddenError, UnauthorizedError } from "../lib/errors.js";

export type RoleUsuario = "ADMIN" | "ANALISTA" | "CONSULTA";

export interface UsuarioAutenticado {
  id: string;
  email: string;
  role: RoleUsuario;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: UsuarioAutenticado;
    user: UsuarioAutenticado;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
    authorize: (...roles: RoleUsuario[]) => (request: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    usuario?: UsuarioAutenticado;
  }
}

export default fp(async function authPlugin(fastify: FastifyInstance) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET não configurado — obrigatório para autenticação.");
  }

  await fastify.register(jwt, {
    secret,
    sign: { expiresIn: "8h" },
  });

  fastify.decorate("authenticate", async (request: FastifyRequest) => {
    try {
      const payload = await request.jwtVerify<UsuarioAutenticado>();
      request.usuario = payload;
    } catch {
      throw new UnauthorizedError("Token ausente, inválido ou expirado.");
    }
  });

  fastify.decorate("authorize", (...roles: RoleUsuario[]) => {
    return async (request: FastifyRequest) => {
      if (!request.usuario) {
        throw new UnauthorizedError();
      }
      if (!roles.includes(request.usuario.role)) {
        throw new ForbiddenError(
          `Ação restrita a: ${roles.join(", ")}. Seu papel atual é ${request.usuario.role}.`
        );
      }
    };
  });
});
