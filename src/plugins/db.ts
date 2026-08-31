import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { pool } from "../lib/db.js";

declare module "fastify" {
  interface FastifyInstance {
    pg: Pool;
  }
}

export default fp(async function dbPlugin(fastify: FastifyInstance) {
  fastify.decorate("pg", pool);
  // Não fechamos o pool aqui: `pool` é um singleton compartilhado (ver
  // src/lib/db.ts), e testes constroem/fecham várias instâncias de app
  // durante a suíte. O encerramento do pool fica a cargo de quem o importou
  // originalmente (server.ts no processo real; cada arquivo de teste no seu
  // próprio afterAll).
});
