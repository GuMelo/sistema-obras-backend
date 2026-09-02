import type { FastifyInstance } from "fastify";
import { gerarRelatorioObras } from "./service.js";
import { respostasErroPadrao } from "../../lib/schemas.js";

export default async function relatoriosRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get<{ Querystring: { condominioId: string; quadraCodigo?: string } }>(
    "/relatorios/planilha-obras",
    {
      preHandler: fastify.authorize("ADMIN", "ANALISTA"),
      schema: {
        tags: ["Relatórios"],
        summary: "Gera um .xlsx com os dados atuais do sistema, no mesmo layout da planilha de importação original.",
        description:
          "condominioId é obrigatório (mesmo escopo da planilha de importação: 1 arquivo = 1 condomínio) — o " +
          "layout não tem coluna de condomínio e o código de quadra não é necessariamente único entre " +
          "condomínios diferentes. quadraCodigo filtra opcionalmente só uma quadra dentro do condomínio.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            condominioId: { type: "string", format: "uuid" },
            quadraCodigo: { type: "string" },
          },
          required: ["condominioId"],
        },
        // Sem schema de 200: é um binário (.xlsx), não um JSON — o Fastify só
        // aplica o serializer fast-json-stringify quando existe schema para o
        // status, então omitir aqui evita tentar serializar o Buffer como
        // JSON. Não "corrigir" adicionando um 200 de objeto.
        response: { ...respostasErroPadrao },
      },
    },
    async (request, reply) => {
      const { buffer, nomeArquivo } = await gerarRelatorioObras(fastify.pg, request.query);
      reply
        .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("Content-Disposition", `attachment; filename="${nomeArquivo}"`)
        .send(buffer);
    }
  );
}
