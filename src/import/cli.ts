/**
 * CLI de importação.
 *
 * Uso:
 *   npx tsx src/import/cli.ts --file caminho.xlsx --dry-run
 *   npx tsx src/import/cli.ts --file caminho.xlsx --condominio "Rudá"
 */
import { Pool } from "pg";
import "dotenv/config";
import { executarImportacao } from "./importer.js";
import { formatarRelatorio } from "./report.js";

function lerArg(nome: string): string | null {
  const idx = process.argv.indexOf(nome);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

async function main() {
  const arquivo = lerArg("--file");
  const nomeCondominio = lerArg("--condominio") ?? "Rudá";
  const dryRun = process.argv.includes("--dry-run");

  if (!arquivo) {
    console.error("Uso: --file <caminho.xlsx> [--condominio <nome>] [--dry-run]");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const condominio = await pool.query<{ id: string }>(`SELECT id FROM condominios WHERE nome = $1`, [
      nomeCondominio,
    ]);
    if (condominio.rowCount === 0) {
      console.error(`Condomínio "${nomeCondominio}" não encontrado. Rode o seed primeiro.`);
      process.exit(1);
    }

    const relatorio = await executarImportacao(pool, {
      caminhoArquivo: arquivo,
      condominioId: condominio.rows[0].id,
      usuarioId: null,
      dryRun,
    });

    console.log(formatarRelatorio(relatorio));
    process.exit(relatorio.totalErros > 0 ? 1 : 0);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Importação falhou:", err);
  process.exit(1);
});
