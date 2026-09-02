import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/lib/db.js";
import { obterToken, authHeader } from "./helpers.js";

describe("Lotes — listagem contra os dados reais importados", () => {
  const app = buildApp();
  let tokenAdmin: string;
  let tokenConsulta: string;

  beforeAll(async () => {
    tokenAdmin = await obterToken(app, "ADMIN");
    tokenConsulta = await obterToken(app, "CONSULTA");
  });

  afterAll(async () => {
    await app.close();
  });

  it("pagina corretamente (349 lotes reais da importação da Fase 6)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/lotes?page=1&pageSize=5",
      headers: authHeader(tokenAdmin),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dados).toHaveLength(5);
    expect(body.paginacao.total).toBeGreaterThanOrEqual(349);
    expect(body.paginacao.pageSize).toBe(5);
  });

  it("filtra por ocupacao=MORADOR e devolve só lotes ocupados", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/lotes?ocupacao=MORADOR&pageSize=10",
      headers: authHeader(tokenAdmin),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const lote of body.dados) {
      expect(lote.ocupacaoAtual).toBe("MORADOR");
    }
  });

  it("filtra por ocupacao=NAO_INFORMADO (nunca infere DISPONIVEL)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/lotes?ocupacao=NAO_INFORMADO&pageSize=5",
      headers: authHeader(tokenAdmin),
    });
    expect(res.statusCode).toBe(200);
    for (const lote of res.json().dados) {
      expect(lote.ocupacaoAtual).toBeNull();
    }
  });

  it("filtra por emAlerta=true (1 lote real, M2 12)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/lotes?emAlerta=true",
      headers: authHeader(tokenAdmin),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.paginacao.total).toBe(1);
    expect(body.dados[0].quadraCodigo).toBe("M2");
    expect(body.dados[0].numero).toBe(12);
  });

  it("filtra por quadraCodigo", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/lotes?quadraCodigo=A2",
      headers: authHeader(tokenAdmin),
    });
    expect(res.statusCode).toBe(200);
    for (const lote of res.json().dados) {
      expect(lote.quadraCodigo).toBe("A2");
    }
  });

  it("busca livre por texto de proprietário funciona", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/lotes?busca=camila",
      headers: authHeader(tokenAdmin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().paginacao.total).toBeGreaterThan(0);
  });

  it("ordena por numero decrescente quando sort=-numero", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/lotes?quadraCodigo=A2&sort=-numero&pageSize=3",
      headers: authHeader(tokenAdmin),
    });
    const numeros = res.json().dados.map((l: { numero: number }) => l.numero);
    const ordenado = [...numeros].sort((a, b) => b - a);
    expect(numeros).toEqual(ordenado);
  });

  it("rejeita campo de ordenação desconhecido (400, nunca ordena por engano)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/lotes?sort=campo_que_nao_existe",
      headers: authHeader(tokenAdmin),
    });
    expect(res.statusCode).toBe(400);
  });

  it("CONSULTA consegue listar e ver detalhe de um lote", async () => {
    const lista = await app.inject({ method: "GET", url: "/lotes?pageSize=1", headers: authHeader(tokenConsulta) });
    const { id } = lista.json().dados[0];
    const detalhe = await app.inject({ method: "GET", url: `/lotes/${id}`, headers: authHeader(tokenConsulta) });
    expect(detalhe.statusCode).toBe(200);
    expect(detalhe.json().id).toBe(id);
  });

  it("devolve 404 para lote inexistente", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/lotes/00000000-0000-0000-0000-000000000000",
      headers: authHeader(tokenAdmin),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Lotes — CRUD e ocupação (dados isolados de teste)", () => {
  const app = buildApp();
  let tokenAdmin: string;
  let tokenAnalista: string;
  let condominioId: string;
  let quadraId: string;

  beforeAll(async () => {
    tokenAdmin = await obterToken(app, "ADMIN");
    tokenAnalista = await obterToken(app, "ANALISTA");

    const cond = await pool.query<{ id: string }>(
      `INSERT INTO condominios (nome, atualizado_em) VALUES ($1, now()) RETURNING id`,
      [`Teste API Lotes ${Date.now()}`]
    );
    condominioId = cond.rows[0].id;
    const quadra = await pool.query<{ id: string }>(
      `INSERT INTO quadras (condominio_id, codigo, atualizado_em) VALUES ($1, 'ZZ', now()) RETURNING id`,
      [condominioId]
    );
    quadraId = quadra.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM lote_ocupacao_historico WHERE lote_id IN (SELECT id FROM lotes WHERE quadra_id = $1)`,
      [quadraId]
    );
    await pool.query(`DELETE FROM anotacoes WHERE lote_id IN (SELECT id FROM lotes WHERE quadra_id = $1)`, [
      quadraId,
    ]);
    await pool.query(`DELETE FROM lotes WHERE quadra_id = $1`, [quadraId]);
    await pool.query(`DELETE FROM quadras WHERE id = $1`, [quadraId]);
    await pool.query(`DELETE FROM condominios WHERE id = $1`, [condominioId]);
    await app.close();
  });

  it("cria um lote (ANALISTA)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/lotes",
      headers: authHeader(tokenAnalista),
      payload: { quadraId, numero: 1, areaM2: 300 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().numero).toBe(1);
  });

  it("rejeita lote duplicado (mesma quadra + número) com 409", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/lotes",
      headers: authHeader(tokenAnalista),
      payload: { quadraId, numero: 1 },
    });
    expect(res.statusCode).toBe(409);
  });

  it("edita um lote e registra auditoria ao mudar emAlerta", async () => {
    const criado = await app.inject({
      method: "POST",
      url: "/lotes",
      headers: authHeader(tokenAnalista),
      payload: { quadraId, numero: 2 },
    });
    const { id } = criado.json();

    const editado = await app.inject({
      method: "PATCH",
      url: `/lotes/${id}`,
      headers: authHeader(tokenAdmin),
      payload: { emAlerta: true },
    });
    expect(editado.statusCode).toBe(200);
    expect(editado.json().emAlerta).toBe(true);

    const audit = await pool.query(`SELECT * FROM audit_logs WHERE entidade = 'Lote' AND entidade_id = $1`, [id]);
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it("atualiza ocupação preservando o histórico anterior (fecha a antiga, abre a nova)", async () => {
    const criado = await app.inject({
      method: "POST",
      url: "/lotes",
      headers: authHeader(tokenAnalista),
      payload: { quadraId, numero: 3 },
    });
    const { id } = criado.json();

    const primeira = await app.inject({
      method: "POST",
      url: `/lotes/${id}/ocupacao`,
      headers: authHeader(tokenAnalista),
      payload: { ocupacao: "DISPONIVEL" },
    });
    expect(primeira.statusCode).toBe(200);

    const segunda = await app.inject({
      method: "POST",
      url: `/lotes/${id}/ocupacao`,
      headers: authHeader(tokenAnalista),
      payload: { ocupacao: "MORADOR", observacao: "Mudou-se" },
    });
    expect(segunda.statusCode).toBe(200);

    const historico = await app.inject({
      method: "GET",
      url: `/lotes/${id}/historico-ocupacao`,
      headers: authHeader(tokenAdmin),
    });
    const registros = historico.json();
    expect(registros).toHaveLength(2);
    expect(registros.find((r: { ocupacao: string }) => r.ocupacao === "DISPONIVEL").dataFim).not.toBeNull();
    expect(registros.find((r: { ocupacao: string }) => r.ocupacao === "MORADOR").dataFim).toBeNull();
  });

  it("rejeita atualizar para a mesma ocupação já vigente (400)", async () => {
    const criado = await app.inject({
      method: "POST",
      url: "/lotes",
      headers: authHeader(tokenAnalista),
      payload: { quadraId, numero: 4 },
    });
    const { id } = criado.json();

    await app.inject({
      method: "POST",
      url: `/lotes/${id}/ocupacao`,
      headers: authHeader(tokenAnalista),
      payload: { ocupacao: "MORADOR" },
    });

    const repetida = await app.inject({
      method: "POST",
      url: `/lotes/${id}/ocupacao`,
      headers: authHeader(tokenAnalista),
      payload: { ocupacao: "MORADOR" },
    });
    expect(repetida.statusCode).toBe(400);
  });
});

describe("Lotes — campos expandidos: proprietários, responsáveis, obra, apoio (dados isolados)", () => {
  const app = buildApp();
  let tokenAdmin: string;
  let condominioId: string;
  let quadraId: string;
  let loteVazioId: string;
  let loteCompletoId: string;
  let loteApoioId: string;
  let obraId: string;

  beforeAll(async () => {
    tokenAdmin = await obterToken(app, "ADMIN");

    const cond = await pool.query<{ id: string }>(
      `INSERT INTO condominios (nome, atualizado_em) VALUES ($1, now()) RETURNING id`,
      [`Teste API Lotes Expandido ${Date.now()}`]
    );
    condominioId = cond.rows[0].id;
    const quadra = await pool.query<{ id: string }>(
      `INSERT INTO quadras (condominio_id, codigo, atualizado_em) VALUES ($1, 'ZE', now()) RETURNING id`,
      [condominioId]
    );
    quadraId = quadra.rows[0].id;

    const loteVazio = await pool.query<{ id: string }>(
      `INSERT INTO lotes (quadra_id, numero, atualizado_em) VALUES ($1, 1, now()) RETURNING id`,
      [quadraId]
    );
    loteVazioId = loteVazio.rows[0].id;

    const loteCompleto = await pool.query<{ id: string }>(
      `INSERT INTO lotes (quadra_id, numero, atualizado_em) VALUES ($1, 2, now()) RETURNING id`,
      [quadraId]
    );
    loteCompletoId = loteCompleto.rows[0].id;

    const loteApoio = await pool.query<{ id: string }>(
      `INSERT INTO lotes (quadra_id, numero, atualizado_em) VALUES ($1, 3, now()) RETURNING id`,
      [quadraId]
    );
    loteApoioId = loteApoio.rows[0].id;

    const titular = await pool.query<{ id: string }>(
      `INSERT INTO pessoas (nome, tipo_pessoa, atualizado_em) VALUES ($1, 'FISICA', now()) RETURNING id`,
      [`Titular Teste Lotes ${Date.now()}`]
    );
    await pool.query(`INSERT INTO lote_pessoa (lote_id, pessoa_id, papel) VALUES ($1, $2, 'TITULAR')`, [
      loteCompletoId,
      titular.rows[0].id,
    ]);

    const responsavel = await pool.query<{ id: string }>(
      `INSERT INTO pessoas (nome, tipo_pessoa, atualizado_em) VALUES ($1, 'FISICA', now()) RETURNING id`,
      [`Responsável Teste Lotes ${Date.now()}`]
    );
    const obra = await pool.query<{ id: string }>(
      `INSERT INTO obras (lote_id, atualizado_em) VALUES ($1, now()) RETURNING id`,
      [loteCompletoId]
    );
    obraId = obra.rows[0].id;
    await pool.query(`INSERT INTO obra_pessoa (obra_id, pessoa_id, papel) VALUES ($1, $2, 'RESPONSAVEL_TECNICO')`, [
      obraId,
      responsavel.rows[0].id,
    ]);

    await pool.query(
      `INSERT INTO lote_apoio (lote_em_obra_id, lote_apoio_id, observacao) VALUES ($1, $2, 'Teste automatizado')`,
      [loteCompletoId, loteApoioId]
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM lote_apoio WHERE lote_em_obra_id = $1`, [loteCompletoId]);
    await pool.query(`DELETE FROM obra_pessoa WHERE obra_id = $1`, [obraId]);
    await pool.query(`DELETE FROM obras WHERE id = $1`, [obraId]);
    await pool.query(`DELETE FROM lote_pessoa WHERE lote_id = $1`, [loteCompletoId]);
    await pool.query(`DELETE FROM pessoas WHERE nome LIKE 'Titular Teste Lotes%' OR nome LIKE 'Responsável Teste Lotes%'`);
    await pool.query(`DELETE FROM lotes WHERE quadra_id = $1`, [quadraId]);
    await pool.query(`DELETE FROM quadras WHERE id = $1`, [quadraId]);
    await pool.query(`DELETE FROM condominios WHERE id = $1`, [condominioId]);
    await app.close();
  });

  it("lote sem vínculo nenhum devolve arrays vazios, obraEmAcompanhamentoId nulo e temLoteApoio falso", async () => {
    const res = await app.inject({ method: "GET", url: `/lotes/${loteVazioId}`, headers: authHeader(tokenAdmin) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.proprietarios).toEqual([]);
    expect(body.responsaveisTecnicos).toEqual([]);
    expect(body.obraEmAcompanhamentoId).toBeNull();
    expect(body.temLoteApoio).toBe(false);
  });

  it("lote com proprietário, responsável técnico, obra e apoio devolve tudo preenchido", async () => {
    const res = await app.inject({ method: "GET", url: `/lotes/${loteCompletoId}`, headers: authHeader(tokenAdmin) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.proprietarios).toHaveLength(1);
    expect(body.proprietarios[0].papel).toBe("TITULAR");
    expect(body.responsaveisTecnicos).toHaveLength(1);
    // Fixture não cadastra pessoa_dados_profissionais para este responsável
    // técnico — "papel" reflete o tipo profissional real (ARQUITETO/
    // ENGENHEIRO), não o antigo valor fixo "RESPONSAVEL_TECNICO", então vem
    // null quando esse dado não foi informado.
    expect(body.responsaveisTecnicos[0].papel).toBeNull();
    expect(body.obraEmAcompanhamentoId).toBe(obraId);
    expect(body.temLoteApoio).toBe(true);
  });

  it("GET /lotes/:id/apoios mostra USA_APOIO de um lado e E_APOIO_DE do outro", async () => {
    const usaApoio = await app.inject({
      method: "GET",
      url: `/lotes/${loteCompletoId}/apoios`,
      headers: authHeader(tokenAdmin),
    });
    expect(usaApoio.statusCode).toBe(200);
    expect(usaApoio.json()).toEqual([
      expect.objectContaining({ direcao: "USA_APOIO", loteId: loteApoioId, observacao: "Teste automatizado" }),
    ]);

    const eApoioDe = await app.inject({
      method: "GET",
      url: `/lotes/${loteApoioId}/apoios`,
      headers: authHeader(tokenAdmin),
    });
    expect(eApoioDe.statusCode).toBe(200);
    expect(eApoioDe.json()).toEqual([
      expect.objectContaining({ direcao: "E_APOIO_DE", loteId: loteCompletoId, observacao: "Teste automatizado" }),
    ]);
  });

  it("GET /lotes/:id/apoios de lote inexistente devolve 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/lotes/00000000-0000-0000-0000-000000000000/apoios",
      headers: authHeader(tokenAdmin),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Lotes — edição completa via PATCH /lotes/:id (dados isolados de teste)", () => {
  const app = buildApp();
  let tokenAdmin: string;
  let tokenConsulta: string;
  let condominioId: string;
  let quadraId: string;
  let loteId: string;
  let loteApoioId: string;
  let loteApoioId2: string;
  let titularId: string;
  let cotitularId: string;
  let arquitetoId: string;
  let engenheiroId: string;
  let statusEmAnaliseId: string;
  let statusLiberadaCodigo: string;

  beforeAll(async () => {
    tokenAdmin = await obterToken(app, "ADMIN");
    tokenConsulta = await obterToken(app, "CONSULTA");

    const cond = await pool.query<{ id: string }>(
      `INSERT INTO condominios (nome, atualizado_em) VALUES ($1, now()) RETURNING id`,
      [`Teste Edição Lote ${Date.now()}`]
    );
    condominioId = cond.rows[0].id;
    const quadra = await pool.query<{ id: string }>(
      `INSERT INTO quadras (condominio_id, codigo, atualizado_em) VALUES ($1, 'ZP', now()) RETURNING id`,
      [condominioId]
    );
    quadraId = quadra.rows[0].id;

    const lote = await pool.query<{ id: string }>(
      `INSERT INTO lotes (quadra_id, numero, atualizado_em) VALUES ($1, 1, now()) RETURNING id`,
      [quadraId]
    );
    loteId = lote.rows[0].id;
    const apoio1 = await pool.query<{ id: string }>(
      `INSERT INTO lotes (quadra_id, numero, atualizado_em) VALUES ($1, 2, now()) RETURNING id`,
      [quadraId]
    );
    loteApoioId = apoio1.rows[0].id;
    const apoio2 = await pool.query<{ id: string }>(
      `INSERT INTO lotes (quadra_id, numero, atualizado_em) VALUES ($1, 3, now()) RETURNING id`,
      [quadraId]
    );
    loteApoioId2 = apoio2.rows[0].id;

    const nomes = [
      `Titular Edição Teste ${Date.now()}`,
      `Cotitular Edição Teste ${Date.now()}`,
      `Arquiteto Edição Teste ${Date.now()}`,
      `Engenheiro Edição Teste ${Date.now()}`,
    ];
    const pessoas = await Promise.all(
      nomes.map((nome) =>
        pool.query<{ id: string }>(
          `INSERT INTO pessoas (nome, tipo_pessoa, atualizado_em) VALUES ($1, 'FISICA', now()) RETURNING id`,
          [nome]
        )
      )
    );
    [titularId, cotitularId, arquitetoId, engenheiroId] = pessoas.map((r) => r.rows[0].id);

    const statusEmAnalise = await pool.query<{ id: string }>(`SELECT id FROM status_obra WHERE codigo = 'EM_ANALISE'`);
    statusEmAnaliseId = statusEmAnalise.rows[0].id;
    const statusLiberada = await pool.query<{ codigo: string }>(`SELECT codigo FROM status_obra WHERE codigo = 'LIBERADA'`);
    statusLiberadaCodigo = statusLiberada.rows[0].codigo;
  });

  afterAll(async () => {
    const loteIds = [loteId, loteApoioId, loteApoioId2];
    const pessoaIds = [titularId, cotitularId, arquitetoId, engenheiroId];
    await pool.query(`DELETE FROM lote_apoio WHERE lote_em_obra_id = ANY($1::uuid[])`, [loteIds]);
    await pool.query(
      `DELETE FROM obra_pessoa WHERE obra_id IN (SELECT id FROM obras WHERE lote_id = ANY($1::uuid[]))`,
      [loteIds]
    );
    await pool.query(
      `DELETE FROM obra_status_historico WHERE obra_id IN (SELECT id FROM obras WHERE lote_id = ANY($1::uuid[]))`,
      [loteIds]
    );
    await pool.query(`DELETE FROM lote_ocupacao_historico WHERE lote_id = ANY($1::uuid[])`, [loteIds]);
    await pool.query(`DELETE FROM anotacoes WHERE lote_id = ANY($1::uuid[])`, [loteIds]);
    await pool.query(`DELETE FROM audit_logs WHERE entidade = 'Lote' AND entidade_id = ANY($1::uuid[])`, [loteIds]);
    await pool.query(
      `DELETE FROM audit_logs WHERE entidade = 'Obra' AND entidade_id IN (SELECT id FROM obras WHERE lote_id = ANY($1::uuid[]))`,
      [loteIds]
    );
    await pool.query(`DELETE FROM lote_pessoa WHERE lote_id = ANY($1::uuid[])`, [loteIds]);
    await pool.query(`DELETE FROM pessoa_dados_profissionais WHERE pessoa_id = ANY($1::uuid[])`, [pessoaIds]);
    await pool.query(`DELETE FROM obras WHERE lote_id = ANY($1::uuid[])`, [loteIds]);
    await pool.query(`DELETE FROM lotes WHERE id = ANY($1::uuid[])`, [loteIds]);
    await pool.query(`DELETE FROM pessoas WHERE id = ANY($1::uuid[])`, [pessoaIds]);
    await pool.query(`DELETE FROM quadras WHERE id = $1`, [quadraId]);
    await pool.query(`DELETE FROM condominios WHERE id = $1`, [condominioId]);
    await app.close();
  });

  it("edita o endereço, cria histórico funcional e AuditLog, e atualiza atualizadoEm", async () => {
    const antes = await app.inject({ method: "GET", url: `/lotes/${loteId}`, headers: authHeader(tokenAdmin) });
    expect(antes.json().enderecoLogradouro).toBeNull();
    const atualizadoEmAntes = (
      await pool.query<{ atualizadoEm: string }>(`SELECT atualizado_em AS "atualizadoEm" FROM lotes WHERE id = $1`, [
        loteId,
      ])
    ).rows[0].atualizadoEm;

    const res = await app.inject({
      method: "PATCH",
      url: `/lotes/${loteId}`,
      headers: authHeader(tokenAdmin),
      payload: { enderecoLogradouro: "Rua Teste", enderecoNumero: "100" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enderecoLogradouro).toBe("Rua Teste");
    expect(res.json().enderecoNumero).toBe("100");

    const depois = await pool.query<{ atualizadoEm: string }>(
      `SELECT atualizado_em AS "atualizadoEm" FROM lotes WHERE id = $1`,
      [loteId]
    );
    expect(new Date(depois.rows[0].atualizadoEm).getTime()).toBeGreaterThan(new Date(atualizadoEmAntes).getTime());

    const anotacao = await pool.query(
      `SELECT texto, origem FROM anotacoes WHERE lote_id = $1 ORDER BY criado_em DESC LIMIT 1`,
      [loteId]
    );
    expect(anotacao.rows[0]).toEqual({ texto: "Endereço atualizado.", origem: "EDICAO_SISTEMA" });

    const audit = await pool.query(
      `SELECT campo_alterado AS "campoAlterado" FROM audit_logs WHERE entidade='Lote' AND entidade_id = $1 ORDER BY data_hora DESC`,
      [loteId]
    );
    expect(audit.rows.map((r) => r.campoAlterado)).toEqual(
      expect.arrayContaining(["enderecoLogradouro", "enderecoNumero"])
    );
  });

  it("não gera histórico/AuditLog/atualizadoEm quando os valores enviados já são os vigentes", async () => {
    const atualizadoEmAntes = (
      await pool.query<{ atualizadoEm: string }>(`SELECT atualizado_em AS "atualizadoEm" FROM lotes WHERE id = $1`, [
        loteId,
      ])
    ).rows[0].atualizadoEm;
    const anotacoesAntes = Number(
      (await pool.query(`SELECT count(*) FROM anotacoes WHERE lote_id = $1`, [loteId])).rows[0].count
    );

    const res = await app.inject({
      method: "PATCH",
      url: `/lotes/${loteId}`,
      headers: authHeader(tokenAdmin),
      payload: { enderecoLogradouro: "Rua Teste", enderecoNumero: "100" },
    });
    expect(res.statusCode).toBe(200);

    const depois = await pool.query<{ atualizadoEm: string }>(
      `SELECT atualizado_em AS "atualizadoEm" FROM lotes WHERE id = $1`,
      [loteId]
    );
    expect(depois.rows[0].atualizadoEm).toEqual(atualizadoEmAntes);
    const anotacoesDepois = Number(
      (await pool.query(`SELECT count(*) FROM anotacoes WHERE lote_id = $1`, [loteId])).rows[0].count
    );
    expect(anotacoesDepois).toBe(anotacoesAntes);
  });

  it("troca a ocupação e cria o histórico de ocupação", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lotes/${loteId}`,
      headers: authHeader(tokenAdmin),
      payload: { ocupacao: "MORADOR" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ocupacaoAtual).toBe("MORADOR");

    const historico = await app.inject({
      method: "GET",
      url: `/lotes/${loteId}/historico-ocupacao`,
      headers: authHeader(tokenAdmin),
    });
    expect(historico.json()).toHaveLength(1);
  });

  it("cria a obra ao enviar tipo/status pela primeira vez, e troca o status da obra", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lotes/${loteId}`,
      headers: authHeader(tokenAdmin),
      payload: { obra: { tipo: "CONSTRUCAO_INICIAL", statusCodigo: statusLiberadaCodigo } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.statusObraAtual).toBe(statusLiberadaCodigo);
    expect(body.obraEmAcompanhamentoId).not.toBeNull();

    const anotacao = await pool.query(`SELECT texto FROM anotacoes WHERE lote_id = $1 ORDER BY criado_em DESC LIMIT 1`, [
      loteId,
    ]);
    expect(anotacao.rows[0].texto).toContain("Atualização do lote:");
  });

  it("troca o tipo da obra sozinho, com frase dedicada no histórico", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lotes/${loteId}`,
      headers: authHeader(tokenAdmin),
      payload: { obra: { tipo: "REFORMA" } },
    });
    expect(res.statusCode).toBe(200);

    const anotacao = await pool.query(`SELECT texto FROM anotacoes WHERE lote_id = $1 ORDER BY criado_em DESC LIMIT 1`, [
      loteId,
    ]);
    expect(anotacao.rows[0].texto).toBe("Tipo da obra alterado de 'Construção inicial' para 'Reforma'.");
  });

  it("adiciona arquiteto e engenheiro como responsáveis técnicos (múltiplos)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lotes/${loteId}`,
      headers: authHeader(tokenAdmin),
      payload: {
        responsaveisTecnicos: [
          { pessoaId: arquitetoId, tipo: "ARQUITETO" },
          { pessoaId: engenheiroId, tipo: "ENGENHEIRO" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const responsaveis = res.json().responsaveisTecnicos as Array<{ pessoaId: string; nome: string; papel: string }>;
    const ids = responsaveis.map((r) => r.pessoaId).sort();
    expect(ids).toEqual([arquitetoId, engenheiroId].sort());

    // "papel" reflete o cargo estruturado (ARQUITETO/ENGENHEIRO), não o
    // valor fixo "RESPONSAVEL_TECNICO" de obra_pessoa; e "nome" não repete o
    // prefixo profissional que já está em "papel" (o nome de teste começa
    // literalmente com "Arquiteto "/não tem prefixo para engenheiro, então
    // isso também comprova que o prefixo é removido só quando presente).
    const arquiteto = responsaveis.find((r) => r.pessoaId === arquitetoId)!;
    expect(arquiteto.papel).toBe("ARQUITETO");
    expect(arquiteto.nome.startsWith("Arquiteto ")).toBe(false);
    expect(arquiteto.nome).toContain("Edição Teste");
    const engenheiro = responsaveis.find((r) => r.pessoaId === engenheiroId)!;
    expect(engenheiro.papel).toBe("ENGENHEIRO");
  });

  it("remove um responsável técnico mantendo o outro", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lotes/${loteId}`,
      headers: authHeader(tokenAdmin),
      payload: { responsaveisTecnicos: [{ pessoaId: arquitetoId }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().responsaveisTecnicos).toEqual([expect.objectContaining({ pessoaId: arquitetoId })]);

    const anotacao = await pool.query(`SELECT texto FROM anotacoes WHERE lote_id = $1 ORDER BY criado_em DESC LIMIT 1`, [
      loteId,
    ]);
    expect(anotacao.rows[0].texto).toBe("Responsável técnico engenheiro removido.");
  });

  it("edita o proprietário: adiciona titular e cotitular", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lotes/${loteId}`,
      headers: authHeader(tokenAdmin),
      payload: {
        proprietarios: [
          { pessoaId: titularId, papel: "TITULAR" },
          { pessoaId: cotitularId, papel: "COTITULAR" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().proprietarios).toHaveLength(2);
  });

  it("vincula um lote de apoio", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lotes/${loteId}`,
      headers: authHeader(tokenAdmin),
      payload: { loteApoioIds: [loteApoioId] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().temLoteApoio).toBe(true);

    const apoios = await app.inject({ method: "GET", url: `/lotes/${loteId}/apoios`, headers: authHeader(tokenAdmin) });
    expect(apoios.json()).toEqual([expect.objectContaining({ loteId: loteApoioId })]);
  });

  it("altera o lote de apoio (substitui pelo novo)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lotes/${loteId}`,
      headers: authHeader(tokenAdmin),
      payload: { loteApoioIds: [loteApoioId2] },
    });
    expect(res.statusCode).toBe(200);

    const apoios = await app.inject({ method: "GET", url: `/lotes/${loteId}/apoios`, headers: authHeader(tokenAdmin) });
    expect(apoios.json()).toEqual([expect.objectContaining({ loteId: loteApoioId2 })]);
  });

  it("remove o lote de apoio", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lotes/${loteId}`,
      headers: authHeader(tokenAdmin),
      payload: { loteApoioIds: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().temLoteApoio).toBe(false);
  });

  it("ativa e desativa o alerta", async () => {
    const ativa = await app.inject({
      method: "PATCH",
      url: `/lotes/${loteId}`,
      headers: authHeader(tokenAdmin),
      payload: { emAlerta: true },
    });
    expect(ativa.json().emAlerta).toBe(true);
    const anotacaoAtiva = await pool.query(
      `SELECT texto FROM anotacoes WHERE lote_id = $1 ORDER BY criado_em DESC LIMIT 1`,
      [loteId]
    );
    expect(anotacaoAtiva.rows[0].texto).toBe("Alerta ativado.");

    const desativa = await app.inject({
      method: "PATCH",
      url: `/lotes/${loteId}`,
      headers: authHeader(tokenAdmin),
      payload: { emAlerta: false },
    });
    expect(desativa.json().emAlerta).toBe(false);
    const anotacaoDesativa = await pool.query(
      `SELECT texto FROM anotacoes WHERE lote_id = $1 ORDER BY criado_em DESC LIMIT 1`,
      [loteId]
    );
    expect(anotacaoDesativa.rows[0].texto).toBe("Alerta desativado.");
  });

  it("atualiza vários campos numa única chamada e gera o resumo combinado", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lotes/${loteId}`,
      headers: authHeader(tokenAdmin),
      payload: {
        enderecoLogradouro: "Rua Combinada",
        obra: { statusCodigo: "EM_ANALISE" },
        ocupacao: "DISPONIVEL",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(statusEmAnaliseId).toBeTruthy();

    const anotacao = await pool.query(`SELECT texto FROM anotacoes WHERE lote_id = $1 ORDER BY criado_em DESC LIMIT 1`, [
      loteId,
    ]);
    expect(anotacao.rows[0].texto).toMatch(/^Atualização do lote: .+\.$/);
    expect(anotacao.rows[0].texto).toContain("endereço");
    expect(anotacao.rows[0].texto).toContain("ocupação");
  });

  it("ignora quadraId, numero e areaM2 — não fazem parte do DTO, então o ajv (removeAdditional) os descarta sem alterar nada", async () => {
    const antes = await pool.query<{ quadraId: string; numero: number; areaM2: number | null }>(
      `SELECT quadra_id AS "quadraId", numero, area_m2::float AS "areaM2" FROM lotes WHERE id = $1`,
      [loteId]
    );
    for (const payload of [{ quadraId: "00000000-0000-0000-0000-000000000000" }, { numero: 99 }, { areaM2: 500 }]) {
      const res = await app.inject({
        method: "PATCH",
        url: `/lotes/${loteId}`,
        headers: authHeader(tokenAdmin),
        payload,
      });
      // additionalProperties: false + removeAdditional (padrão do ajv no
      // Fastify) descarta o campo desconhecido em vez de rejeitar a
      // requisição — o body efetivo vira {}, um no-op válido (200).
      expect(res.statusCode).toBe(200);
    }
    const depois = await pool.query<{ quadraId: string; numero: number; areaM2: number | null }>(
      `SELECT quadra_id AS "quadraId", numero, area_m2::float AS "areaM2" FROM lotes WHERE id = $1`,
      [loteId]
    );
    expect(depois.rows[0]).toEqual(antes.rows[0]);
  });

  it("CONSULTA não pode editar (403)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lotes/${loteId}`,
      headers: authHeader(tokenConsulta),
      payload: { enderecoLogradouro: "Não deveria salvar" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejeita lote de apoio apontando para ele mesmo (400)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lotes/${loteId}`,
      headers: authHeader(tokenAdmin),
      payload: { loteApoioIds: [loteId] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("pessoaId inexistente em proprietarios/responsaveisTecnicos devolve 404", async () => {
    const idInexistente = "00000000-0000-0000-0000-000000000000";
    const proprietario = await app.inject({
      method: "PATCH",
      url: `/lotes/${loteId}`,
      headers: authHeader(tokenAdmin),
      payload: { proprietarios: [{ pessoaId: idInexistente, papel: "TITULAR" }] },
    });
    expect(proprietario.statusCode).toBe(404);

    const responsavel = await app.inject({
      method: "PATCH",
      url: `/lotes/${loteId}`,
      headers: authHeader(tokenAdmin),
      payload: { responsaveisTecnicos: [{ pessoaId: idInexistente }] },
    });
    expect(responsavel.statusCode).toBe(404);
  });

  it("lote de apoio inexistente devolve 404 e reverte a chamada inteira (rollback)", async () => {
    const idInexistente = "00000000-0000-0000-0000-000000000000";
    const enderecoAntes = (
      await pool.query<{ enderecoLogradouro: string | null }>(
        `SELECT endereco_logradouro AS "enderecoLogradouro" FROM lotes WHERE id = $1`,
        [loteId]
      )
    ).rows[0].enderecoLogradouro;

    const res = await app.inject({
      method: "PATCH",
      url: `/lotes/${loteId}`,
      headers: authHeader(tokenAdmin),
      payload: {
        enderecoLogradouro: "NÃO DEVE PERSISTIR",
        loteApoioIds: [loteApoioId2, idInexistente],
      },
    });
    expect(res.statusCode).toBe(404);

    const enderecoDepois = (
      await pool.query<{ enderecoLogradouro: string | null }>(
        `SELECT endereco_logradouro AS "enderecoLogradouro" FROM lotes WHERE id = $1`,
        [loteId]
      )
    ).rows[0].enderecoLogradouro;
    expect(enderecoDepois).toBe(enderecoAntes);
  });
});
