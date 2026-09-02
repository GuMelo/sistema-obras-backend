import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply, type FastifyError } from "fastify";
import sensible from "@fastify/sensible";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import multipart from "@fastify/multipart";

import dbPlugin from "./plugins/db.js";
import authPlugin from "./plugins/auth.js";
import { checkDatabaseConnection } from "./lib/db.js";
import { AppError } from "./lib/errors.js";

import authRoutes from "./modules/auth/routes.js";
import usersRoutes from "./modules/users/routes.js";
import condominiosRoutes from "./modules/condominios/routes.js";
import quadrasRoutes from "./modules/quadras/routes.js";
import lotesRoutes from "./modules/lotes/routes.js";
import pessoasRoutes from "./modules/pessoas/routes.js";
import responsaveisTecnicosRoutes from "./modules/responsaveis-tecnicos/routes.js";
import obrasRoutes from "./modules/obras/routes.js";
import statusObraRoutes from "./modules/status-obra/routes.js";
import anotacoesRoutes from "./modules/anotacoes/routes.js";
import documentosRoutes from "./modules/documentos/routes.js";
import historicoRoutes from "./modules/historico/routes.js";
import importacoesRoutes from "./modules/importacoes/routes.js";
import dashboardRoutes from "./modules/dashboard/routes.js";
import auditoriaRoutes from "./modules/auditoria/routes.js";
import relatoriosRoutes from "./modules/relatorios/routes.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  app.register(sensible);
  // @fastify/cors default methods é "GET,HEAD,POST" (opção `methods` da lib,
  // não específica deste projeto) — sem sobrescrever, PATCH/PUT/DELETE nunca
  // passavam no preflight do navegador, mesmo com o endpoint funcionando
  // normalmente fora do navegador (sem preflight).
  app.register(cors, { origin: true, methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] });
  app.register(multipart);
  app.register(dbPlugin);
  app.register(authPlugin);

  app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "sistema-obras-backend API",
        description:
          "API do sistema de gestão de lotes, obras e projetos (condomínio Rudá). " +
          "Escopo exclusivo: planilha CONTROLE E GESTÃO - OBRAS E PROJETOS — não há módulo de notificações.",
        version: "1.0.0",
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
      tags: [
        { name: "Auth" },
        { name: "Users" },
        { name: "Condomínios" },
        { name: "Quadras" },
        { name: "Lotes" },
        { name: "Pessoas" },
        { name: "Responsáveis Técnicos" },
        { name: "Obras" },
        { name: "Status de Obra" },
        { name: "Anotações" },
        { name: "Documentos" },
        { name: "Histórico" },
        { name: "Importações" },
        { name: "Dashboard" },
        { name: "Auditoria" },
        { name: "Relatórios" },
      ],
    },
  });
  app.register(swaggerUI, { routePrefix: "/docs" });

  // Handler de erro global: qualquer AppError (ver lib/errors.ts) vira a
  // resposta HTTP correspondente; qualquer outro erro não tratado vira 500,
  // sem vazar detalhes internos (stack trace só vai pro log).
  app.setErrorHandler((error: FastifyError | AppError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        code: error.code,
        message: error.message,
      });
    }
    if (error.validation) {
      return reply.code(400).send({
        statusCode: 400,
        code: "VALIDATION_ERROR",
        message: error.message,
      });
    }
    request.log.error(error);
    return reply.code(500).send({
      statusCode: 500,
      code: "INTERNAL_ERROR",
      message: "Erro interno inesperado.",
    });
  });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/health/db", async (_request, reply) => {
    try {
      const ok = await checkDatabaseConnection();
      if (!ok) return reply.internalServerError("Banco de dados retornou resposta inesperada");
      return { status: "ok" };
    } catch (err) {
      app.log.error(err);
      return reply.internalServerError("Não foi possível conectar ao banco de dados");
    }
  });

  app.register(authRoutes);
  app.register(usersRoutes);
  app.register(condominiosRoutes);
  app.register(quadrasRoutes);
  app.register(lotesRoutes);
  app.register(pessoasRoutes);
  app.register(responsaveisTecnicosRoutes);
  app.register(obrasRoutes);
  app.register(statusObraRoutes);
  app.register(anotacoesRoutes);
  app.register(documentosRoutes);
  app.register(historicoRoutes);
  app.register(importacoesRoutes);
  app.register(dashboardRoutes);
  app.register(auditoriaRoutes);
  app.register(relatoriosRoutes);

  return app;
}
