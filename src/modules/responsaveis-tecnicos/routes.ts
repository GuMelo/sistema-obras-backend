import type { FastifyInstance } from "fastify";
import {
  buscarResponsavelTecnicoPorId,
  listarResponsaveisTecnicos,
  tornarResponsavelTecnico,
} from "./service.js";
import { envelopePaginado, idParamSchema, paginacaoQuerySchema, respostasErroPadrao } from "../../lib/schemas.js";

const responsavelSchema = {
  type: "object",
  properties: {
    pessoaId: { type: "string" },
    nome: { type: "string" },
    tipo: { type: ["string", "null"] },
    registroProfissional: { type: ["string", "null"] },
    telefone: { type: ["string", "null"] },
    email: { type: ["string", "null"] },
    totalObras: { type: "integer" },
  },
} as const;

export default async function responsaveisTecnicosRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get<{ Querystring: { busca?: string; page?: number; pageSize?: number } }>(
    "/responsaveis-tecnicos",
    {
      schema: {
        tags: ["Responsáveis Técnicos"],
        summary: "Lista pessoas que atuam como responsável técnico (arquiteto/engenheiro).",
        description:
          "Responsável técnico não é uma entidade separada — é uma Pessoa com a extensão " +
          "PessoaDadosProfissionais preenchida, para não duplicar cadastro de quem também é proprietário.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: { busca: { type: "string" }, ...paginacaoQuerySchema.properties },
        },
        response: { 200: envelopePaginado(responsavelSchema), ...respostasErroPadrao },
      },
    },
    async (request) => listarResponsaveisTecnicos(fastify.pg, request.query)
  );

  fastify.get<{ Params: { id: string } }>(
    "/responsaveis-tecnicos/:id",
    {
      schema: {
        tags: ["Responsáveis Técnicos"],
        summary: "Consulta um responsável técnico por id de Pessoa.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: responsavelSchema, ...respostasErroPadrao },
      },
    },
    async (request) => buscarResponsavelTecnicoPorId(fastify.pg, request.params.id)
  );

  fastify.post<{ Params: { id: string }; Body: { tipo?: string; registroProfissional?: string } }>(
    "/responsaveis-tecnicos/:id",
    {
      preHandler: fastify.authorize("ADMIN", "ANALISTA"),
      schema: {
        tags: ["Responsáveis Técnicos"],
        summary: "Marca uma Pessoa existente como responsável técnico (ADMIN ou ANALISTA).",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        body: {
          type: "object",
          properties: { tipo: { type: "string" }, registroProfissional: { type: "string" } },
        },
        response: { 200: responsavelSchema, ...respostasErroPadrao },
      },
    },
    async (request) => tornarResponsavelTecnico(fastify.pg, request.params.id, request.body)
  );
}
