import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/lib/db.js";
import { obterToken, authHeader } from "./helpers.js";

const CABECALHOS_ESPERADOS = [
  "QUADRA",
  "LOTE",
  "M2",
  "ENDEREÇO",
  "PROPRIETÁRIO",
  "ARQUITETO / ENGENHEIRO",
  "STATUS",
  "LOTE APOIO",
  "DATA DE LIBERAÇÃO DA OBRA",
  "VISTORIA PÓS OBRA",
  "LIBERADO PARA MUDANÇA?",
  "DATA DA MUDANÇA",
  "OBSERVAÇÕES",
];

describe("Relatórios — GET /relatorios/planilha-obras (dados isolados de teste)", () => {
  const app = buildApp();
  let tokenAdmin: string;
  let tokenConsulta: string;
  let condominioId: string;
  let quadraPrincipalId: string;
  let loteAlertaId: string;
  let lotePessoasId: string;
  let loteApoioOrigemId: string;
  let loteApoioAlvoId: string;
  let loteVazioId: string;
  let loteOutraQuadraId: string;
  const pessoaIds: string[] = [];
  const loteIds: string[] = [];

  beforeAll(async () => {
    tokenAdmin = await obterToken(app, "ADMIN");
    tokenConsulta = await obterToken(app, "CONSULTA");

    const cond = await pool.query<{ id: string }>(
      `INSERT INTO condominios (nome, atualizado_em) VALUES ($1, now()) RETURNING id`,
      [`Teste Relatório ${Date.now()}`]
    );
    condominioId = cond.rows[0].id;

    const quadraPrincipal = await pool.query<{ id: string }>(
      `INSERT INTO quadras (condominio_id, codigo, atualizado_em) VALUES ($1, 'RP', now()) RETURNING id`,
      [condominioId]
    );
    quadraPrincipalId = quadraPrincipal.rows[0].id;
    const quadraSecundaria = await pool.query<{ id: string }>(
      `INSERT INTO quadras (condominio_id, codigo, atualizado_em) VALUES ($1, 'RQ', now()) RETURNING id`,
      [condominioId]
    );

    // Lote 1: em_alerta + MORADOR + obra com status simultaneamente -> STATUS deve priorizar "LOTE EM ALERTA".
    const loteAlerta = await pool.query<{ id: string }>(
      `INSERT INTO lotes (quadra_id, numero, area_m2, endereco_logradouro, endereco_numero, em_alerta, observacao_legado, atualizado_em)
       VALUES ($1, 1, 300, 'Rua Teste', '10', true, 'Observação de teste', now()) RETURNING id`,
      [quadraPrincipalId]
    );
    loteAlertaId = loteAlerta.rows[0].id;
    await pool.query(
      `INSERT INTO lote_ocupacao_historico (lote_id, ocupacao, data_inicio) VALUES ($1, 'MORADOR', now())`,
      [loteAlertaId]
    );
    const obraAlerta = await pool.query<{ id: string }>(
      `INSERT INTO obras (lote_id, tipo, data_liberacao, data_vistoria_pos_obra, liberado_para_mudanca, data_mudanca, atualizado_em)
       VALUES ($1, 'CONSTRUCAO_INICIAL', '2026-01-15', '2026-02-20', true, '2026-03-10', now()) RETURNING id`,
      [loteAlertaId]
    );
    const statusLiberada = await pool.query<{ id: string }>(`SELECT id FROM status_obra WHERE codigo = 'LIBERADA'`);
    await pool.query(
      `INSERT INTO obra_status_historico (obra_id, status_id, data_inicio) VALUES ($1, $2, now())`,
      [obraAlerta.rows[0].id, statusLiberada.rows[0].id]
    );

    // Lote 2: 2 proprietários (titular+cotitular) e 2 responsáveis técnicos (arquiteto+engenheiro).
    const lotePessoas = await pool.query<{ id: string }>(
      `INSERT INTO lotes (quadra_id, numero, area_m2, atualizado_em) VALUES ($1, 2, 200, now()) RETURNING id`,
      [quadraPrincipalId]
    );
    lotePessoasId = lotePessoas.rows[0].id;
    // Nomes que não começam com "Arquiteto"/"Engenheiro" de propósito — esses
    // prefixos são removidos por removerPrefixoProfissional() na resposta,
    // então usá-los aqui mascararia o teste de concatenação/prefixo.
    const nomesPessoas = [
      `Titular Relatório Teste ${Date.now()}`,
      `Cotitular Relatório Teste ${Date.now()}`,
      `Mariana Relatório Teste ${Date.now()}`,
      `Bruno Relatório Teste ${Date.now()}`,
    ];
    const pessoas = await Promise.all(
      nomesPessoas.map((nome) =>
        pool.query<{ id: string }>(
          `INSERT INTO pessoas (nome, tipo_pessoa, atualizado_em) VALUES ($1, 'FISICA', now()) RETURNING id`,
          [nome]
        )
      )
    );
    const [titularId, cotitularId, arquitetoId, engenheiroId] = pessoas.map((r) => r.rows[0].id);
    pessoaIds.push(titularId, cotitularId, arquitetoId, engenheiroId);
    await pool.query(
      `INSERT INTO lote_pessoa (lote_id, pessoa_id, papel) VALUES ($1, $2, 'TITULAR'), ($1, $3, 'COTITULAR')`,
      [lotePessoasId, titularId, cotitularId]
    );
    const obraPessoas = await pool.query<{ id: string }>(
      `INSERT INTO obras (lote_id, atualizado_em) VALUES ($1, now()) RETURNING id`,
      [lotePessoasId]
    );
    await pool.query(
      `INSERT INTO pessoa_dados_profissionais (pessoa_id, tipo) VALUES ($1, 'ARQUITETO'), ($2, 'ENGENHEIRO')`,
      [arquitetoId, engenheiroId]
    );
    await pool.query(
      `INSERT INTO obra_pessoa (obra_id, pessoa_id, papel) VALUES ($1, $2, 'RESPONSAVEL_TECNICO'), ($1, $3, 'RESPONSAVEL_TECNICO')`,
      [obraPessoas.rows[0].id, arquitetoId, engenheiroId]
    );

    // Lote 3 (usa apoio) + Lote 4 (é o apoio).
    const loteApoioOrigem = await pool.query<{ id: string }>(
      `INSERT INTO lotes (quadra_id, numero, atualizado_em) VALUES ($1, 3, now()) RETURNING id`,
      [quadraPrincipalId]
    );
    loteApoioOrigemId = loteApoioOrigem.rows[0].id;
    const loteApoioAlvo = await pool.query<{ id: string }>(
      `INSERT INTO lotes (quadra_id, numero, atualizado_em) VALUES ($1, 4, now()) RETURNING id`,
      [quadraPrincipalId]
    );
    loteApoioAlvoId = loteApoioAlvo.rows[0].id;
    await pool.query(`INSERT INTO lote_apoio (lote_em_obra_id, lote_apoio_id) VALUES ($1, $2)`, [
      loteApoioOrigemId,
      loteApoioAlvoId,
    ]);

    // Lote 5: totalmente vazio (sem obra, pessoa ou apoio) -> todas as colunas opcionais em branco.
    const loteVazio = await pool.query<{ id: string }>(
      `INSERT INTO lotes (quadra_id, numero, atualizado_em) VALUES ($1, 5, now()) RETURNING id`,
      [quadraPrincipalId]
    );
    loteVazioId = loteVazio.rows[0].id;

    // Lote na quadra secundária, para validar o filtro quadraCodigo.
    const loteOutraQuadra = await pool.query<{ id: string }>(
      `INSERT INTO lotes (quadra_id, numero, atualizado_em) VALUES ($1, 1, now()) RETURNING id`,
      [quadraSecundaria.rows[0].id]
    );
    loteOutraQuadraId = loteOutraQuadra.rows[0].id;

    loteIds.push(
      loteAlertaId,
      lotePessoasId,
      loteApoioOrigemId,
      loteApoioAlvoId,
      loteVazioId,
      loteOutraQuadraId
    );
  });

  afterAll(async () => {
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
    await pool.query(`DELETE FROM lote_pessoa WHERE lote_id = ANY($1::uuid[])`, [loteIds]);
    await pool.query(`DELETE FROM pessoa_dados_profissionais WHERE pessoa_id = ANY($1::uuid[])`, [pessoaIds]);
    await pool.query(`DELETE FROM obras WHERE lote_id = ANY($1::uuid[])`, [loteIds]);
    await pool.query(`DELETE FROM lotes WHERE id = ANY($1::uuid[])`, [loteIds]);
    await pool.query(`DELETE FROM pessoas WHERE id = ANY($1::uuid[])`, [pessoaIds]);
    await pool.query(`DELETE FROM quadras WHERE condominio_id = $1`, [condominioId]);
    await pool.query(`DELETE FROM condominios WHERE id = $1`, [condominioId]);
    await app.close();
  });

  async function gerarEParsear(url: string, token: string) {
    const res = await app.inject({ method: "GET", url, headers: authHeader(token) });
    if (res.statusCode !== 200) return { res, workbook: null as ExcelJS.Workbook | null };
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.rawPayload);
    return { res, workbook };
  }

  it("gera o .xlsx com content-type, content-disposition e cabeçalho corretos", async () => {
    const { res, workbook } = await gerarEParsear(`/relatorios/planilha-obras?condominioId=${condominioId}`, tokenAdmin);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers["content-disposition"]).toContain("attachment; filename=");
    expect(res.headers["content-disposition"]).toContain("relatorio-obras-teste-relatorio-");

    const aba = workbook!.getWorksheet("CONTROLE DE OBRAS E PROJETOS");
    expect(aba).toBeDefined();
    const cabecalho = CABECALHOS_ESPERADOS.map((_, idx) => aba!.getRow(3).getCell(idx + 1).value);
    expect(cabecalho).toEqual(CABECALHOS_ESPERADOS);
  });

  it("prioriza 'LOTE EM ALERTA' mesmo com MORADOR e status de obra simultâneos", async () => {
    const { workbook } = await gerarEParsear(`/relatorios/planilha-obras?condominioId=${condominioId}`, tokenAdmin);
    const aba = workbook!.getWorksheet("CONTROLE DE OBRAS E PROJETOS")!;
    const linha = aba.getRow(4); // RP/1, primeira linha de dados

    expect(linha.getCell(1).value).toBe("RP");
    expect(linha.getCell(2).value).toBe(1);
    expect(linha.getCell(3).value).toBe(300);
    expect(linha.getCell(4).value).toBe("Rua Teste, 10");
    expect(linha.getCell(7).value).toBe("LOTE EM ALERTA");
    expect(linha.getCell(11).value).toBe("SIM");
    expect(linha.getCell(13).value).toBe("Observação de teste");
    expect(linha.getCell(9).value).toBeInstanceOf(Date);
  });

  it("concatena proprietários (titular antes de cotitular) e responsáveis técnicos com prefixo Arq./Eng.", async () => {
    const { workbook } = await gerarEParsear(`/relatorios/planilha-obras?condominioId=${condominioId}`, tokenAdmin);
    const aba = workbook!.getWorksheet("CONTROLE DE OBRAS E PROJETOS")!;
    const linha = aba.getRow(5); // RP/2

    const proprietario = String(linha.getCell(5).value);
    expect(proprietario).toMatch(/^Titular Relatório Teste \d+ \/ Cotitular Relatório Teste \d+$/);

    const responsavel = String(linha.getCell(6).value);
    expect(responsavel).toMatch(/^Arq\. Mariana Relatório Teste \d+ \/ Eng\. Bruno Relatório Teste \d+$/);
    expect(linha.getCell(11).value).toBe("NÃO"); // obra criada sem liberado_para_mudanca -> default false
  });

  it("formata o lote de apoio como QUADRA/LOTE", async () => {
    const { workbook } = await gerarEParsear(`/relatorios/planilha-obras?condominioId=${condominioId}`, tokenAdmin);
    const aba = workbook!.getWorksheet("CONTROLE DE OBRAS E PROJETOS")!;
    const linha = aba.getRow(6); // RP/3, usa apoio de RP/4
    expect(linha.getCell(8).value).toBe("RP/4");
  });

  it("lote sem obra, pessoa ou apoio sai com todas as colunas opcionais em branco", async () => {
    const { workbook } = await gerarEParsear(`/relatorios/planilha-obras?condominioId=${condominioId}`, tokenAdmin);
    const aba = workbook!.getWorksheet("CONTROLE DE OBRAS E PROJETOS")!;
    const linha = aba.getRow(8); // RP/5

    expect(linha.getCell(1).value).toBe("RP");
    expect(linha.getCell(2).value).toBe(5);
    expect(linha.getCell(3).value).toBeNull();
    expect(linha.getCell(4).value).toBeNull();
    expect(linha.getCell(5).value).toBeNull();
    expect(linha.getCell(6).value).toBeNull();
    expect(linha.getCell(7).value).toBeNull();
    expect(linha.getCell(8).value).toBeNull();
    expect(linha.getCell(11).value).toBeNull(); // sem obra -> vazio, não "NÃO"
    expect(linha.getCell(13).value).toBeNull();
  });

  it("filtra por quadraCodigo e devolve só as linhas daquela quadra", async () => {
    const { workbook } = await gerarEParsear(
      `/relatorios/planilha-obras?condominioId=${condominioId}&quadraCodigo=RP`,
      tokenAdmin
    );
    const aba = workbook!.getWorksheet("CONTROLE DE OBRAS E PROJETOS")!;
    expect(aba.getRow(9).getCell(1).value).toBeNull(); // só 5 linhas de dados (linhas 4-8), nada na 9

    const { workbook: workbookCompleto } = await gerarEParsear(
      `/relatorios/planilha-obras?condominioId=${condominioId}`,
      tokenAdmin
    );
    const abaCompleta = workbookCompleto!.getWorksheet("CONTROLE DE OBRAS E PROJETOS")!;
    expect(abaCompleta.getRow(9).getCell(1).value).toBe("RQ"); // sem filtro, a quadra RQ aparece
  });

  it("400 quando condominioId está ausente", async () => {
    const res = await app.inject({ method: "GET", url: "/relatorios/planilha-obras", headers: authHeader(tokenAdmin) });
    expect(res.statusCode).toBe(400);
  });

  it("404 quando condominioId não existe", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/relatorios/planilha-obras?condominioId=00000000-0000-0000-0000-000000000000",
      headers: authHeader(tokenAdmin),
    });
    expect(res.statusCode).toBe(404);
  });

  it("403 para CONSULTA", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/relatorios/planilha-obras?condominioId=${condominioId}`,
      headers: authHeader(tokenConsulta),
    });
    expect(res.statusCode).toBe(403);
  });

  it("401 sem token", async () => {
    const res = await app.inject({ method: "GET", url: `/relatorios/planilha-obras?condominioId=${condominioId}` });
    expect(res.statusCode).toBe(401);
  });
});
