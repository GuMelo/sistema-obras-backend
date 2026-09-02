import { describe, it, expect, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { pool } from "../src/lib/db.js";

describe("healthcheck", () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("GET /health responde ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /health/db confirma conexão real com o Postgres", async () => {
    const res = await app.inject({ method: "GET", url: "/health/db" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("CORS — preflight libera os métodos realmente usados pela API", () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
  });

  // @fastify/cors, sem a opção `methods` explícita, usa como default só
  // "GET,HEAD,POST" — bloqueando PATCH/DELETE no preflight do navegador
  // mesmo com o endpoint funcionando normalmente fora dele (sem preflight).
  it.each(["PATCH", "DELETE"])("preflight OPTIONS libera %s em access-control-allow-methods", async (metodo) => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/lotes/00000000-0000-0000-0000-000000000000",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": metodo,
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain(metodo);
  });
});
