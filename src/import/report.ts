import type { RelatorioImportacao } from "./types.js";

export function formatarRelatorio(relatorio: RelatorioImportacao): string {
  const linhas: string[] = [];
  linhas.push("=".repeat(70));
  linhas.push(`RELATÓRIO DE IMPORTAÇÃO ${relatorio.dryRun ? "(DRY RUN — nada foi persistido)" : ""}`);
  linhas.push("=".repeat(70));
  linhas.push(`Arquivo: ${relatorio.arquivo}`);
  if (relatorio.importacaoExecucaoId) {
    linhas.push(`ImportacaoExecucao: ${relatorio.importacaoExecucaoId}`);
  }
  linhas.push("");
  linhas.push(`Linhas na planilha (excluindo separadoras vazias): ${relatorio.totalLinhasNaPlanilha}`);
  linhas.push(`Linhas processáveis (válidas): ${relatorio.totalLinhasProcessaveis}`);
  linhas.push(`  Novos:          ${relatorio.novos}`);
  linhas.push(`  Atualizados:    ${relatorio.atualizados}`);
  linhas.push(`  Sem alteração:  ${relatorio.semAlteracao}`);
  linhas.push(`  Ignorados:      ${relatorio.ignorados}`);
  linhas.push(`  Inválidos:      ${relatorio.invalidos}`);
  linhas.push("");
  linhas.push(`Total de erros: ${relatorio.totalErros}`);
  linhas.push(`Total de avisos (revisão manual recomendada): ${relatorio.totalAvisos}`);

  const problemasGeraisTexto = relatorio.problemasGerais
    .map((p) => `  [${p.severidade}] ${p.codigo}: ${p.mensagem}`)
    .join("\n");
  if (problemasGeraisTexto) {
    linhas.push("");
    linhas.push("Problemas de arquivo/estrutura:");
    linhas.push(problemasGeraisTexto);
  }

  const linhasComProblema = relatorio.linhas.filter((l) => l.problemas.length > 0);
  if (linhasComProblema.length > 0) {
    linhas.push("");
    linhas.push(`Linhas com observações (${linhasComProblema.length}):`);
    for (const l of linhasComProblema) {
      linhas.push(`  Linha ${l.linha} (${l.quadraCodigo ?? "?"} ${l.loteNumero ?? "?"}) — ${l.resultado}`);
      for (const p of l.problemas) {
        linhas.push(`    [${p.severidade}] ${p.codigo}: ${p.mensagem}`);
      }
    }
  }

  linhas.push("=".repeat(70));
  return linhas.join("\n");
}
