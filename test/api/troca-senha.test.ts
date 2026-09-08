import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/lib/db.js";
import { obterToken, authHeader } from "./helpers.js";

describe("Troca de senha (ADMIN redefine de outro usuário | usuário troca a própria)", () => {
  const app = buildApp();
  let tokenAdmin: string;
  let tokenAnalista: string;
  let usuarioId: string;
  const email = `teste-troca-senha-${Date.now()}@example.com`;
  const senhaInicial = "SenhaInicial123";

  beforeAll(async () => {
    tokenAdmin = await obterToken(app, "ADMIN");
    tokenAnalista = await obterToken(app, "ANALISTA");

    const hash = await bcrypt.hash(senhaInicial, 10);
    const res = await pool.query<{ id: string }>(
      `INSERT INTO usuarios (nome, email, senha_hash, role, atualizado_em)
       VALUES ('Teste Troca de Senha', $1, $2, 'ANALISTA', now()) RETURNING id`,
      [email, hash]
    );
    usuarioId = res.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM usuarios WHERE id = $1`, [usuarioId]);
    await app.close();
  });

  it("ADMIN redefine a senha de outro usuário diretamente, sem precisar da senha atual", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/users/${usuarioId}`,
      headers: authHeader(tokenAdmin),
      payload: { senha: "SenhaDefinidaPeloAdmin1" },
    });
    expect(res.statusCode).toBe(200);

    const loginNova = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, senha: "SenhaDefinidaPeloAdmin1" },
    });
    expect(loginNova.statusCode).toBe(200);

    const loginAntiga = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, senha: senhaInicial },
    });
    expect(loginAntiga.statusCode).toBe(401);
  });

  it("ANALISTA não consegue redefinir a senha de outro usuário (403 — PATCH /users/:id é só ADMIN)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/users/${usuarioId}`,
      headers: authHeader(tokenAnalista),
      payload: { senha: "OutraSenha123" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("usuário troca a própria senha informando a senha atual corretamente", async () => {
    const tokenUsuario = (
      await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email, senha: "SenhaDefinidaPeloAdmin1" },
      })
    ).json().token;

    const res = await app.inject({
      method: "PATCH",
      url: "/auth/senha",
      headers: authHeader(tokenUsuario),
      payload: { senhaAtual: "SenhaDefinidaPeloAdmin1", novaSenha: "MinhaNovaSenha123" },
    });
    expect(res.statusCode).toBe(204);

    const loginNova = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, senha: "MinhaNovaSenha123" },
    });
    expect(loginNova.statusCode).toBe(200);

    const loginAntiga = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, senha: "SenhaDefinidaPeloAdmin1" },
    });
    expect(loginAntiga.statusCode).toBe(401);
  });

  it("rejeita com 400 quando a senha atual informada está errada (não desloga a sessão com 401)", async () => {
    const tokenUsuario = (
      await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email, senha: "MinhaNovaSenha123" },
      })
    ).json().token;

    const res = await app.inject({
      method: "PATCH",
      url: "/auth/senha",
      headers: authHeader(tokenUsuario),
      payload: { senhaAtual: "senha-errada-qualquer", novaSenha: "OutraSenhaValida123" },
    });
    expect(res.statusCode).toBe(400);

    // A senha não deve ter mudado.
    const loginAntiga = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, senha: "MinhaNovaSenha123" },
    });
    expect(loginAntiga.statusCode).toBe(200);
  });

  it("rejeita com 400 quando a nova senha é menor que 8 caracteres", async () => {
    const tokenUsuario = (
      await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email, senha: "MinhaNovaSenha123" },
      })
    ).json().token;

    const res = await app.inject({
      method: "PATCH",
      url: "/auth/senha",
      headers: authHeader(tokenUsuario),
      payload: { senhaAtual: "MinhaNovaSenha123", novaSenha: "curta" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /auth/senha sem token devolve 401", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/auth/senha",
      payload: { senhaAtual: "qualquer", novaSenha: "qualquercoisa123" },
    });
    expect(res.statusCode).toBe(401);
  });
});
