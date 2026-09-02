import { Pool, type PoolClient } from "pg";
import "dotenv/config";

/**
 * Acesso a banco via `pg` cru.
 *
 * Motivo: este ambiente de build não tem acesso de rede a binaries.prisma.sh,
 * então `prisma generate` não pôde ser executado (ver DOMAIN_MODEL.md, seção 7).
 * `prisma/schema.prisma` e as migrations continuam sendo a fonte de verdade do
 * banco. Assim que `npx prisma generate` puder rodar (qualquer ambiente com
 * rede irrestrita), troque este arquivo para exportar um `PrismaClient` — o
 * resto da aplicação depende só do que este módulo exporta, então a troca é
 * isolada aqui.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function checkDatabaseConnection(): Promise<boolean> {
  const result = await pool.query("SELECT 1 as ok");
  return result.rows[0]?.ok === 1;
}

/** `Pool` fora de transação, ou `PoolClient` dentro de uma — todo service que
 * pode ser reaproveitado dentro de uma transação (ver `withTransaction`
 * abaixo) aceita este tipo em vez de `Pool` puro. `Pool` continua sendo um
 * `Queryable` válido, então nenhum call site existente precisa mudar. */
export type Queryable = Pool | PoolClient;

/** Mesma estratégia de `src/import/persistence.ts:withTransaction`, copiada
 * (não importada) de propósito: a camada de API não deve depender do módulo
 * de importação. Garante atomicidade quando uma operação mexe em mais de uma
 * tabela (ex.: edição completa de Lote) — se qualquer etapa falhar, nada do
 * que já rodou na mesma chamada fica persistido. */
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await fn(client);
    await client.query("COMMIT");
    return resultado;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
