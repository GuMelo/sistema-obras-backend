import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 15000,
    // Vários arquivos usam o Postgres real (Prisma Postgres, pooled) e cada
    // um faz login (bcrypt) + abre seu próprio pool de conexões no setup.
    // Com o suite maior, rodar arquivos em paralelo satura o pooler
    // compartilhado e derruba beforeAll/login com timeout — não é flakiness
    // de teste, é contenção de conexão. Arquivos rodando em série evitam isso.
    fileParallelism: false,
  },
});
