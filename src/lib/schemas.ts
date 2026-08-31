/** Fragmentos de JSON Schema reaproveitados pelas rotas — tanto para
 * validação (ajv, embutido no Fastify) quanto para a documentação OpenAPI
 * (o mesmo objeto alimenta os dois, então nunca ficam dessincronizados). */

export const erroSchema = {
  type: "object",
  properties: {
    statusCode: { type: "number" },
    code: { type: "string" },
    message: { type: "string" },
  },
  required: ["statusCode", "code", "message"],
} as const;

export const paginacaoQuerySchema = {
  type: "object",
  properties: {
    page: { type: "integer", minimum: 1, default: 1, description: "Página (1-based)" },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    sort: {
      type: "string",
      description: 'Campo de ordenação. Prefixe com "-" para decrescente (ex.: "-criadoEm").',
    },
  },
} as const;

export function envelopePaginado(itemSchema: object) {
  return {
    type: "object",
    properties: {
      dados: { type: "array", items: itemSchema },
      paginacao: {
        type: "object",
        properties: {
          page: { type: "integer" },
          pageSize: { type: "integer" },
          total: { type: "integer" },
          totalPaginas: { type: "integer" },
        },
        required: ["page", "pageSize", "total", "totalPaginas"],
      },
    },
    required: ["dados", "paginacao"],
  } as const;
}

export const respostasErroPadrao = {
  400: erroSchema,
  401: erroSchema,
  403: erroSchema,
  404: erroSchema,
  409: erroSchema,
};

export const idParamSchema = {
  type: "object",
  properties: { id: { type: "string", format: "uuid" } },
  required: ["id"],
} as const;

export const bearerAuth = [{ bearerAuth: [] }];
