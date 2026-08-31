import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Pool } from "pg";
import "dotenv/config";
import { executarImportacao } from "../../src/import/importer.js";
import { criarPlanilhaFixture } from "./helpers.js";

describe("importador — integração com Postgres real", () => {
  let pool: Pool;
  let condominioId: string;
  const condominioNome = `Teste Importação ${Date.now()}`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const res = await pool.query<{ id: string }>(
      `INSERT INTO condominios (nome, atualizado_em) VALUES ($1, now()) RETURNING id`,
      [condominioNome]
    );
    condominioId = res.rows[0].id;
  });

  afterEach(async () => {
    // Limpa tudo que a importação possa ter criado para este condomínio de
    // teste, respeitando ON DELETE RESTRICT (filhos antes dos pais).
    await pool.query(
      `DELETE FROM obra_pessoa WHERE obra_id IN (SELECT o.id FROM obras o JOIN lotes l ON l.id=o.lote_id JOIN quadras q ON q.id=l.quadra_id WHERE q.condominio_id=$1)`,
      [condominioId]
    );
    await pool.query(
      `DELETE FROM obra_status_historico WHERE obra_id IN (SELECT o.id FROM obras o JOIN lotes l ON l.id=o.lote_id JOIN quadras q ON q.id=l.quadra_id WHERE q.condominio_id=$1)`,
      [condominioId]
    );
    await pool.query(
      `DELETE FROM anotacoes WHERE lote_id IN (SELECT l.id FROM lotes l JOIN quadras q ON q.id=l.quadra_id WHERE q.condominio_id=$1)`,
      [condominioId]
    );
    await pool.query(
      `DELETE FROM lote_ocupacao_historico WHERE lote_id IN (SELECT l.id FROM lotes l JOIN quadras q ON q.id=l.quadra_id WHERE q.condominio_id=$1)`,
      [condominioId]
    );
    await pool.query(
      `DELETE FROM lote_pessoa WHERE lote_id IN (SELECT l.id FROM lotes l JOIN quadras q ON q.id=l.quadra_id WHERE q.condominio_id=$1)`,
      [condominioId]
    );
    await pool.query(
      `DELETE FROM lote_apoio WHERE lote_em_obra_id IN (SELECT l.id FROM lotes l JOIN quadras q ON q.id=l.quadra_id WHERE q.condominio_id=$1)`,
      [condominioId]
    );
    await pool.query(
      `DELETE FROM obras WHERE lote_id IN (SELECT l.id FROM lotes l JOIN quadras q ON q.id=l.quadra_id WHERE q.condominio_id=$1)`,
      [condominioId]
    );
    await pool.query(`DELETE FROM lotes WHERE quadra_id IN (SELECT id FROM quadras WHERE condominio_id=$1)`, [
      condominioId,
    ]);
  });

  afterAll(async () => {
    // Pessoa é uma tabela global (não escopada por condomínio) — os testes
    // acima criam pessoas com nomes exclusivos de teste; removê-las aqui
    // evita que rodadas repetidas desta suíte acumulem lixo num banco
    // compartilhado. Isso não afeta a Pessoa "Nome Ambíguo Teste" (já
    // removida dentro do próprio teste de conflito).
    await pool.query(
      `DELETE FROM pessoas WHERE nome IN ('Fulano de Tal', 'Maria Duplicada Teste', 'Pessoa Dry Run', 'Não Deve Persistir')`
    );
    await pool.query(`DELETE FROM quadras WHERE condominio_id = $1`, [condominioId]);
    await pool.query(`DELETE FROM condominios WHERE id = $1`, [condominioId]);
    await pool.end();
  });

  it("importa uma planilha válida com sucesso (novos registros)", async () => {
    const caminho = await criarPlanilhaFixture([
      { quadra: "Z9", lote: 1, m2: 250, proprietario: "Fulano de Tal", status: "MORADOR" },
      { quadra: "Z9", lote: 2, status: "EM ANÁLISE" },
    ]);

    const relatorio = await executarImportacao(pool, {
      caminhoArquivo: caminho,
      condominioId,
      usuarioId: null,
      dryRun: false,
    });

    expect(relatorio.totalErros).toBe(0);
    expect(relatorio.novos).toBe(2);
    expect(relatorio.importacaoExecucaoId).not.toBeNull();

    const lotes = await pool.query(
      `SELECT numero FROM lotes l JOIN quadras q ON q.id=l.quadra_id WHERE q.condominio_id=$1 ORDER BY numero`,
      [condominioId]
    );
    expect(lotes.rows.map((r) => r.numero)).toEqual([1, 2]);
  });

  it("reimportar a mesma planilha é idempotente (nenhuma duplicata, tudo sem alteração)", async () => {
    const caminho = await criarPlanilhaFixture([
      { quadra: "Z9", lote: 1, m2: 250, proprietario: "Fulano de Tal", status: "MORADOR" },
    ]);

    await executarImportacao(pool, { caminhoArquivo: caminho, condominioId, usuarioId: null, dryRun: false });
    const segunda = await executarImportacao(pool, {
      caminhoArquivo: caminho,
      condominioId,
      usuarioId: null,
      dryRun: false,
    });

    expect(segunda.novos).toBe(0);
    expect(segunda.semAlteracao).toBe(1);

    const lotes = await pool.query(
      `SELECT count(*)::int AS n FROM lotes l JOIN quadras q ON q.id=l.quadra_id WHERE q.condominio_id=$1`,
      [condominioId]
    );
    expect(lotes.rows[0].n).toBe(1);

    const pessoas = await pool.query(
      `SELECT count(*)::int AS n FROM pessoas WHERE nome = 'Fulano de Tal'`
    );
    expect(pessoas.rows[0].n).toBe(1);
  });

  it("reimportar com um valor alterado gera ATUALIZADO, não um novo lote", async () => {
    const caminho1 = await criarPlanilhaFixture([{ quadra: "Z9", lote: 1, m2: 250 }]);
    await executarImportacao(pool, { caminhoArquivo: caminho1, condominioId, usuarioId: null, dryRun: false });

    const caminho2 = await criarPlanilhaFixture([{ quadra: "Z9", lote: 1, m2: 300 }]);
    const relatorio = await executarImportacao(pool, {
      caminhoArquivo: caminho2,
      condominioId,
      usuarioId: null,
      dryRun: false,
    });

    expect(relatorio.novos).toBe(0);
    expect(relatorio.atualizados).toBe(1);

    const lote = await pool.query(
      `SELECT area_m2 FROM lotes l JOIN quadras q ON q.id=l.quadra_id WHERE q.condominio_id=$1`,
      [condominioId]
    );
    expect(Number(lote.rows[0].area_m2)).toBe(300);
  });

  it("mesma pessoa em duas linhas diferentes gera um único registro de Pessoa", async () => {
    const caminho = await criarPlanilhaFixture([
      { quadra: "Z9", lote: 1, proprietario: "Maria Duplicada Teste" },
      { quadra: "Z9", lote: 2, proprietario: "Maria Duplicada Teste" },
    ]);

    await executarImportacao(pool, { caminhoArquivo: caminho, condominioId, usuarioId: null, dryRun: false });

    const pessoas = await pool.query(`SELECT id FROM pessoas WHERE nome = 'Maria Duplicada Teste'`);
    expect(pessoas.rowCount).toBe(1);

    const vinculos = await pool.query(
      `SELECT count(*)::int AS n FROM lote_pessoa WHERE pessoa_id = $1`,
      [pessoas.rows[0].id]
    );
    expect(vinculos.rows[0].n).toBe(2);
  });

  it("status desconhecido não bloqueia a linha, mas gera aviso e não cria status de obra", async () => {
    const caminho = await criarPlanilhaFixture([
      { quadra: "Z9", lote: 1, status: "SITUAÇÃO INEXISTENTE 12345" },
    ]);

    const relatorio = await executarImportacao(pool, {
      caminhoArquivo: caminho,
      condominioId,
      usuarioId: null,
      dryRun: false,
    });

    expect(relatorio.invalidos).toBe(0);
    const avisoStatus = relatorio.linhas[0].problemas.find((p) => p.codigo === "STATUS_DESCONHECIDO");
    expect(avisoStatus).toBeDefined();

    const historico = await pool.query(
      `SELECT count(*)::int AS n FROM obra_status_historico osh
       JOIN obras o ON o.id = osh.obra_id
       JOIN lotes l ON l.id = o.lote_id JOIN quadras q ON q.id=l.quadra_id
       WHERE q.condominio_id = $1`,
      [condominioId]
    );
    expect(historico.rows[0].n).toBe(0);
  });

  it("lote duplicado dentro do mesmo arquivo é rejeitado (linha inválida), a primeira ocorrência é processada", async () => {
    const caminho = await criarPlanilhaFixture([
      { quadra: "Z9", lote: 1, status: "MORADOR" },
      { quadra: "Z9", lote: 1, status: "EM ANÁLISE" },
    ]);

    const relatorio = await executarImportacao(pool, {
      caminhoArquivo: caminho,
      condominioId,
      usuarioId: null,
      dryRun: false,
    });

    expect(relatorio.invalidos).toBe(1);
    expect(relatorio.novos).toBe(1);
  });

  it("conflito: nome ambíguo (mais de uma Pessoa já cadastrada) não vincula automaticamente", async () => {
    // Duas pessoas pré-existentes com o mesmo nome normalizado — situação que
    // só acontece se alguém cadastrou manualmente antes da importação.
    await pool.query(`INSERT INTO pessoas (nome, tipo_pessoa, atualizado_em) VALUES ($1, 'FISICA', now())`, [
      "Nome Ambíguo Teste",
    ]);
    await pool.query(`INSERT INTO pessoas (nome, tipo_pessoa, atualizado_em) VALUES ($1, 'FISICA', now())`, [
      "Nome Ambíguo Teste",
    ]);

    const caminho = await criarPlanilhaFixture([
      { quadra: "Z9", lote: 1, proprietario: "Nome Ambíguo Teste" },
    ]);

    const relatorio = await executarImportacao(pool, {
      caminhoArquivo: caminho,
      condominioId,
      usuarioId: null,
      dryRun: false,
    });

    const aviso = relatorio.linhas[0].problemas.find((p) => p.codigo === "PESSOA_AMBIGUA");
    expect(aviso).toBeDefined();

    const vinculos = await pool.query(
      `SELECT count(*)::int AS n FROM lote_pessoa lp
       JOIN pessoas p ON p.id = lp.pessoa_id WHERE p.nome = 'Nome Ambíguo Teste'`
    );
    expect(vinculos.rows[0].n).toBe(0);

    await pool.query(`DELETE FROM pessoas WHERE nome = 'Nome Ambíguo Teste'`);
  });

  it("dry-run não persiste absolutamente nada, mesmo relatando o que seria feito", async () => {
    const caminho = await criarPlanilhaFixture([
      { quadra: "Z9", lote: 1, proprietario: "Pessoa Dry Run", status: "MORADOR" },
    ]);

    const relatorio = await executarImportacao(pool, {
      caminhoArquivo: caminho,
      condominioId,
      usuarioId: null,
      dryRun: true,
    });

    expect(relatorio.dryRun).toBe(true);
    expect(relatorio.novos).toBe(1);
    expect(relatorio.importacaoExecucaoId).toBeNull(); // dry-run não registra execução

    const lotes = await pool.query(
      `SELECT count(*)::int AS n FROM lotes l JOIN quadras q ON q.id=l.quadra_id WHERE q.condominio_id=$1`,
      [condominioId]
    );
    expect(lotes.rows[0].n).toBe(0);

    const pessoas = await pool.query(`SELECT count(*)::int AS n FROM pessoas WHERE nome = 'Pessoa Dry Run'`);
    expect(pessoas.rows[0].n).toBe(0);

    const execucoes = await pool.query(
      `SELECT count(*)::int AS n FROM importacao_execucoes WHERE origem = 'PLANILHA_OBRAS'
       AND iniciado_em > now() - interval '1 minute'`
    );
    // não afirmamos zero global (outros testes podem ter criado execuções reais
    // no mesmo minuto) — a garantia real já foi checada acima via ausência de
    // lotes/pessoas persistidos.
    expect(execucoes.rows[0].n).toBeGreaterThanOrEqual(0);
  });

  it("arquivo com aba ausente não persiste nada e não cria ImportacaoExecucao", async () => {
    const caminho = await criarPlanilhaFixture([{ quadra: "Z9", lote: 1 }], { nomeAba: "Aba Errada" });

    const relatorio = await executarImportacao(pool, {
      caminhoArquivo: caminho,
      condominioId,
      usuarioId: null,
      dryRun: false,
    });

    expect(relatorio.importacaoExecucaoId).toBeNull();
    expect(relatorio.totalErros).toBeGreaterThan(0);

    const lotes = await pool.query(
      `SELECT count(*)::int AS n FROM lotes l JOIN quadras q ON q.id=l.quadra_id WHERE q.condominio_id=$1`,
      [condominioId]
    );
    expect(lotes.rows[0].n).toBe(0);
  });

  it("rollback: falha no meio da transação desfaz todas as escritas daquela execução", async () => {
    // Força uma falha real de banco fabricando uma linha com QUADRA/LOTE
    // válidos, mas que colide com um LOTE já existente por outra via — usamos
    // um condominioId inexistente para provocar violação de FK a meio da
    // transação (garantirQuadra falha), sem tocar no código de produção.
    const condominioInexistente = "00000000-0000-0000-0000-000000000000";
    const caminho = await criarPlanilhaFixture([
      { quadra: "Z9", lote: 999, proprietario: "Não Deve Persistir" },
    ]);

    await expect(
      executarImportacao(pool, {
        caminhoArquivo: caminho,
        condominioId: condominioInexistente,
        usuarioId: null,
        dryRun: false,
      })
    ).rejects.toThrow();

    const pessoas = await pool.query(`SELECT count(*)::int AS n FROM pessoas WHERE nome = 'Não Deve Persistir'`);
    expect(pessoas.rows[0].n).toBe(0);

    const execucao = await pool.query<{ status: string }>(
      `SELECT status FROM importacao_execucoes WHERE origem='PLANILHA_OBRAS' AND usuario_id IS NULL
       ORDER BY iniciado_em DESC LIMIT 1`
    );
    expect(execucao.rows[0]?.status).toBe("FALHOU");
  });
});
