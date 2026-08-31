/**
 * Orquestrador: Excel -> Parser -> RawData -> Validation -> Normalization ->
 * Mapping -> Domain -> Persistence.
 *
 * Este é o único módulo que decide QUANDO cada estágio roda; nenhum estágio
 * conhece os outros diretamente (cada um só depende dos tipos em types.ts).
 */
import type { Pool, PoolClient } from "pg";
import { lerPlanilhaObras } from "./excelReader.js";
import { validarLinhas } from "./validation.js";
import { normalizarLinhas } from "./normalization.js";
import { mapearLinhas } from "./mapping.js";
import { carregarCatalogoStatusObra, persistirLinhas, withDryRunTransaction, withTransaction } from "./persistence.js";
import type {
  OpcoesImportacao,
  ProblemaImportacao,
  RelatorioImportacao,
  RelatorioLinha,
  ValidatedLoteRow,
} from "./types.js";

function linhasInvalidasParaRelatorio(invalidas: ValidatedLoteRow[]): RelatorioLinha[] {
  return invalidas.map((v) => ({
    linha: v.linha,
    quadraCodigo: v.quadraCodigo,
    loteNumero: v.loteNumero,
    resultado: "INVALIDO",
    problemas: v.problemas,
  }));
}

async function criarImportacaoExecucao(
  pool: Pool,
  origem: string,
  usuarioId: string | null,
  totalLinhas: number
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO importacao_execucoes (origem, status, total_linhas, usuario_id)
     VALUES ($1, 'EM_ANDAMENTO', $2, $3)
     RETURNING id`,
    [origem, totalLinhas, usuarioId]
  );
  return res.rows[0].id;
}

async function finalizarImportacaoExecucao(
  pool: Pool,
  importacaoExecucaoId: string,
  status: "CONCLUIDA" | "CONCLUIDA_COM_ERROS" | "FALHOU",
  linhasComSucesso: number,
  linhasComErro: number,
  problemas: ProblemaImportacao[]
): Promise<void> {
  await pool.query(
    `UPDATE importacao_execucoes
     SET status = $2, linhas_com_sucesso = $3, linhas_com_erro = $4, finalizado_em = now()
     WHERE id = $1`,
    [importacaoExecucaoId, status, linhasComSucesso, linhasComErro]
  );

  for (const p of problemas) {
    await pool.query(
      `INSERT INTO importacao_erros (importacao_id, linha, mensagem, dados_originais)
       VALUES ($1, $2, $3, $4)`,
      [importacaoExecucaoId, p.linha ?? null, `[${p.severidade}] [${p.codigo}] ${p.mensagem}`, p.dadosOriginais ?? null]
    );
  }
}

export async function executarImportacao(pool: Pool, opcoes: OpcoesImportacao): Promise<RelatorioImportacao> {
  const bruto = await lerPlanilhaObras(opcoes.caminhoArquivo);

  if (!bruto.abaEncontrada || bruto.colunasFaltantes.some((c) => ["QUADRA", "LOTE"].includes(c))) {
    // Falha de arquivo/estrutura — nem chega a processar linhas. Nada é
    // persistido, nem em modo real (não há o que importar com segurança).
    return {
      importacaoExecucaoId: null,
      dryRun: opcoes.dryRun,
      arquivo: opcoes.caminhoArquivo,
      totalLinhasNaPlanilha: 0,
      totalLinhasProcessaveis: 0,
      novos: 0,
      atualizados: 0,
      semAlteracao: 0,
      ignorados: 0,
      invalidos: 0,
      linhas: [],
      problemasGerais: bruto.problemas,
      totalErros: bruto.problemas.filter((p) => p.severidade === "ERRO").length,
      totalAvisos: bruto.problemas.filter((p) => p.severidade === "AVISO").length,
    };
  }

  const validadas = validarLinhas(bruto.linhas);
  const validas = validadas.filter((v) => v.valido);
  const invalidas = validadas.filter((v) => !v.valido);

  const normalizadas = normalizarLinhas(validas);

  const executar = async (client: PoolClient) => {
    const catalogo = await carregarCatalogoStatusObra(client);
    const mapeadas = mapearLinhas(normalizadas, catalogo);
    return persistirLinhas(client, opcoes.condominioId, opcoes.usuarioId, mapeadas, linhasInvalidasParaRelatorio(invalidas));
  };

  let linhas: RelatorioLinha[];
  let importacaoExecucaoId: string | null = null;

  if (opcoes.dryRun) {
    const resultado = await withDryRunTransaction(pool, executar);
    linhas = resultado.linhas;
  } else {
    importacaoExecucaoId = await criarImportacaoExecucao(
      pool,
      "PLANILHA_OBRAS",
      opcoes.usuarioId,
      bruto.linhas.length
    );

    try {
      const resultado = await withTransaction(pool, executar);
      linhas = resultado.linhas;

      const todosProblemas = [...bruto.problemas, ...linhas.flatMap((l) => l.problemas)];
      const temErro = todosProblemas.some((p) => p.severidade === "ERRO");
      const linhasComErro = linhas.filter((l) => l.resultado === "INVALIDO").length;

      await finalizarImportacaoExecucao(
        pool,
        importacaoExecucaoId,
        temErro || linhasComErro > 0 ? "CONCLUIDA_COM_ERROS" : "CONCLUIDA",
        linhas.length - linhasComErro,
        linhasComErro,
        todosProblemas
      );
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : String(err);
      await finalizarImportacaoExecucao(pool, importacaoExecucaoId, "FALHOU", 0, bruto.linhas.length, [
        { severidade: "ERRO", codigo: "FALHA_INESPERADA", mensagem },
      ]);
      throw err;
    }
  }

  const todosProblemas = [...bruto.problemas, ...linhas.flatMap((l) => l.problemas)];

  return {
    importacaoExecucaoId,
    dryRun: opcoes.dryRun,
    arquivo: opcoes.caminhoArquivo,
    totalLinhasNaPlanilha: bruto.linhas.length,
    totalLinhasProcessaveis: validadas.length,
    novos: linhas.filter((l) => l.resultado === "NOVO").length,
    atualizados: linhas.filter((l) => l.resultado === "ATUALIZADO").length,
    semAlteracao: linhas.filter((l) => l.resultado === "SEM_ALTERACAO").length,
    ignorados: linhas.filter((l) => l.resultado === "IGNORADO").length,
    invalidos: linhas.filter((l) => l.resultado === "INVALIDO").length,
    linhas,
    problemasGerais: bruto.problemas,
    totalErros: todosProblemas.filter((p) => p.severidade === "ERRO").length,
    totalAvisos: todosProblemas.filter((p) => p.severidade === "AVISO").length,
  };
}
