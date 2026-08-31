/**
 * Seed inicial do banco — Fase 5.
 *
 * Usa o driver `pg` cru em vez de `@prisma/client` porque este ambiente de
 * build não tem acesso de rede a binaries.prisma.sh (ver DOMAIN_MODEL.md,
 * seção "Nota sobre geração do Prisma Client neste ambiente"). Assim que
 * `prisma generate` puder ser executado normalmente, este arquivo pode ser
 * reescrito para usar o client gerado — a lógica de dados abaixo não muda.
 *
 * O seed é idempotente: pode ser rodado várias vezes sem duplicar registros
 * (usa upsert manual via ON CONFLICT).
 */
import { Client } from "pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

// ------------------------------------------------------------------
// Catálogo canônico de STATUS DE OBRA + mapeamento das grafias legadas
// encontradas na coluna STATUS da planilha "CONTROLE E GESTÃO - OBRAS E
// PROJETOS". Ver REVISAO_MODELO_DOMINIO.md, seção 5, para a análise completa
// de por que cada grafia foi classificada como pertencendo à Obra (e não ao
// Lote) e por que MORADOR e LOTE EM ALERTA ficaram de fora deste catálogo
// (viram OcupacaoLote e Lote.emAlerta respectivamente, não StatusObra).
// ------------------------------------------------------------------
const STATUS_OBRA = [
  { codigo: "EM_ANALISE", descricao: "Projeto em análise", ordem: 10 },
  {
    codigo: "LIBERADA_PARCIAL_MURO_TERRAPLANAGEM",
    descricao: "Liberada parcialmente (muro/terraplenagem)",
    ordem: 20,
  },
  { codigo: "LIBERADA", descricao: "Obra liberada", ordem: 30 },
  {
    codigo: "LIBERADA_NAO_INICIADA",
    descricao: "Obra liberada, sem início de execução",
    ordem: 40,
  },
  { codigo: "PARALISADA", descricao: "Obra paralisada", ordem: 50 },
  { codigo: "FINALIZADA", descricao: "Obra finalizada", ordem: 60 },
  { codigo: "FINALIZADA_VISTORIADA", descricao: "Obra finalizada — vistoriada", ordem: 70 },
  { codigo: "REFORMA_EM_ANDAMENTO", descricao: "Reforma em andamento", ordem: 80 },
] as const;

// valor_origem (texto exato da coluna STATUS na planilha) -> codigo canônico
// de StatusObra. MORADOR e "LOTE EM ALERTA" propositalmente NÃO aparecem
// aqui — são tratados por campos próprios (OcupacaoLote / Lote.emAlerta),
// não por este catálogo. Ver REVISAO_MODELO_DOMINIO.md seção 5.5.
const STATUS_OBRA_LEGACY_MAP: Array<[string, string]> = [
  ["EM ANÁLISE", "EM_ANALISE"],
  ["EM ANALISE", "EM_ANALISE"],
  ["LIBERADO MURO E TERRAPLANAGEM", "LIBERADA_PARCIAL_MURO_TERRAPLANAGEM"],
  ["OBRA LIBERADA", "LIBERADA"],
  ["OBRA LIBERADA ", "LIBERADA"],
  ["OBRA LIBERADA NÃO INICIADA", "LIBERADA_NAO_INICIADA"],
  ["OBRA LIBERADA E  NÃO INICIADA", "LIBERADA_NAO_INICIADA"],
  ["OBRA PARALISADA", "PARALISADA"],
  ["OBRA FINALIZADA", "FINALIZADA"],
  ["OBRA FINALIZADA VISTORIA OK", "FINALIZADA_VISTORIADA"],
  ["CASA EM REFORMA", "REFORMA_EM_ANDAMENTO"],
];

// ------------------------------------------------------------------
// Quadras reais confirmadas na planilha (C2 e O2 ficam de fora — não têm
// nenhum lote real cadastrado; ver documento de análise de dados original).
// ------------------------------------------------------------------
const QUADRAS = [
  "A2", "B2", "D2", "E2", "F2", "G2", "H2", "I2", "J2", "K2",
  "L2", "M2", "N2", "P2", "Q2", "R2", "S2", "T2", "U2", "V2",
];

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("BEGIN");

    // Condomínio
    const condRes = await client.query(
      `INSERT INTO condominios (nome, atualizado_em)
       VALUES ($1, now())
       ON CONFLICT (nome) DO UPDATE SET atualizado_em = now()
       RETURNING id`,
      ["Rudá"]
    );
    const condominioId = condRes.rows[0].id;
    console.log(`Condomínio "Rudá" ok (${condominioId})`);

    // Quadras
    for (const codigo of QUADRAS) {
      await client.query(
        `INSERT INTO quadras (condominio_id, codigo, atualizado_em)
         VALUES ($1, $2, now())
         ON CONFLICT (condominio_id, codigo) DO NOTHING`,
        [condominioId, codigo]
      );
    }
    console.log(`${QUADRAS.length} quadras ok`);

    // Status de obra
    const statusObraIds = new Map<string, string>();
    for (const s of STATUS_OBRA) {
      const r = await client.query(
        `INSERT INTO status_obra (codigo, descricao, ordem_exibicao)
         VALUES ($1, $2, $3)
         ON CONFLICT (codigo) DO UPDATE SET descricao = EXCLUDED.descricao
         RETURNING id`,
        [s.codigo, s.descricao, s.ordem]
      );
      statusObraIds.set(s.codigo, r.rows[0].id);
    }
    console.log(`${STATUS_OBRA.length} status de obra ok`);

    // Mapeamento legado de status de obra
    for (const [valorOrigem, codigoCanonico] of STATUS_OBRA_LEGACY_MAP) {
      const statusId = statusObraIds.get(codigoCanonico);
      if (!statusId) throw new Error(`Status canônico não encontrado: ${codigoCanonico}`);
      await client.query(
        `INSERT INTO status_obra_legacy_map (valor_origem, status_canonico_id)
         VALUES ($1, $2)
         ON CONFLICT (valor_origem) DO UPDATE SET status_canonico_id = EXCLUDED.status_canonico_id`,
        [valorOrigem, statusId]
      );
    }
    console.log(`${STATUS_OBRA_LEGACY_MAP.length} mapeamentos legados de status de obra ok`);

    // Usuários iniciais (um por papel, para viabilizar testes de permissão)
    const senhaPadrao = process.env.SEED_ADMIN_PASSWORD ?? "TrocarEssaSenha!123";
    const senhaHash = await bcrypt.hash(senhaPadrao, 10);

    const usuariosSeed = [
      { nome: "Administrador", email: "admin@ruda.local", role: "ADMIN" },
      { nome: "Analista", email: "analista@ruda.local", role: "ANALISTA" },
      { nome: "Consulta", email: "consulta@ruda.local", role: "CONSULTA" },
    ];
    for (const u of usuariosSeed) {
      await client.query(
        `INSERT INTO usuarios (nome, email, senha_hash, role, atualizado_em)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (email) DO NOTHING`,
        [u.nome, u.email, senhaHash, u.role]
      );
    }
    console.log(
      `${usuariosSeed.length} usuários iniciais ok (senha padrão via SEED_ADMIN_PASSWORD — troque antes de produção)`
    );

    await client.query("COMMIT");
    console.log("Seed concluído com sucesso.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Seed falhou:", err);
  process.exit(1);
});
