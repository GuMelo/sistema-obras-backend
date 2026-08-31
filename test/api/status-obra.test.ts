import { describe, it, expect, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";
import { obterToken, authHeader } from "./helpers.js";

describe("Catálogo de Status de Obra", () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
  });

  it("exige autenticação (401 sem token)", async () => {
    const res = await app.inject({ method: "GET", url: "/status-obra" });
    expect(res.statusCode).toBe(401);
  });

  it("lista o catálogo fechado de 8 status, ordenado por ordemExibicao", async () => {
    const token = await obterToken(app, "CONSULTA");
    const res = await app.inject({ method: "GET", url: "/status-obra", headers: authHeader(token) });
    expect(res.statusCode).toBe(200);

    const body = res.json() as Array<{
      id: string;
      codigo: string;
      descricao: string;
      ordemExibicao: number;
      ativo: boolean;
    }>;
    expect(body).toHaveLength(8);
    expect(body.map((s) => s.codigo)).toEqual([
      "EM_ANALISE",
      "LIBERADA_PARCIAL_MURO_TERRAPLANAGEM",
      "LIBERADA",
      "LIBERADA_NAO_INICIADA",
      "PARALISADA",
      "FINALIZADA",
      "FINALIZADA_VISTORIADA",
      "REFORMA_EM_ANDAMENTO",
    ]);
    for (const s of body) {
      expect(s.ativo).toBe(true);
      expect(typeof s.id).toBe("string");
    }
  });
});
