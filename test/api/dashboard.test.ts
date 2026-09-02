import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/lib/db.js";
import { obterToken, authHeader } from "./helpers.js";

describe("Dashboard — /indicadores e /evolucao (dados isolados de teste)", () => {
  const app = buildApp();
  let token: string;
  let condominioId: string;
  let quadraId: string;
  let loteId: string;
  let obraId: string;
  let statusEmAnaliseId: string;
  let statusEmAnaliseDescricao: string;

  beforeAll(async () => {
    token = await obterToken(app, "ADMIN");

    const cond = await pool.query<{ id: string }>(
      `INSERT INTO condominios (nome, atualizado_em) VALUES ($1, now()) RETURNING id`,
      [`Teste Dashboard ${Date.now()}`]
    );
    condominioId = cond.rows[0].id;

    const quadra = await pool.query<{ id: string }>(
      `INSERT INTO quadras (condominio_id, codigo, atualizado_em) VALUES ($1, 'ZD', now()) RETURNING id`,
      [condominioId]
    );
    quadraId = quadra.rows[0].id;

    const lote = await pool.query<{ id: string }>(
      `INSERT INTO lotes (quadra_id, numero, atualizado_em) VALUES ($1, 1, now()) RETURNING id`,
      [quadraId]
    );
    loteId = lote.rows[0].id;

    const obra = await pool.query<{ id: string }>(
      `INSERT INTO obras (lote_id, atualizado_em) VALUES ($1, now()) RETURNING id`,
      [loteId]
    );
    obraId = obra.rows[0].id;

    const status = await pool.query<{ id: string; descricao: string }>(
      `SELECT id, descricao FROM status_obra WHERE codigo = 'EM_ANALISE'`
    );
    statusEmAnaliseId = status.rows[0].id;
    statusEmAnaliseDescricao = status.rows[0].descricao;

    await pool.query(
      `INSERT INTO obra_status_historico (obra_id, status_id, data_inicio)
       VALUES ($1, $2, '2026-02-15T00:00:00Z')`,
      [obraId, statusEmAnaliseId]
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM obra_status_historico WHERE obra_id = $1`, [obraId]);
    await pool.query(`DELETE FROM obras WHERE id = $1`, [obraId]);
    await pool.query(`DELETE FROM lotes WHERE id = $1`, [loteId]);
    await pool.query(`DELETE FROM quadras WHERE id = $1`, [quadraId]);
    await pool.query(`DELETE FROM condominios WHERE id = $1`, [condominioId]);
    await app.close();
  });

  it("GET /dashboard/indicadores sem filtro inclui o lote de teste na contagem global", async () => {
    const res = await app.inject({ method: "GET", url: "/dashboard/indicadores", headers: authHeader(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalLotes).toBeGreaterThanOrEqual(1);
  });

  it("GET /dashboard/indicadores?quadraId= isola exatamente o lote de teste", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/dashboard/indicadores?quadraId=${quadraId}`,
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalLotes).toBe(1);
    expect(body.obrasPorStatus).toEqual([{ statusCodigo: "EM_ANALISE", descricao: statusEmAnaliseDescricao, quantidade: 1 }]);
  });

  it("GET /dashboard/indicadores?statusObraId= filtra por status vigente", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/dashboard/indicadores?quadraId=${quadraId}&statusObraId=${statusEmAnaliseId}`,
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().totalLotes).toBe(1);

    const outroStatus = await pool.query<{ id: string }>(`SELECT id FROM status_obra WHERE codigo = 'FINALIZADA'`);
    const resVazio = await app.inject({
      method: "GET",
      url: `/dashboard/indicadores?quadraId=${quadraId}&statusObraId=${outroStatus.rows[0].id}`,
      headers: authHeader(token),
    });
    expect(resVazio.json().totalLotes).toBe(0);
  });

  it("GET /dashboard/indicadores com ocupacao inválida devolve 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/dashboard/indicadores?ocupacao=INVALIDA",
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /dashboard/evolucao agrupa por mês e devolve o ponto do status criado", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/dashboard/evolucao?quadraId=${quadraId}&granularidade=mes`,
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.granularidade).toBe("mes");
    expect(body.serie).toEqual([
      { periodo: "2026-02", statusCodigo: "EM_ANALISE", descricao: statusEmAnaliseDescricao, quantidade: 1 },
    ]);
  });

  it("GET /dashboard/evolucao com granularidade inválida devolve 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/dashboard/evolucao?granularidade=ano",
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(400);
  });
});
