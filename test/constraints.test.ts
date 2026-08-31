import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import "dotenv/config";

describe("constraints do schema (Postgres real) — Fase 5", () => {
  let client: Client;
  let condominioId: string;
  let quadraId: string;
  let loteId: string;
  let obraId: string;
  let statusEmAnaliseId: string;
  let statusLiberadaId: string;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    const cond = await client.query(
      `INSERT INTO condominios (nome, atualizado_em) VALUES ($1, now()) RETURNING id`,
      [`Teste Vitest ${Date.now()}`]
    );
    condominioId = cond.rows[0].id;

    const quadra = await client.query(
      `INSERT INTO quadras (condominio_id, codigo, atualizado_em) VALUES ($1, 'ZT', now()) RETURNING id`,
      [condominioId]
    );
    quadraId = quadra.rows[0].id;

    const lote = await client.query(
      `INSERT INTO lotes (quadra_id, numero, atualizado_em) VALUES ($1, 1, now()) RETURNING id`,
      [quadraId]
    );
    loteId = lote.rows[0].id;

    const obra = await client.query(
      `INSERT INTO obras (lote_id, atualizado_em) VALUES ($1, now()) RETURNING id`,
      [loteId]
    );
    obraId = obra.rows[0].id;

    const statusEmAnalise = await client.query(
      `SELECT id FROM status_obra WHERE codigo = 'EM_ANALISE'`
    );
    statusEmAnaliseId = statusEmAnalise.rows[0].id;

    const statusLiberada = await client.query(`SELECT id FROM status_obra WHERE codigo = 'LIBERADA'`);
    statusLiberadaId = statusLiberada.rows[0].id;
  });

  afterAll(async () => {
    // FKs usam ON DELETE RESTRICT de propósito (ver DOMAIN_MODEL.md), então a
    // limpeza precisa respeitar a ordem: filhos antes dos pais.
    await client.query(`DELETE FROM obra_status_historico WHERE obra_id = $1`, [obraId]);
    await client.query(`DELETE FROM lote_ocupacao_historico WHERE lote_id = $1`, [loteId]);
    await client.query(`DELETE FROM obras WHERE id = $1`, [obraId]);
    await client.query(`DELETE FROM lotes WHERE id = $1`, [loteId]);
    await client.query(`DELETE FROM quadras WHERE id = $1`, [quadraId]);
    await client.query(`DELETE FROM condominios WHERE id = $1`, [condominioId]);
    await client.end();
  });

  it("impede um lote de ser apoio de si mesmo", async () => {
    await expect(
      client.query(
        `INSERT INTO lote_apoio (lote_em_obra_id, lote_apoio_id) VALUES ($1, $1)`,
        [loteId]
      )
    ).rejects.toThrow(/lote_apoio_nao_autoreferente_check/);
  });

  it("permite apenas um status de obra vigente (data_fim NULL) por obra", async () => {
    await client.query(
      `INSERT INTO obra_status_historico (obra_id, status_id, data_inicio) VALUES ($1, $2, now())`,
      [obraId, statusEmAnaliseId]
    );

    await expect(
      client.query(
        `INSERT INTO obra_status_historico (obra_id, status_id, data_inicio) VALUES ($1, $2, now())`,
        [obraId, statusLiberadaId]
      )
    ).rejects.toThrow(/obra_status_historico_vigente_uidx/);

    await client.query(`DELETE FROM obra_status_historico WHERE obra_id = $1`, [obraId]);
  });

  it("permite apenas uma ocupação vigente (data_fim NULL) por lote", async () => {
    await client.query(
      `INSERT INTO lote_ocupacao_historico (lote_id, ocupacao, data_inicio) VALUES ($1, 'DISPONIVEL', now())`,
      [loteId]
    );

    await expect(
      client.query(
        `INSERT INTO lote_ocupacao_historico (lote_id, ocupacao, data_inicio) VALUES ($1, 'MORADOR', now())`,
        [loteId]
      )
    ).rejects.toThrow(/lote_ocupacao_historico_vigente_uidx/);

    await client.query(`DELETE FROM lote_ocupacao_historico WHERE lote_id = $1`, [loteId]);
  });

  it("exige exatamente um pai (lote OU obra) em anotacoes", async () => {
    await expect(
      client.query(`INSERT INTO anotacoes (data, texto) VALUES (now(), 'sem pai nenhum')`)
    ).rejects.toThrow(/anotacoes_exatamente_um_pai_check/);

    await expect(
      client.query(
        `INSERT INTO anotacoes (lote_id, obra_id, data, texto) VALUES ($1, $2, now(), 'dois pais')`,
        [loteId, obraId]
      )
    ).rejects.toThrow(/anotacoes_exatamente_um_pai_check/);
  });

  it("exige exatamente um pai (lote OU obra) em documentos", async () => {
    await expect(
      client.query(
        `INSERT INTO documentos (tipo, nome_arquivo) VALUES ('PDF', 'sem-pai.pdf')`
      )
    ).rejects.toThrow(/documentos_exatamente_um_pai_check/);
  });

  it("rejeita quadra duplicada no mesmo condomínio", async () => {
    await expect(
      client.query(
        `INSERT INTO quadras (condominio_id, codigo, atualizado_em) VALUES ($1, 'ZT', now())`,
        [condominioId]
      )
    ).rejects.toThrow(/quadras_condominio_id_codigo_key/);
  });

  it("rejeita lote duplicado (mesma quadra + número)", async () => {
    await expect(
      client.query(
        `INSERT INTO lotes (quadra_id, numero, atualizado_em) VALUES ($1, 1, now())`,
        [quadraId]
      )
    ).rejects.toThrow(/lotes_quadra_id_numero_key/);
  });

  it("um lote pode ter mais de uma obra ao longo do tempo (1:N)", async () => {
    const segundaObra = await client.query(
      `INSERT INTO obras (lote_id, tipo, atualizado_em) VALUES ($1, 'REFORMA', now()) RETURNING id`,
      [loteId]
    );
    expect(segundaObra.rows[0].id).toBeDefined();

    const obrasDoLote = await client.query(`SELECT id FROM obras WHERE lote_id = $1`, [loteId]);
    expect(obrasDoLote.rowCount).toBe(2);

    await client.query(`DELETE FROM obras WHERE id = $1`, [segundaObra.rows[0].id]);
  });

  it("Pessoa unifica proprietário e responsável técnico sem duplicar cadastro", async () => {
    const pessoa = await client.query(
      `INSERT INTO pessoas (nome, tipo_pessoa, atualizado_em) VALUES ('Pessoa Teste', 'FISICA', now()) RETURNING id`
    );
    const pessoaId = pessoa.rows[0].id;

    // a mesma Pessoa pode ser titular de um lote...
    await client.query(
      `INSERT INTO lote_pessoa (lote_id, pessoa_id, papel) VALUES ($1, $2, 'TITULAR')`,
      [loteId, pessoaId]
    );
    // ...e responsável técnico de uma obra, sem precisar de outro cadastro
    await client.query(
      `INSERT INTO obra_pessoa (obra_id, pessoa_id, papel) VALUES ($1, $2, 'RESPONSAVEL_TECNICO')`,
      [obraId, pessoaId]
    );

    const vinculos = await client.query(
      `SELECT
         (SELECT count(*) FROM lote_pessoa WHERE pessoa_id = $1) AS titularidades,
         (SELECT count(*) FROM obra_pessoa WHERE pessoa_id = $1) AS responsabilidades`,
      [pessoaId]
    );
    expect(Number(vinculos.rows[0].titularidades)).toBe(1);
    expect(Number(vinculos.rows[0].responsabilidades)).toBe(1);

    await client.query(`DELETE FROM obra_pessoa WHERE pessoa_id = $1`, [pessoaId]);
    await client.query(`DELETE FROM lote_pessoa WHERE pessoa_id = $1`, [pessoaId]);
    await client.query(`DELETE FROM pessoas WHERE id = $1`, [pessoaId]);
  });
});
