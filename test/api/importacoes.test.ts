import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/lib/db.js";
import { obterToken, authHeader } from "./helpers.js";

describe("GET /importacoes/:id/erros (dados isolados de teste)", () => {
  const app = buildApp();
  let tokenAdmin: string;
  let tokenAnalista: string;
  let importacaoId: string;
  let erroId: string;

  beforeAll(async () => {
    tokenAdmin = await obterToken(app, "ADMIN");
    tokenAnalista = await obterToken(app, "ANALISTA");

    const execucao = await pool.query<{ id: string }>(
      `INSERT INTO importacao_execucoes (origem, status, total_linhas, linhas_com_sucesso, linhas_com_erro, finalizado_em)
       VALUES ('PLANILHA_OBRAS', 'CONCLUIDA_COM_ERROS', 2, 1, 1, now())
       RETURNING id`
    );
    importacaoId = execucao.rows[0].id;

    const erro = await pool.query<{ id: string }>(
      `INSERT INTO importacao_erros (importacao_id, linha, mensagem, dados_originais)
       VALUES ($1, 7, 'Status "XPTO" não consta no mapeamento legado.', '{"linha":"bruta"}')
       RETURNING id`,
      [importacaoId]
    );
    erroId = erro.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM importacao_erros WHERE importacao_id = $1`, [importacaoId]);
    await pool.query(`DELETE FROM importacao_execucoes WHERE id = $1`, [importacaoId]);
    await app.close();
  });

  it("ADMIN lista os erros de uma execução com o formato { id, linha, mensagem }", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/importacoes/${importacaoId}/erros`,
      headers: authHeader(tokenAdmin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: erroId, linha: 7, mensagem: 'Status "XPTO" não consta no mapeamento legado.' },
    ]);
  });

  it("ANALISTA não tem acesso a importações (403) — mesma restrição do resto do módulo", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/importacoes/${importacaoId}/erros`,
      headers: authHeader(tokenAnalista),
    });
    expect(res.statusCode).toBe(403);
  });

  it("importação inexistente devolve 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/importacoes/00000000-0000-0000-0000-000000000000/erros",
      headers: authHeader(tokenAdmin),
    });
    expect(res.statusCode).toBe(404);
  });
});
