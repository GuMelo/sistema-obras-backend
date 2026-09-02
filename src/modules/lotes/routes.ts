import type { FastifyInstance } from "fastify";
import {
  atualizarLoteCompleto,
  atualizarOcupacao,
  buscarLotePorId,
  criarLote,
  listarApoiosDoLote,
  listarHistoricoOcupacao,
  listarLotes,
  listarObrasDoLote,
  listarPessoasDoLote,
  type AtualizarLoteCompletoDados,
} from "./service.js";
import { listarAnotacoes } from "../anotacoes/service.js";
import { listarDocumentos } from "../documentos/service.js";
import { envelopePaginado, idParamSchema, paginacaoQuerySchema, respostasErroPadrao } from "../../lib/schemas.js";

const pessoaResumoSchema = {
  type: "object",
  properties: {
    pessoaId: { type: "string" },
    nome: { type: "string" },
    // Em proprietarios: "TITULAR"|"COTITULAR". Em responsaveisTecnicos:
    // "ARQUITETO"|"ENGENHEIRO", ou null quando a pessoa não tem esse dado
    // profissional cadastrado (PessoaDadosProfissionais.tipo).
    papel: { type: ["string", "null"] },
  },
} as const;

const loteSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    quadraId: { type: "string" },
    quadraCodigo: { type: "string" },
    numero: { type: "integer" },
    areaM2: { type: ["number", "null"] },
    enderecoLogradouro: { type: ["string", "null"] },
    enderecoNumero: { type: ["string", "null"] },
    emAlerta: { type: "boolean" },
    ocupacaoAtual: { type: ["string", "null"], enum: ["DISPONIVEL", "MORADOR", null] },
    statusObraAtual: { type: ["string", "null"] },
    obraEmAcompanhamentoId: { type: ["string", "null"] },
    proprietarios: { type: "array", items: pessoaResumoSchema },
    responsaveisTecnicos: { type: "array", items: pessoaResumoSchema },
    temLoteApoio: { type: "boolean" },
    cadastradoEm: { type: "string" },
    atualizadoEm: { type: "string" },
  },
} as const;

export default async function lotesRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get<{
    Querystring: {
      condominioId?: string;
      quadraCodigo?: string;
      ocupacao?: "DISPONIVEL" | "MORADOR" | "NAO_INFORMADO";
      emAlerta?: boolean;
      statusObraCodigo?: string;
      busca?: string;
      page?: number;
      pageSize?: number;
      sort?: string;
    };
  }>(
    "/lotes",
    {
      schema: {
        tags: ["Lotes"],
        summary: "Lista lotes com busca, filtros, ordenação e paginação.",
        description:
          "Filtros disponíveis refletem os dados reais do domínio: ocupação (DISPONIVEL/MORADOR/NAO_INFORMADO — " +
          "nunca infere disponível quando a origem não informou nada), emAlerta, status de obra vigente, quadra e " +
          "busca livre (código do lote, endereço ou nome de proprietário). proprietarios/responsaveisTecnicos " +
          "vêm como array (pode ter 0, 1 ou mais pessoas); temLoteApoio só indica que existe vínculo — os " +
          "detalhes (qual lote, datas) estão em GET /lotes/{id}/apoios.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            condominioId: { type: "string", format: "uuid" },
            quadraCodigo: { type: "string" },
            ocupacao: { type: "string", enum: ["DISPONIVEL", "MORADOR", "NAO_INFORMADO"] },
            emAlerta: { type: "boolean" },
            statusObraCodigo: { type: "string" },
            busca: { type: "string" },
            ...paginacaoQuerySchema.properties,
          },
        },
        response: { 200: envelopePaginado(loteSchema), ...respostasErroPadrao },
      },
    },
    async (request) => listarLotes(fastify.pg, request.query)
  );

  fastify.get<{ Params: { id: string } }>(
    "/lotes/:id",
    {
      schema: {
        tags: ["Lotes"],
        summary: "Consulta um lote por id.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: loteSchema, ...respostasErroPadrao },
      },
    },
    async (request) => buscarLotePorId(fastify.pg, request.params.id)
  );

  fastify.post<{
    Body: {
      quadraId: string;
      numero: number;
      areaM2?: number;
      enderecoLogradouro?: string;
      enderecoNumero?: string;
    };
  }>(
    "/lotes",
    {
      preHandler: fastify.authorize("ADMIN", "ANALISTA"),
      schema: {
        tags: ["Lotes"],
        summary: "Cria um lote (ADMIN ou ANALISTA).",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            quadraId: { type: "string", format: "uuid" },
            numero: { type: "integer", minimum: 1 },
            areaM2: { type: "number" },
            enderecoLogradouro: { type: "string" },
            enderecoNumero: { type: "string" },
          },
          required: ["quadraId", "numero"],
        },
        response: { 201: loteSchema, ...respostasErroPadrao },
      },
    },
    async (request, reply) => {
      const criado = await criarLote(fastify.pg, request.body);
      reply.code(201);
      return criado;
    }
  );

  fastify.patch<{ Params: { id: string }; Body: AtualizarLoteCompletoDados }>(
    "/lotes/:id",
    {
      preHandler: fastify.authorize("ADMIN", "ANALISTA"),
      schema: {
        tags: ["Lotes"],
        summary: "Edição completa do lote (ADMIN ou ANALISTA): endereço, ocupação, proprietários, obra e " +
          "responsáveis técnicos, lote de apoio e alerta.",
        description:
          "Quadra, número do lote e área são imutáveis por este endpoint — não fazem parte do body; " +
          "enviá-los é ignorado silenciosamente (o schema não os reconhece e o ajv os descarta, comportamento " +
          "padrão já usado em toda a API). Todo campo é opcional: omitido = não " +
          "mexe nesse campo. `proprietarios`, `responsaveisTecnicos` e `loteApoioIds`, quando enviados, " +
          "representam o conjunto final desejado (o backend calcula sozinho o que adicionar/remover, cobrindo " +
          "adicionar, remover, substituir e múltiplos com uma única semântica) — cada `pessoaId`/`loteApoioId` " +
          "deve já existir (ver POST /pessoas para criar uma Pessoa nova antes). `obra` se aplica à obra " +
          "\"atual\" do lote (a mesma que aparece em obraEmAcompanhamentoId) — cria uma obra se nenhuma existir " +
          "ainda e algum campo de obra for enviado. Enviar o mesmo valor já vigente é um no-op silencioso: não " +
          "cria histórico, não atualiza atualizadoEm. Toda a operação roda numa única transação — se qualquer " +
          "validação falhar (ex.: pessoa/lote de apoio inexistente), nada é persistido. Um resumo legível da " +
          "edição é registrado automaticamente como Anotação (origem EDICAO_SISTEMA) e o detalhe técnico por " +
          "campo alterado vai para AuditLog.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            enderecoLogradouro: { type: ["string", "null"] },
            enderecoNumero: { type: ["string", "null"] },
            emAlerta: { type: "boolean" },
            ocupacao: { type: "string", enum: ["DISPONIVEL", "MORADOR"] },
            ocupacaoObservacao: { type: "string" },
            proprietarios: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  pessoaId: { type: "string", format: "uuid" },
                  papel: { type: "string", enum: ["TITULAR", "COTITULAR"] },
                },
                required: ["pessoaId", "papel"],
              },
            },
            responsaveisTecnicos: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  pessoaId: { type: "string", format: "uuid" },
                  tipo: { type: "string", enum: ["ARQUITETO", "ENGENHEIRO"] },
                },
                required: ["pessoaId"],
              },
            },
            loteApoioIds: { type: "array", items: { type: "string", format: "uuid" } },
            obra: {
              type: "object",
              additionalProperties: false,
              properties: {
                tipo: { type: "string", enum: ["CONSTRUCAO_INICIAL", "REFORMA"] },
                statusCodigo: { type: "string" },
                dataLiberacao: { type: ["string", "null"], format: "date-time" },
                dataVistoriaPosObra: { type: ["string", "null"], format: "date-time" },
                liberadoParaMudanca: { type: "boolean" },
                dataMudanca: { type: ["string", "null"], format: "date-time" },
              },
            },
          },
        },
        response: { 200: loteSchema, ...respostasErroPadrao },
      },
    },
    async (request) =>
      atualizarLoteCompleto(fastify.pg, request.params.id, request.body, request.usuario?.id ?? null)
  );

  fastify.post<{ Params: { id: string }; Body: { ocupacao: "DISPONIVEL" | "MORADOR"; observacao?: string } }>(
    "/lotes/:id/ocupacao",
    {
      preHandler: fastify.authorize("ADMIN", "ANALISTA"),
      schema: {
        tags: ["Lotes"],
        summary: "Atualiza a ocupação do lote, preservando o histórico anterior.",
        description:
          "Nunca sobrescreve o registro anterior — fecha o período vigente (data_fim) e abre um novo. " +
          "Ver GET /lotes/{id}/historico-ocupacao para a trilha completa.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        body: {
          type: "object",
          properties: {
            ocupacao: { type: "string", enum: ["DISPONIVEL", "MORADOR"] },
            observacao: { type: "string" },
          },
          required: ["ocupacao"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              ocupacao: { type: "string" },
              dataInicio: { type: "string" },
              dataFim: { type: ["string", "null"] },
              observacao: { type: ["string", "null"] },
            },
          },
          ...respostasErroPadrao,
        },
      },
    },
    async (request) =>
      atualizarOcupacao(
        fastify.pg,
        request.params.id,
        request.body.ocupacao,
        request.body.observacao ?? null,
        request.usuario?.id ?? null
      )
  );

  fastify.get<{ Params: { id: string } }>(
    "/lotes/:id/historico-ocupacao",
    {
      schema: {
        tags: ["Lotes"],
        summary: "Histórico completo de ocupação do lote.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: { type: "array", items: { type: "object", additionalProperties: true } }, ...respostasErroPadrao },
      },
    },
    async (request) => listarHistoricoOcupacao(fastify.pg, request.params.id)
  );

  fastify.get<{ Params: { id: string } }>(
    "/lotes/:id/obras",
    {
      schema: {
        tags: ["Lotes"],
        summary: "Lista as obras (atuais e passadas) deste lote.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: { type: "array", items: { type: "object", additionalProperties: true } }, ...respostasErroPadrao },
      },
    },
    async (request) => listarObrasDoLote(fastify.pg, request.params.id)
  );

  fastify.get<{ Params: { id: string } }>(
    "/lotes/:id/pessoas",
    {
      schema: {
        tags: ["Lotes"],
        summary: "Lista os titulares/cotitulares vinculados a este lote.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: { type: "array", items: { type: "object", additionalProperties: true } }, ...respostasErroPadrao },
      },
    },
    async (request) => listarPessoasDoLote(fastify.pg, request.params.id)
  );

  fastify.get<{ Params: { id: string } }>(
    "/lotes/:id/apoios",
    {
      schema: {
        tags: ["Lotes"],
        summary: "Lista os vínculos de lote de apoio deste lote, nos dois sentidos.",
        description:
          'direcao "USA_APOIO": este lote usa o lote referenciado como apoio de obra. ' +
          'direcao "E_APOIO_DE": este lote é usado como apoio pelo lote referenciado.',
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                direcao: { type: "string", enum: ["USA_APOIO", "E_APOIO_DE"] },
                loteId: { type: "string" },
                quadraCodigo: { type: "string" },
                loteNumero: { type: "integer" },
                dataAutorizacao: { type: ["string", "null"] },
                dataDevolucaoPrevista: { type: ["string", "null"] },
                dataDevolucaoEfetiva: { type: ["string", "null"] },
                observacao: { type: ["string", "null"] },
              },
            },
          },
          ...respostasErroPadrao,
        },
      },
    },
    async (request) => listarApoiosDoLote(fastify.pg, request.params.id)
  );

  fastify.get<{ Params: { id: string }; Querystring: { page?: number; pageSize?: number } }>(
    "/lotes/:id/anotacoes",
    {
      schema: {
        tags: ["Lotes"],
        summary: "Lista as anotações deste lote.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        querystring: { type: "object", properties: paginacaoQuerySchema.properties },
        response: { 200: envelopePaginado({ type: "object", additionalProperties: true }), ...respostasErroPadrao },
      },
    },
    async (request) => {
      await buscarLotePorId(fastify.pg, request.params.id);
      return listarAnotacoes(fastify.pg, { loteId: request.params.id, ...request.query });
    }
  );

  fastify.get<{ Params: { id: string }; Querystring: { page?: number; pageSize?: number } }>(
    "/lotes/:id/documentos",
    {
      schema: {
        tags: ["Lotes"],
        summary: "Lista os documentos (metadados) deste lote.",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        querystring: { type: "object", properties: paginacaoQuerySchema.properties },
        response: { 200: envelopePaginado({ type: "object", additionalProperties: true }), ...respostasErroPadrao },
      },
    },
    async (request) => {
      await buscarLotePorId(fastify.pg, request.params.id);
      return listarDocumentos(fastify.pg, { loteId: request.params.id, ...request.query });
    }
  );
}
