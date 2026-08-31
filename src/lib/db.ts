import { Pool } from "pg";
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
