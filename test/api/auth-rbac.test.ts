import { describe, it, expect, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/lib/db.js";
import { CREDENCIAIS, obterToken } from "./helpers.js";

describe("Auth", () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
  });

  it("autentica com credenciais corretas e devolve um JWT", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/login", payload: CREDENCIAIS.ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeDefined();
    expect(body.usuario.role).toBe("ADMIN");
  });

  it("rejeita senha incorreta com 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: CREDENCIAIS.ADMIN.email, senha: "senha-errada" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejeita e-mail inexistente com 401 (não revela se o e-mail existe)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "ninguem@ruda.local", senha: "qualquer" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /auth/me devolve os dados do usuário autenticado", async () => {
    const token = await obterToken(app, "ANALISTA");
    const res = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("ANALISTA");
  });

  it("GET /auth/me sem token devolve 401", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/me" });
    expect(res.statusCode).toBe(401);
  });
});

describe("RBAC — aplicado no backend, não confia no frontend", () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
  });

  it("nega acesso a rota protegida sem token (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/lotes" });
    expect(res.statusCode).toBe(401);
  });

  it("nega acesso com token inválido/adulterado (401)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/lotes",
      headers: { authorization: "Bearer token.invalido.aqui" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("CONSULTA consegue LER lotes (200)", async () => {
    const token = await obterToken(app, "CONSULTA");
    const res = await app.inject({ method: "GET", url: "/lotes", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });

  it("CONSULTA NÃO consegue criar lote (403)", async () => {
    const token = await obterToken(app, "CONSULTA");
    const res = await app.inject({
      method: "POST",
      url: "/lotes",
      headers: { authorization: `Bearer ${token}` },
      payload: { quadraId: "00000000-0000-0000-0000-000000000000", numero: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("ANALISTA consegue criar lote (chega a passar do RBAC — validação de negócio pode gerar 404 se a quadra não existir)", async () => {
    const token = await obterToken(app, "ANALISTA");
    const res = await app.inject({
      method: "POST",
      url: "/lotes",
      headers: { authorization: `Bearer ${token}` },
      payload: { quadraId: "00000000-0000-0000-0000-000000000000", numero: 1 },
    });
    // RBAC deixou passar (não é 403); a quadra inexistente gera 404 de negócio.
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).toBe(404);
  });

  it("ANALISTA NÃO consegue gerenciar usuários (403)", async () => {
    const token = await obterToken(app, "ANALISTA");
    const res = await app.inject({ method: "GET", url: "/users", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
  });

  it("ADMIN consegue gerenciar usuários (200)", async () => {
    const token = await obterToken(app, "ADMIN");
    const res = await app.inject({ method: "GET", url: "/users", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });

  it("ANALISTA NÃO consegue acessar auditoria (403)", async () => {
    const token = await obterToken(app, "ANALISTA");
    const res = await app.inject({ method: "GET", url: "/auditoria", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
  });

  it("ANALISTA NÃO consegue acessar importações (403)", async () => {
    const token = await obterToken(app, "ANALISTA");
    const res = await app.inject({
      method: "GET",
      url: "/importacoes",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("CONSULTA consegue ver o dashboard (200)", async () => {
    const token = await obterToken(app, "CONSULTA");
    const res = await app.inject({
      method: "GET",
      url: "/dashboard/resumo",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

// Fecha o pool compartilhado uma única vez, ao final de toda a suíte deste
// arquivo (health.test.ts e constraints.test.ts fecham o seu próprio).
afterAll(async () => {
  await pool.end();
});
