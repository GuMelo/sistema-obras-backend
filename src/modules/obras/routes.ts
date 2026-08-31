import type { FastifyInstance } from "fastify";
import {
  atualizarObra,
  atualizarStatusObra,
  buscarObraPorId,
  criarObra,
  listarHistoricoStatusObra,
  listarObras,
  listarResponsaveisDaObra,
  vincularResponsavelTecnico,
} from "./service.js";
import { listarAnotacoes } from "../anotacoes/service.js";
import { listarDocumentos } from "../documentos/service.js";
import { envelopePaginado, idParamSchema, paginacaoQuerySchema, respostasErroPadrao } from "../../lib/schemas.js";

const obraSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    loteId: { type: "string" },
    quadraCodigo: { type: "string" },
    loteNumero: { type: "integer" },
    tipo: { type: ["string", "null"], enum: ["CONSTRUCAO_INICIAL", "REFORMA", null] },
    statusAtual: { type: ["string", "null"] },
    dataLiberacao: { type: ["string", "null"] },
    dataVistoriaPosObra: { type: ["string", "null"] },
    liberadoParaMudanca: { type: "boolean" },
    dataMudanca: { type: ["string", "null"] },
  },
} as const;

export default async function obrasRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get<{
    Querystring: {
      loteId?: string;
      quadraCodigo?: string;
      statusCodigo?: string;
      tipo?: "CONSTRUCAO_INICIAL" | "REFORMA";
      liberadoParaMudanca?: boolean;
      page?: number;
      pageSize?: number;
      sort?: string;
    };
  }>(
    "/obras",
    {
      schema: {
        tags: ["Obras"],
        summary: "Lista obras com filtros por lote, quadra, status vigente, tipo e liberação para mudança.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            loteId: { type: "string", format: "uuid" },
            quadraCodigo: { type: "string" },
            statusCodigo: { type: "string" },
            tipo: { type: "string", enum: ["CONSTRUCAO_INICIAL", "REFORMA"] },
            liberadoParaMudanca: { type: "boolean" },
            ...paginacaoQuerySchema.properties,
          },
        },
        response: { 200: envelopePaginado(obraSchema), ...respostasErroPadrao },
      },
    },
    async (request) => listarObras(fastify.pg, request.query)
  );

  fastify.get<{ Params: { id: string } }>(
    "/obras/:id",
    {
      schema: {
        tags: ["Obras"],
        summary: "Consulta uma obra por id.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: obraSchema, ...respostasErroPadrao },
      },
    },
    async (request) => buscarObraPorId(fastify.pg, request.params.id)
  );

  fastify.post<{ Body: { loteId: string; tipo?: "CONSTRUCAO_INICIAL" | "REFORMA" } }>(
    "/obras",
    {
      preHandler: fastify.authorize("ADMIN", "ANALISTA"),
      schema: {
        tags: ["Obras"],
        summary: "Cria uma obra para um lote (ADMIN ou ANALISTA).",
        description: "Um lote pode ter mais de uma obra ao longo do tempo (ex.: construção inicial e reforma).",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            loteId: { type: "string", format: "uuid" },
            tipo: { type: "string", enum: ["CONSTRUCAO_INICIAL", "REFORMA"] },
          },
          required: ["loteId"],
        },
        response: { 201: obraSchema, ...respostasErroPadrao },
      },
    },
    async (request, reply) => {
      const criada = await criarObra(fastify.pg, request.body);
      reply.code(201);
      return criada;
    }
  );

  fastify.patch<{
    Params: { id: string };
    Body: Partial<{
      tipo: "CONSTRUCAO_INICIAL" | "REFORMA";
      dataLiberacao: string;
      dataVistoriaPosObra: string;
      liberadoParaMudanca: boolean;
      dataMudanca: string;
    }>;
  }>(
    "/obras/:id",
    {
      preHandler: fastify.authorize("ADMIN", "ANALISTA"),
      schema: {
        tags: ["Obras"],
        summary: "Edita datas e atributos de uma obra (ADMIN ou ANALISTA).",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        body: {
          type: "object",
          properties: {
            tipo: { type: "string", enum: ["CONSTRUCAO_INICIAL", "REFORMA"] },
            dataLiberacao: { type: "string", format: "date-time" },
            dataVistoriaPosObra: { type: "string", format: "date-time" },
            liberadoParaMudanca: { type: "boolean" },
            dataMudanca: { type: "string", format: "date-time" },
          },
        },
        response: { 200: obraSchema, ...respostasErroPadrao },
      },
    },
    async (request) => atualizarObra(fastify.pg, request.params.id, request.body)
  );

  fastify.post<{ Params: { id: string }; Body: { statusCodigo: string; observacao?: string } }>(
    "/obras/:id/status",
    {
      preHandler: fastify.authorize("ADMIN", "ANALISTA"),
      schema: {
        tags: ["Obras"],
        summary: "Atualiza o status (situação) da obra, preservando o histórico anterior.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        body: {
          type: "object",
          properties: { statusCodigo: { type: "string" }, observacao: { type: "string" } },
          required: ["statusCodigo"],
        },
        response: { 200: { type: "object", additionalProperties: true }, ...respostasErroPadrao },
      },
    },
    async (request) =>
      atualizarStatusObra(
        fastify.pg,
        request.params.id,
        request.body.statusCodigo,
        request.body.observacao ?? null,
        request.usuario?.id ?? null
      )
  );

  fastify.get<{ Params: { id: string } }>(
    "/obras/:id/historico-status",
    {
      schema: {
        tags: ["Obras"],
        summary: "Histórico completo de status da obra.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: { type: "array", items: { type: "object", additionalProperties: true } }, ...respostasErroPadrao },
      },
    },
    async (request) => listarHistoricoStatusObra(fastify.pg, request.params.id)
  );

  fastify.get<{ Params: { id: string } }>(
    "/obras/:id/responsaveis",
    {
      schema: {
        tags: ["Obras"],
        summary: "Lista os responsáveis técnicos vinculados a esta obra.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: { type: "array", items: { type: "object", additionalProperties: true } }, ...respostasErroPadrao },
      },
    },
    async (request) => listarResponsaveisDaObra(fastify.pg, request.params.id)
  );

  fastify.post<{ Params: { id: string }; Body: { pessoaId: string } }>(
    "/obras/:id/responsaveis",
    {
      preHandler: fastify.authorize("ADMIN", "ANALISTA"),
      schema: {
        tags: ["Obras"],
        summary: "Vincula um responsável técnico (Pessoa) a esta obra.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        body: {
          type: "object",
          properties: { pessoaId: { type: "string", format: "uuid" } },
          required: ["pessoaId"],
        },
        response: { 204: { type: "null" }, ...respostasErroPadrao },
      },
    },
    async (request, reply) => {
      await vincularResponsavelTecnico(fastify.pg, request.params.id, request.body.pessoaId);
      reply.code(204);
    }
  );

  fastify.get<{ Params: { id: string }; Querystring: { page?: number; pageSize?: number } }>(
    "/obras/:id/anotacoes",
    {
      schema: {
        tags: ["Obras"],
        summary: "Lista as anotações desta obra.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        querystring: { type: "object", properties: paginacaoQuerySchema.properties },
        response: { 200: envelopePaginado({ type: "object", additionalProperties: true }), ...respostasErroPadrao },
      },
    },
    async (request) => {
      await buscarObraPorId(fastify.pg, request.params.id);
      return listarAnotacoes(fastify.pg, { obraId: request.params.id, ...request.query });
    }
  );

  fastify.get<{ Params: { id: string }; Querystring: { page?: number; pageSize?: number } }>(
    "/obras/:id/documentos",
    {
      schema: {
        tags: ["Obras"],
        summary: "Lista os documentos (metadados) desta obra.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        querystring: { type: "object", properties: paginacaoQuerySchema.properties },
        response: { 200: envelopePaginado({ type: "object", additionalProperties: true }), ...respostasErroPadrao },
      },
    },
    async (request) => {
      await buscarObraPorId(fastify.pg, request.params.id);
      return listarDocumentos(fastify.pg, { obraId: request.params.id, ...request.query });
    }
  );
}
