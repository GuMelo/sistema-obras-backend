import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/lib/db.js";
import { obterToken, authHeader } from "./helpers.js";

describe("Obras, Pessoas, Anotações e Documentos (dados isolados de teste)", () => {
  const app = buildApp();
  let tokenAdmin: string;
  let tokenAnalista: string;
  let condominioId: string;
  let quadraId: string;
  let loteId: string;

  beforeAll(async () => {
    tokenAdmin = await obterToken(app, "ADMIN");
    tokenAnalista = await obterToken(app, "ANALISTA");

    const cond = await pool.query<{ id: string }>(
      `INSERT INTO condominios (nome, atualizado_em) VALUES ($1, now()) RETURNING id`,
      [`Teste API Obras ${Date.now()}`]
    );
    condominioId = cond.rows[0].id;
    const quadra = await pool.query<{ id: string }>(
      `INSERT INTO quadras (condominio_id, codigo, atualizado_em) VALUES ($1, 'YY', now()) RETURNING id`,
      [condominioId]
    );
    quadraId = quadra.rows[0].id;
    const lote = await pool.query<{ id: string }>(
      `INSERT INTO lotes (quadra_id, numero, atualizado_em) VALUES ($1, 1, now()) RETURNING id`,
      [quadraId]
    );
    loteId = lote.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM obra_pessoa WHERE obra_id IN (SELECT id FROM obras WHERE lote_id = $1)`,
      [loteId]
    );
    await pool.query(
      `DELETE FROM obra_status_historico WHERE obra_id IN (SELECT id FROM obras WHERE lote_id = $1)`,
      [loteId]
    );
    await pool.query(`DELETE FROM anotacoes WHERE lote_id = $1 OR obra_id IN (SELECT id FROM obras WHERE lote_id = $1)`, [
      loteId,
    ]);
    await pool.query(`DELETE FROM documentos WHERE lote_id = $1 OR obra_id IN (SELECT id FROM obras WHERE lote_id = $1)`, [
      loteId,
    ]);
    await pool.query(`DELETE FROM obras WHERE lote_id = $1`, [loteId]);
    await pool.query(`DELETE FROM lotes WHERE id = $1`, [loteId]);
    await pool.query(`DELETE FROM quadras WHERE id = $1`, [quadraId]);
    await pool.query(`DELETE FROM condominios WHERE id = $1`, [condominioId]);
    await pool.query(`DELETE FROM pessoa_dados_profissionais WHERE pessoa_id IN (SELECT id FROM pessoas WHERE nome = 'Engenheira Teste API')`);
    await pool.query(`DELETE FROM pessoas WHERE nome = 'Engenheira Teste API'`);
    await app.close();
  });

  let obraId: string;

  it("cria uma obra para o lote", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/obras",
      headers: authHeader(tokenAnalista),
      payload: { loteId, tipo: "CONSTRUCAO_INICIAL" },
    });
    expect(res.statusCode).toBe(201);
    obraId = res.json().id;
    expect(res.json().loteId).toBe(loteId);
  });

  it("um lote pode ter uma segunda obra (reforma) — 1:N", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/obras",
      headers: authHeader(tokenAnalista),
      payload: { loteId, tipo: "REFORMA" },
    });
    expect(res.statusCode).toBe(201);

    const lista = await app.inject({
      method: "GET",
      url: `/lotes/${loteId}/obras`,
      headers: authHeader(tokenAdmin),
    });
    expect(lista.json()).toHaveLength(2);
  });

  it("GET /obras?quadraCodigo= filtra pelas obras da quadra de teste", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/obras?quadraCodigo=YY",
      headers: authHeader(tokenAdmin),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.paginacao.total).toBe(2);
    expect(body.dados.every((o: { quadraCodigo: string }) => o.quadraCodigo === "YY")).toBe(true);
  });

  it("atualiza o status da obra e preserva o histórico anterior", async () => {
    const s1 = await app.inject({
      method: "POST",
      url: `/obras/${obraId}/status`,
      headers: authHeader(tokenAnalista),
      payload: { statusCodigo: "EM_ANALISE" },
    });
    expect(s1.statusCode).toBe(200);

    const s2 = await app.inject({
      method: "POST",
      url: `/obras/${obraId}/status`,
      headers: authHeader(tokenAnalista),
      payload: { statusCodigo: "LIBERADA", observacao: "Aprovado em vistoria" },
    });
    expect(s2.statusCode).toBe(200);

    const historico = await app.inject({
      method: "GET",
      url: `/obras/${obraId}/historico-status`,
      headers: authHeader(tokenAdmin),
    });
    const registros = historico.json();
    expect(registros).toHaveLength(2);
    expect(registros.find((r: { statusCodigo: string }) => r.statusCodigo === "EM_ANALISE").dataFim).not.toBeNull();
    expect(registros.find((r: { statusCodigo: string }) => r.statusCodigo === "LIBERADA").dataFim).toBeNull();
  });

  it("rejeita status de obra desconhecido (400, nunca inventa correspondência)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/obras/${obraId}/status`,
      headers: authHeader(tokenAnalista),
      payload: { statusCodigo: "STATUS_QUE_NAO_EXISTE" },
    });
    expect(res.statusCode).toBe(400);
  });

  let pessoaId: string;

  it("cadastra uma pessoa e vincula como responsável técnico da obra", async () => {
    const pessoa = await app.inject({
      method: "POST",
      url: "/pessoas",
      headers: authHeader(tokenAnalista),
      payload: { nome: "Engenheira Teste API", tipoPessoa: "FISICA" },
    });
    expect(pessoa.statusCode).toBe(201);
    pessoaId = pessoa.json().id;
    expect(pessoa.json().ehResponsavelTecnico).toBe(false);

    const vinculo = await app.inject({
      method: "POST",
      url: `/obras/${obraId}/responsaveis`,
      headers: authHeader(tokenAnalista),
      payload: { pessoaId },
    });
    expect(vinculo.statusCode).toBe(204);

    const responsaveis = await app.inject({
      method: "GET",
      url: `/obras/${obraId}/responsaveis`,
      headers: authHeader(tokenAdmin),
    });
    expect(responsaveis.json()).toHaveLength(1);
    expect(responsaveis.json()[0].pessoaId).toBe(pessoaId);
  });

  it("a mesma pessoa aparece em /responsaveis-tecnicos depois de vinculada", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/responsaveis-tecnicos/${pessoaId}`,
      headers: authHeader(tokenAdmin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().totalObras).toBe(1);
  });

  it("cria uma anotação manual ligada à obra", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/anotacoes",
      headers: authHeader(tokenAnalista),
      payload: { obraId, texto: "Vistoria agendada para próxima semana." },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().origem).toBe("MANUAL");
  });

  it("rejeita anotação sem lote nem obra (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/anotacoes",
      headers: authHeader(tokenAnalista),
      payload: { texto: "Sem pai nenhum" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("registra o metadado de um documento e depois remove (só ADMIN remove)", async () => {
    const criado = await app.inject({
      method: "POST",
      url: "/documentos",
      headers: authHeader(tokenAnalista),
      payload: { loteId, tipo: "FOTO", nomeArquivo: "fachada.jpg", mimeType: "image/jpeg" },
    });
    expect(criado.statusCode).toBe(201);
    const documentoId = criado.json().id;

    const negado = await app.inject({
      method: "DELETE",
      url: `/documentos/${documentoId}`,
      headers: authHeader(tokenAnalista),
    });
    expect(negado.statusCode).toBe(403);

    const permitido = await app.inject({
      method: "DELETE",
      url: `/documentos/${documentoId}`,
      headers: authHeader(tokenAdmin),
    });
    expect(permitido.statusCode).toBe(204);
  });
});
