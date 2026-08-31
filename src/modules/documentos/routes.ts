import type { FastifyInstance } from "fastify";
import { buscarDocumentoPorId, criarDocumento, listarDocumentos, removerDocumento } from "./service.js";
import { envelopePaginado, idParamSchema, paginacaoQuerySchema, respostasErroPadrao } from "../../lib/schemas.js";

const documentoSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    loteId: { type: ["string", "null"] },
    obraId: { type: ["string", "null"] },
    tipo: { type: "string", enum: ["FOTO", "PDF", "OUTRO"] },
    nomeArquivo: { type: "string" },
    mimeType: { type: ["string", "null"] },
    tamanhoBytes: { type: ["number", "null"] },
    descricao: { type: ["string", "null"] },
    dataUpload: { type: "string" },
  },
} as const;

export default async function documentosRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get<{ Querystring: { loteId?: string; obraId?: string; page?: number; pageSize?: number } }>(
    "/documentos",
    {
      schema: {
        tags: ["Documentos"],
        summary: "Lista metadados de documentos, filtrados por lote ou obra.",
        description: "Esta fase não implementa armazenamento físico do arquivo — apenas o metadado.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            loteId: { type: "string", format: "uuid" },
            obraId: { type: "string", format: "uuid" },
            ...paginacaoQuerySchema.properties,
          },
        },
        response: { 200: envelopePaginado(documentoSchema), ...respostasErroPadrao },
      },
    },
    async (request) => listarDocumentos(fastify.pg, request.query)
  );

  fastify.get<{ Params: { id: string } }>(
    "/documentos/:id",
    {
      schema: {
        tags: ["Documentos"],
        summary: "Consulta o metadado de um documento por id.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: documentoSchema, ...respostasErroPadrao },
      },
    },
    async (request) => buscarDocumentoPorId(fastify.pg, request.params.id)
  );

  fastify.post<{
    Body: {
      loteId?: string;
      obraId?: string;
      tipo: "FOTO" | "PDF" | "OUTRO";
      nomeArquivo: string;
      mimeType?: string;
      tamanhoBytes?: number;
      descricao?: string;
    };
  }>(
    "/documentos",
    {
      preHandler: fastify.authorize("ADMIN", "ANALISTA"),
      schema: {
        tags: ["Documentos"],
        summary: "Registra o metadado de um documento (ADMIN ou ANALISTA).",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            loteId: { type: "string", format: "uuid" },
            obraId: { type: "string", format: "uuid" },
            tipo: { type: "string", enum: ["FOTO", "PDF", "OUTRO"] },
            nomeArquivo: { type: "string", minLength: 1 },
            mimeType: { type: "string" },
            tamanhoBytes: { type: "integer" },
            descricao: { type: "string" },
          },
          required: ["tipo", "nomeArquivo"],
        },
        response: { 201: documentoSchema, ...respostasErroPadrao },
      },
    },
    async (request, reply) => {
      const criado = await criarDocumento(fastify.pg, request.body);
      reply.code(201);
      return criado;
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    "/documentos/:id",
    {
      preHandler: fastify.authorize("ADMIN"),
      schema: {
        tags: ["Documentos"],
        summary: "Remove o metadado de um documento (somente ADMIN).",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 204: { type: "null" }, ...respostasErroPadrao },
      },
    },
    async (request, reply) => {
      await removerDocumento(fastify.pg, request.params.id);
      reply.code(204);
    }
  );
}
