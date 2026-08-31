import type { FastifyInstance } from "fastify";
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executarImportacao } from "../../import/importer.js";
import { buscarImportacaoPorId, listarErrosImportacao, listarImportacoes } from "./service.js";
import { ValidationAppError } from "../../lib/errors.js";
import { envelopePaginado, idParamSchema, paginacaoQuerySchema, respostasErroPadrao } from "../../lib/schemas.js";

const importacaoSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    origem: { type: "string" },
    status: { type: "string" },
    totalLinhas: { type: ["integer", "null"] },
    linhasComSucesso: { type: ["integer", "null"] },
    linhasComErro: { type: ["integer", "null"] },
    iniciadoEm: { type: "string" },
    finalizadoEm: { type: ["string", "null"] },
  },
} as const;

/**
 * Importação continua restrita a ADMIN em toda a árvore de rotas — é uma
 * operação de migração de dados em massa, não uma atividade operacional do
 * dia a dia (ver Fase 5: "importação" listada explicitamente só no escopo
 * de ADMIN).
 */
export default async function importacoesRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.authorize("ADMIN"));

  fastify.get<{ Querystring: { page?: number; pageSize?: number } }>(
    "/importacoes",
    {
      schema: {
        tags: ["Importações"],
        summary: "Lista o histórico de execuções de importação (somente ADMIN).",
        security: [{ bearerAuth: [] }],
        querystring: { type: "object", properties: paginacaoQuerySchema.properties },
        response: { 200: envelopePaginado(importacaoSchema), ...respostasErroPadrao },
      },
    },
    async (request) => listarImportacoes(fastify.pg, request.query)
  );

  fastify.get<{ Params: { id: string } }>(
    "/importacoes/:id",
    {
      schema: {
        tags: ["Importações"],
        summary: "Detalha uma execução de importação, incluindo os erros/avisos por linha (somente ADMIN).",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: { type: "object", additionalProperties: true }, ...respostasErroPadrao },
      },
    },
    async (request) => buscarImportacaoPorId(fastify.pg, request.params.id)
  );

  fastify.get<{ Params: { id: string } }>(
    "/importacoes/:id/erros",
    {
      schema: {
        tags: ["Importações"],
        summary: "Lista os erros/avisos de uma execução de importação, um item por linha (somente ADMIN).",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                linha: { type: ["integer", "null"] },
                mensagem: { type: "string" },
              },
            },
          },
          ...respostasErroPadrao,
        },
      },
    },
    async (request) => listarErrosImportacao(fastify.pg, request.params.id)
  );

  fastify.post(
    "/importacoes",
    {
      schema: {
        tags: ["Importações"],
        summary: "Envia a planilha (.xlsx) e executa a importação (somente ADMIN).",
        description:
          "multipart/form-data com o campo `arquivo` (o .xlsx), `condominioId` e, opcionalmente, `dryRun=true` " +
          "para simular sem persistir nada. Ver Fase 6 para o detalhamento do pipeline. " +
          "Resposta é o relatório da execução (RelatorioImportacao) — formato DIFERENTE do item de " +
          "GET /importacoes e GET /importacoes/:id (ImportacaoResumo/ImportacaoDetalhe): aqui `importacaoExecucaoId` " +
          "é o id (não `id`), e os números vêm por resultado de linha (novos/atualizados/semAlteracao/ignorados/" +
          "invalidos), não como totalLinhas/linhasComSucesso/linhasComErro.",
        security: [{ bearerAuth: [] }],
        consumes: ["multipart/form-data"],
        response: {
          200: {
            type: "object",
            properties: {
              importacaoExecucaoId: { type: ["string", "null"] },
              dryRun: { type: "boolean" },
              arquivo: { type: "string" },
              totalLinhasNaPlanilha: { type: "integer" },
              totalLinhasProcessaveis: { type: "integer" },
              novos: { type: "integer" },
              atualizados: { type: "integer" },
              semAlteracao: { type: "integer" },
              ignorados: { type: "integer" },
              invalidos: { type: "integer" },
              totalErros: { type: "integer" },
              totalAvisos: { type: "integer" },
              problemasGerais: { type: "array", items: { type: "object", additionalProperties: true } },
              linhas: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    linha: { type: "integer" },
                    quadraCodigo: { type: ["string", "null"] },
                    loteNumero: { type: ["integer", "null"] },
                    resultado: {
                      type: "string",
                      enum: ["NOVO", "ATUALIZADO", "SEM_ALTERACAO", "IGNORADO", "INVALIDO"],
                    },
                    problemas: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          severidade: { type: "string", enum: ["ERRO", "AVISO"] },
                          codigo: { type: "string" },
                          mensagem: { type: "string" },
                          linha: { type: "integer" },
                          dadosOriginais: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          ...respostasErroPadrao,
        },
      },
    },
    async (request) => {
      const parts = request.parts();
      let arquivoPath: string | null = null;
      let condominioId: string | null = null;
      let dryRun = false;

      for await (const part of parts) {
        if (part.type === "file" && part.fieldname === "arquivo") {
          const dir = mkdtempSync(path.join(tmpdir(), "import-upload-"));
          arquivoPath = path.join(dir, part.filename || "planilha.xlsx");
          const buffer = await part.toBuffer();
          await writeFile(arquivoPath, buffer);
        } else if (part.type === "field" && part.fieldname === "condominioId") {
          condominioId = String(part.value);
        } else if (part.type === "field" && part.fieldname === "dryRun") {
          dryRun = String(part.value).toLowerCase() === "true";
        }
      }

      if (!arquivoPath) {
        throw new ValidationAppError('Campo "arquivo" (multipart, .xlsx) é obrigatório.');
      }
      if (!condominioId) {
        throw new ValidationAppError('Campo "condominioId" é obrigatório.');
      }

      return executarImportacao(fastify.pg, {
        caminhoArquivo: arquivoPath,
        condominioId,
        usuarioId: request.usuario?.id ?? null,
        dryRun,
      });
    }
  );
}
