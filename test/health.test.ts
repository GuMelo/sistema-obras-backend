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
