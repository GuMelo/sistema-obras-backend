/**
 * Estágios "Domain -> Persistence".
 *
 * Único módulo que executa SQL. Estratégia de idempotência:
 *   - Lote: chave natural (quadraId, numero) — upsert direto.
 *   - Obra: sem chave natural na planilha (ela só descreve UMA obra "atual"
 *     por linha). Convenção adotada: cada Lote tem no máximo uma Obra
 *     "principal" (tipo != REFORMA) mantida pela importação, e no máximo uma
 *     Obra de reforma (tipo = REFORMA) — reimportar a mesma planilha atualiza
 *     essas mesmas linhas, nunca cria duplicata.
 *   - Pessoa: sem CPF/CNPJ na origem. Dedup por nome normalizado
 *     (trim + colapso de espaços + case-insensitive). Se mais de uma Pessoa
 *     já cadastrada bater no mesmo nome normalizado, NÃO faz merge — gera
 *     um AVISO de conflito e não vincula automaticamente.
 *   - LoteOcupacaoHistorico / ObraStatusHistorico: só abre um novo registro
 *     vigente quando o valor realmente muda (reimportar sem mudança = no-op).
 *
 * Dry-run: todo o processamento roda dentro de uma transação normal: ao
 * final, se dryRun=true, a transação é OBRIGATORIAMENTE revertida (ROLLBACK)
 * independentemente do resultado — garantia real de banco, não apenas uma
 * flag que "esquece" de gravar. Nenhum registro de ImportacaoExecucao é
 * criado em dry-run (criar esse registro já seria, em si, uma alteração
 * persistida).
 */
import type { Pool, PoolClient } from "pg";
import type {
  CatalogoStatusObra,
  MappedLoteRow,
  ProblemaImportacao,
  RelatorioLinha,
  ResultadoLinha,
} from "./types.js";

export async function carregarCatalogoStatusObra(client: PoolClient): Promise<CatalogoStatusObra> {
  const res = await client.query<{ valor_origem: string; codigo: string }>(
    `SELECT m.valor_origem, s.codigo
     FROM status_obra_legacy_map m
     JOIN status_obra s ON s.id = m.status_canonico_id`
  );
  const porValorOrigem = new Map<string, string>();
  for (const row of res.rows) {
    porValorOrigem.set(row.valor_origem, row.codigo);
  }
  return { porValorOrigem };
}

function normalizarNomePessoa(nome: string): string {
  return nome.trim().toUpperCase().replace(/\s+/g, " ");
}

function sugerirTipoPessoa(nome: string): "FISICA" | "JURIDICA" {
  return /\b(LTDA|S\/?A|EIRELI|\bME\b|CONSTRUTORA|ENGENHARIA)\b/i.test(nome) ? "JURIDICA" : "FISICA";
}

/** Encontra ou cria uma Pessoa por nome normalizado. Nunca faz merge quando
 * há mais de uma correspondência — nesse caso devolve `ambiguo: true` e não
 * cria vínculo nenhum, cabendo revisão humana decidir qual Pessoa é a certa. */
async function encontrarOuCriarPessoa(
  client: PoolClient,
  nome: string
): Promise<{ pessoaId: string | null; ambiguo: boolean }> {
  const normalizado = normalizarNomePessoa(nome);
  const existentes = await client.query<{ id: string }>(
    `SELECT id FROM pessoas WHERE upper(regexp_replace(trim(nome), '\\s+', ' ', 'g')) = $1`,
    [normalizado]
  );

  if (existentes.rowCount === 1) {
    return { pessoaId: existentes.rows[0].id, ambiguo: false };
  }
  if (existentes.rowCount && existentes.rowCount > 1) {
    return { pessoaId: null, ambiguo: true };
  }

  const tipoPessoa = sugerirTipoPessoa(nome);
  const inserido = await client.query<{ id: string }>(
    `INSERT INTO pessoas (nome, tipo_pessoa, atualizado_em) VALUES ($1, $2, now()) RETURNING id`,
    [nome.trim(), tipoPessoa]
  );
  return { pessoaId: inserido.rows[0].id, ambiguo: false };
}

async function garantirQuadra(
  client: PoolClient,
  condominioId: string,
  codigo: string
): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO quadras (condominio_id, codigo, atualizado_em)
     VALUES ($1, $2, now())
     ON CONFLICT (condominio_id, codigo) DO UPDATE SET atualizado_em = quadras.atualizado_em
     RETURNING id`,
    [condominioId, codigo]
  );
  return res.rows[0].id;
}

interface EstadoLote {
  id: string;
  areaM2: string | null;
  endereco: string | null;
  emAlerta: boolean;
}

async function processarLinha(
  client: PoolClient,
  condominioId: string,
  usuarioId: string | null,
  linha: MappedLoteRow
): Promise<RelatorioLinha> {
  const problemas: ProblemaImportacao[] = [...linha.problemas];
  let resultado: ResultadoLinha = "SEM_ALTERACAO";
  const marcarAlterado = () => {
    if (resultado === "SEM_ALTERACAO") resultado = "ATUALIZADO";
  };

  const quadraId = await garantirQuadra(client, condominioId, linha.quadraCodigo);

  const loteExistente = await client.query<EstadoLote>(
    `SELECT id, area_m2::text AS "areaM2", endereco_logradouro AS endereco, em_alerta AS "emAlerta"
     FROM lotes WHERE quadra_id = $1 AND numero = $2`,
    [quadraId, linha.loteNumero]
  );

  const observacaoLegadoPartes: string[] = [];
  if (linha.proprietarioNaoSeparado) {
    observacaoLegadoPartes.push(`Proprietário (origem): ${linha.proprietarioNaoSeparado}`);
  }
  if (linha.responsavelTecnicoNaoSeparado) {
    observacaoLegadoPartes.push(`Responsável técnico (origem): ${linha.responsavelTecnicoNaoSeparado}`);
  }
  if (linha.statusMapeado.tipo === "DESCONHECIDO") {
    observacaoLegadoPartes.push(`Status não mapeado (origem): ${linha.statusBruto}`);
  }
  if (linha.loteApoioNaoResolvidos.length > 0) {
    observacaoLegadoPartes.push(
      `Lote(s) de apoio não reconhecidos (origem): ${linha.loteApoioNaoResolvidos.join(", ")}`
    );
  }
  const observacaoLegado = observacaoLegadoPartes.length > 0 ? observacaoLegadoPartes.join(" | ") : null;

  let loteId: string;
  if (loteExistente.rowCount === 0) {
    const inserido = await client.query<{ id: string }>(
      `INSERT INTO lotes (quadra_id, numero, area_m2, endereco_logradouro, observacao_legado, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING id`,
      [quadraId, linha.loteNumero, linha.m2, linha.endereco, observacaoLegado]
    );
    loteId = inserido.rows[0].id;
    resultado = "NOVO";
  } else {
    loteId = loteExistente.rows[0].id;
    const atual = loteExistente.rows[0];
    const areaMudou = linha.m2 !== null && Number(atual.areaM2) !== linha.m2;
    const enderecoMudou = linha.endereco !== null && atual.endereco !== linha.endereco;
    if (areaMudou || enderecoMudou || observacaoLegado) {
      await client.query(
        `UPDATE lotes SET
           area_m2 = COALESCE($2, area_m2),
           endereco_logradouro = COALESCE($3, endereco_logradouro),
           observacao_legado = COALESCE($4, observacao_legado),
           atualizado_em = now()
         WHERE id = $1`,
        [loteId, linha.m2, linha.endereco, observacaoLegado]
      );
      if (areaMudou || enderecoMudou) marcarAlterado();
    }
  }

  // Observações em texto corrido -> Anotação legada (não descartadas, não
  // fragmentadas em eventos — ver DOMAIN_MODEL.md).
  if (linha.observacoesBruto) {
    const jaExiste = await client.query(
      `SELECT 1 FROM anotacoes WHERE lote_id = $1 AND origem = 'IMPORTACAO_LEGADO' AND texto = $2`,
      [loteId, linha.observacoesBruto]
    );
    if (jaExiste.rowCount === 0) {
      await client.query(
        `INSERT INTO anotacoes (lote_id, data, texto, origem) VALUES ($1, now(), $2, 'IMPORTACAO_LEGADO')`,
        [loteId, linha.observacoesBruto]
      );
      marcarAlterado();
    }
  }

  // ------------------------------------------------------------------
  // Ocupação do lote
  // ------------------------------------------------------------------
  if (linha.statusMapeado.tipo === "OCUPACAO_MORADOR") {
    const vigente = await client.query<{ ocupacao: string }>(
      `SELECT ocupacao FROM lote_ocupacao_historico WHERE lote_id = $1 AND data_fim IS NULL`,
      [loteId]
    );
    if (vigente.rowCount === 0 || vigente.rows[0].ocupacao !== "MORADOR") {
      await client.query(
        `UPDATE lote_ocupacao_historico SET data_fim = now() WHERE lote_id = $1 AND data_fim IS NULL`,
        [loteId]
      );
      await client.query(
        `INSERT INTO lote_ocupacao_historico (lote_id, ocupacao, data_inicio, usuario_id, observacao)
         VALUES ($1, 'MORADOR', now(), $2, 'Importação da planilha')`,
        [loteId, usuarioId]
      );
      marcarAlterado();
    }
  }

  // ------------------------------------------------------------------
  // Alerta do lote (flag independente)
  // ------------------------------------------------------------------
  if (linha.statusMapeado.tipo === "ALERTA") {
    const jaEmAlerta = loteExistente.rowCount ? loteExistente.rows[0].emAlerta : false;
    if (!jaEmAlerta) {
      await client.query(`UPDATE lotes SET em_alerta = true, atualizado_em = now() WHERE id = $1`, [
        loteId,
      ]);
      await client.query(
        `INSERT INTO audit_logs (entidade, entidade_id, acao, campo_alterado, valor_anterior, valor_novo, usuario_id, observacao)
         VALUES ('Lote', $1, 'UPDATE', 'emAlerta', 'false', 'true', $2, 'Importação da planilha')`,
        [loteId, usuarioId]
      );
      marcarAlterado();
    }
  }

  // ------------------------------------------------------------------
  // Obra (principal ou reforma, conforme o status mapeado)
  // ------------------------------------------------------------------
  const precisaObra =
    linha.statusMapeado.tipo === "OBRA_STATUS" ||
    linha.responsaveisTecnicos.length > 0 ||
    linha.dataLiberacaoObra !== null ||
    linha.vistoriaPosObra !== null ||
    linha.dataMudanca !== null ||
    linha.liberadoParaMudanca;

  let obraId: string | null = null;
  if (precisaObra) {
    const tipoObraAlvo = linha.statusMapeado.statusObraCodigo === "REFORMA_EM_ANDAMENTO" ? "REFORMA" : null;

    const obraExistente = tipoObraAlvo
      ? await client.query<{ id: string }>(`SELECT id FROM obras WHERE lote_id = $1 AND tipo = 'REFORMA'`, [
          loteId,
        ])
      : await client.query<{ id: string }>(
          `SELECT id FROM obras WHERE lote_id = $1 AND (tipo IS DISTINCT FROM 'REFORMA')`,
          [loteId]
        );

    if (obraExistente.rowCount && obraExistente.rowCount > 0) {
      obraId = obraExistente.rows[0].id;
      const antes = await client.query<{
        tipo: string | null;
        data_liberacao: string | null;
        data_vistoria_pos_obra: string | null;
        liberado_para_mudanca: boolean;
        data_mudanca: string | null;
      }>(
        `SELECT tipo, data_liberacao::text, data_vistoria_pos_obra::text, liberado_para_mudanca, data_mudanca::text
         FROM obras WHERE id = $1`,
        [obraId]
      );
      await client.query(
        `UPDATE obras SET
           tipo = COALESCE(tipo, $2),
           data_liberacao = COALESCE($3, data_liberacao),
           data_vistoria_pos_obra = COALESCE($4, data_vistoria_pos_obra),
           liberado_para_mudanca = liberado_para_mudanca OR $5,
           data_mudanca = COALESCE($6, data_mudanca),
           atualizado_em = now()
         WHERE id = $1`,
        [
          obraId,
          tipoObraAlvo ?? "CONSTRUCAO_INICIAL",
          linha.dataLiberacaoObra,
          linha.vistoriaPosObra,
          linha.liberadoParaMudanca,
          linha.dataMudanca,
        ]
      );
      const depois = await client.query<{
        tipo: string | null;
        data_liberacao: string | null;
        data_vistoria_pos_obra: string | null;
        liberado_para_mudanca: boolean;
        data_mudanca: string | null;
      }>(
        `SELECT tipo, data_liberacao::text, data_vistoria_pos_obra::text, liberado_para_mudanca, data_mudanca::text
         FROM obras WHERE id = $1`,
        [obraId]
      );
      const a = antes.rows[0];
      const d = depois.rows[0];
      if (
        a.tipo !== d.tipo ||
        a.data_liberacao !== d.data_liberacao ||
        a.data_vistoria_pos_obra !== d.data_vistoria_pos_obra ||
        a.liberado_para_mudanca !== d.liberado_para_mudanca ||
        a.data_mudanca !== d.data_mudanca
      ) {
        marcarAlterado();
      }
    } else {
      const inserida = await client.query<{ id: string }>(
        `INSERT INTO obras (lote_id, tipo, data_liberacao, data_vistoria_pos_obra, liberado_para_mudanca, data_mudanca, atualizado_em)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         RETURNING id`,
        [
          loteId,
          tipoObraAlvo,
          linha.dataLiberacaoObra,
          linha.vistoriaPosObra,
          linha.liberadoParaMudanca,
          linha.dataMudanca,
        ]
      );
      obraId = inserida.rows[0].id;
      marcarAlterado();
    }

    if (linha.statusMapeado.tipo === "OBRA_STATUS" && linha.statusMapeado.statusObraCodigo) {
      const statusRow = await client.query<{ id: string }>(
        `SELECT id FROM status_obra WHERE codigo = $1`,
        [linha.statusMapeado.statusObraCodigo]
      );
      const statusId = statusRow.rows[0]?.id;
      if (statusId) {
        const vigente = await client.query<{ status_id: string }>(
          `SELECT status_id FROM obra_status_historico WHERE obra_id = $1 AND data_fim IS NULL`,
          [obraId]
        );
        if (vigente.rowCount === 0 || vigente.rows[0].status_id !== statusId) {
          // Heurística de data: usa a data de liberação/vistoria quando o
          // status corresponde a essas fases; caso contrário, a data da
          // importação. Ver DOMAIN_MODEL.md — é a melhor aproximação
          // possível, já que a planilha não guarda "data da mudança de
          // status" separadamente.
          const dataInicio =
            (linha.statusMapeado.statusObraCodigo.startsWith("LIBERADA") && linha.dataLiberacaoObra) ||
            (linha.statusMapeado.statusObraCodigo.startsWith("FINALIZADA") && linha.vistoriaPosObra) ||
            new Date();

          await client.query(
            `UPDATE obra_status_historico SET data_fim = now() WHERE obra_id = $1 AND data_fim IS NULL`,
            [obraId]
          );
          await client.query(
            `INSERT INTO obra_status_historico (obra_id, status_id, data_inicio, usuario_id, observacao)
             VALUES ($1, $2, $3, $4, 'Importação da planilha')`,
            [obraId, statusId, dataInicio, usuarioId]
          );
          marcarAlterado();
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Pessoas — proprietários (titularidade do Lote)
  // ------------------------------------------------------------------
  for (const proprietario of linha.proprietarios) {
    const { pessoaId, ambiguo } = await encontrarOuCriarPessoa(client, proprietario.nome);
    if (ambiguo) {
      problemas.push({
        severidade: "AVISO",
        codigo: "PESSOA_AMBIGUA",
        mensagem: `Mais de uma Pessoa já cadastrada corresponde ao nome "${proprietario.nome}". Vínculo de titularidade não criado automaticamente — revisar manualmente.`,
        linha: linha.linha,
        dadosOriginais: proprietario.nome,
      });
      continue;
    }
    if (!pessoaId) continue;

    const vinculoExistente = await client.query(
      `SELECT 1 FROM lote_pessoa WHERE lote_id = $1 AND pessoa_id = $2 AND papel = 'TITULAR'`,
      [loteId, pessoaId]
    );
    if (vinculoExistente.rowCount === 0) {
      await client.query(
        `INSERT INTO lote_pessoa (lote_id, pessoa_id, papel) VALUES ($1, $2, 'TITULAR')`,
        [loteId, pessoaId]
      );
      marcarAlterado();
    }
  }

  // ------------------------------------------------------------------
  // Pessoas — responsáveis técnicos (vínculo com a Obra, não com o Lote)
  // ------------------------------------------------------------------
  for (const responsavel of linha.responsaveisTecnicos) {
    const { pessoaId, ambiguo } = await encontrarOuCriarPessoa(client, responsavel.nome);
    if (ambiguo) {
      problemas.push({
        severidade: "AVISO",
        codigo: "PESSOA_AMBIGUA",
        mensagem: `Mais de uma Pessoa já cadastrada corresponde ao nome "${responsavel.nome}". Vínculo de responsabilidade técnica não criado automaticamente — revisar manualmente.`,
        linha: linha.linha,
        dadosOriginais: responsavel.nome,
      });
      continue;
    }
    if (!pessoaId || !obraId) continue;

    if (responsavel.tipoProfissionalSugerido) {
      await client.query(
        `INSERT INTO pessoa_dados_profissionais (pessoa_id, tipo)
         VALUES ($1, $2)
         ON CONFLICT (pessoa_id) DO UPDATE SET tipo = COALESCE(pessoa_dados_profissionais.tipo, EXCLUDED.tipo)`,
        [pessoaId, responsavel.tipoProfissionalSugerido]
      );
    }

    const vinculoExistente = await client.query(
      `SELECT 1 FROM obra_pessoa WHERE obra_id = $1 AND pessoa_id = $2 AND papel = 'RESPONSAVEL_TECNICO'`,
      [obraId, pessoaId]
    );
    if (vinculoExistente.rowCount === 0) {
      await client.query(
        `INSERT INTO obra_pessoa (obra_id, pessoa_id, papel) VALUES ($1, $2, 'RESPONSAVEL_TECNICO')`,
        [obraId, pessoaId]
      );
      marcarAlterado();
    }
  }

  return {
    linha: linha.linha,
    quadraCodigo: linha.quadraCodigo,
    loteNumero: linha.loteNumero,
    resultado,
    problemas,
  };
}

/** Segunda passagem: resolve LoteApoio depois que todos os lotes já existem
 * no banco (uma linha pode referenciar, como apoio, um lote que só é
 * processado depois dela no arquivo). */
async function processarLotesApoio(
  client: PoolClient,
  condominioId: string,
  linhas: MappedLoteRow[],
  relatorioPorLinha: Map<number, RelatorioLinha>
): Promise<void> {
  for (const linha of linhas) {
    if (linha.loteApoioResolvidos.length === 0) continue;

    const loteAtual = await client.query<{ id: string }>(
      `SELECT l.id FROM lotes l JOIN quadras q ON q.id = l.quadra_id
       WHERE q.condominio_id = $1 AND q.codigo = $2 AND l.numero = $3`,
      [condominioId, linha.quadraCodigo, linha.loteNumero]
    );
    if (loteAtual.rowCount === 0) continue;
    const loteEmObraId = loteAtual.rows[0].id;

    for (const ref of linha.loteApoioResolvidos) {
      const loteApoio = await client.query<{ id: string }>(
        `SELECT l.id FROM lotes l JOIN quadras q ON q.id = l.quadra_id
         WHERE q.condominio_id = $1 AND q.codigo = $2 AND l.numero = $3`,
        [condominioId, ref.quadraCodigo, ref.loteNumero]
      );

      const relatorioLinha = relatorioPorLinha.get(linha.linha);
      if (loteApoio.rowCount === 0) {
        relatorioLinha?.problemas.push({
          severidade: "AVISO",
          codigo: "LOTE_APOIO_NAO_ENCONTRADO",
          mensagem: `Lote de apoio ${ref.quadraCodigo} ${ref.loteNumero} não existe na base — vínculo não criado.`,
          linha: linha.linha,
        });
        continue;
      }
      const loteApoioId = loteApoio.rows[0].id;
      if (loteApoioId === loteEmObraId) continue; // proteção extra — constraint do banco já cobre isso

      const existente = await client.query(
        `SELECT 1 FROM lote_apoio WHERE lote_em_obra_id = $1 AND lote_apoio_id = $2`,
        [loteEmObraId, loteApoioId]
      );
      if (existente.rowCount === 0) {
        await client.query(
          `INSERT INTO lote_apoio (lote_em_obra_id, lote_apoio_id, data_autorizacao, observacao)
           VALUES ($1, $2, $3, 'Importação da planilha')`,
          [loteEmObraId, loteApoioId, linha.dataLiberacaoObra]
        );
        if (relatorioLinha && relatorioLinha.resultado === "SEM_ALTERACAO") {
          relatorioLinha.resultado = "ATUALIZADO";
        }
      }
    }
  }
}

export interface ResultadoPersistencia {
  linhas: RelatorioLinha[];
}

export async function persistirLinhas(
  client: PoolClient,
  condominioId: string,
  usuarioId: string | null,
  linhasValidas: MappedLoteRow[],
  linhasInvalidas: RelatorioLinha[]
): Promise<ResultadoPersistencia> {
  const relatorioPorLinha = new Map<number, RelatorioLinha>();

  for (const linha of linhasValidas) {
    const relatorioLinha = await processarLinha(client, condominioId, usuarioId, linha);
    relatorioPorLinha.set(linha.linha, relatorioLinha);
  }

  await processarLotesApoio(client, condominioId, linhasValidas, relatorioPorLinha);

  const linhas = [...linhasInvalidas, ...relatorioPorLinha.values()].sort((a, b) => a.linha - b.linha);
  return { linhas };
}

export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await fn(client);
    await client.query("COMMIT");
    return resultado;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function withDryRunTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await fn(client);
    // Dry-run: SEMPRE reverte, mesmo que tudo tenha corrido bem — garantia
    // de banco, não uma flag de aplicação que poderia ser esquecida.
    await client.query("ROLLBACK");
    return resultado;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
