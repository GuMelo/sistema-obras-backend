import type { Pool } from "pg";
import ExcelJS from "exceljs";
import { buscarCondominioPorId } from "../condominios/service.js";
import { removerPrefixoProfissional } from "../../lib/pessoa.js";

const NOME_ABA = "CONTROLE DE OBRAS E PROJETOS";
const CABECALHOS = [
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

interface LinhaBruta {
  quadra: string;
  lote: number;
  m2: number | null;
  enderecoLogradouro: string | null;
  enderecoNumero: string | null;
  proprietario: string | null;
  responsaveis: { nome: string; tipo: "ARQUITETO" | "ENGENHEIRO" | null }[] | null;
  emAlerta: boolean;
  ocupacao: "DISPONIVEL" | "MORADOR" | null;
  statusObraDescricao: string | null;
  obraId: string | null;
  dataLiberacaoObra: Date | null;
  vistoriaPosObra: Date | null;
  liberadoParaMudanca: boolean | null;
  dataMudanca: Date | null;
  loteApoio: string | null;
  observacoes: string | null;
}

export interface LinhaRelatorioObras {
  quadra: string;
  lote: number;
  m2: number | null;
  endereco: string;
  proprietario: string;
  responsavelTecnico: string;
  status: string;
  loteApoio: string;
  dataLiberacaoObra: Date | null;
  vistoriaPosObra: Date | null;
  liberadoParaMudanca: string;
  dataMudanca: Date | null;
  observacoes: string;
}

export interface FiltrosRelatorioObras {
  condominioId: string;
  quadraCodigo?: string;
}

function montarEndereco(logradouro: string | null, numero: string | null): string {
  if (logradouro && numero) return `${logradouro}, ${numero}`;
  return logradouro ?? numero ?? "";
}

function montarResponsavelTecnico(responsaveis: LinhaBruta["responsaveis"]): string {
  if (!responsaveis || responsaveis.length === 0) return "";
  return responsaveis
    .map((r) => {
      const prefixo = r.tipo === "ARQUITETO" ? "Arq. " : r.tipo === "ENGENHEIRO" ? "Eng. " : "";
      return `${prefixo}${removerPrefixoProfissional(r.nome)}`;
    })
    .join(" / ");
}

// Prioridade fixa entre 3 sinais que hoje podem coexistir (o legado só tinha
// 1 valor por vez nesta coluna): alerta é o mais acionável e por isso vence
// mesmo com morador ou obra em andamento; morador é um estado "terminal" que
// supera qualquer status intermediário de obra.
function montarStatus(linha: LinhaBruta): string {
  if (linha.emAlerta) return "LOTE EM ALERTA";
  if (linha.ocupacao === "MORADOR") return "MORADOR";
  return linha.statusObraDescricao ?? "";
}

function montarLiberadoParaMudanca(linha: LinhaBruta): string {
  if (!linha.obraId) return "";
  return linha.liberadoParaMudanca ? "SIM" : "NÃO";
}

function converterLinha(linha: LinhaBruta): LinhaRelatorioObras {
  return {
    quadra: linha.quadra,
    lote: linha.lote,
    m2: linha.m2,
    endereco: montarEndereco(linha.enderecoLogradouro, linha.enderecoNumero),
    proprietario: linha.proprietario ?? "",
    responsavelTecnico: montarResponsavelTecnico(linha.responsaveis),
    status: montarStatus(linha),
    loteApoio: linha.loteApoio ?? "",
    dataLiberacaoObra: linha.dataLiberacaoObra,
    vistoriaPosObra: linha.vistoriaPosObra,
    liberadoParaMudanca: montarLiberadoParaMudanca(linha),
    dataMudanca: linha.dataMudanca,
    observacoes: linha.observacoes ?? "",
  };
}

export async function buscarLinhasRelatorioObras(
  pool: Pool,
  filtros: FiltrosRelatorioObras
): Promise<LinhaRelatorioObras[]> {
  const params: unknown[] = [filtros.condominioId];
  let filtroQuadra = "";
  if (filtros.quadraCodigo) {
    params.push(filtros.quadraCodigo);
    filtroQuadra = `AND q.codigo = $${params.length}`;
  }

  const res = await pool.query<LinhaBruta>(
    `SELECT
       q.codigo AS quadra,
       l.numero AS lote,
       l.area_m2::float AS m2,
       l.endereco_logradouro AS "enderecoLogradouro",
       l.endereco_numero AS "enderecoNumero",
       (SELECT string_agg(p.nome, ' / ' ORDER BY (lp.papel = 'COTITULAR'), p.nome)
          FROM lote_pessoa lp JOIN pessoas p ON p.id = lp.pessoa_id
          WHERE lp.lote_id = l.id) AS proprietario,
       (SELECT json_agg(json_build_object('nome', p.nome, 'tipo', pdp.tipo) ORDER BY pdp.tipo NULLS LAST, p.nome)
          FROM obra_pessoa op JOIN pessoas p ON p.id = op.pessoa_id
          LEFT JOIN pessoa_dados_profissionais pdp ON pdp.pessoa_id = p.id
          WHERE op.obra_id = o.id) AS responsaveis,
       l.em_alerta AS "emAlerta",
       oc.ocupacao AS ocupacao,
       so.descricao AS "statusObraDescricao",
       o.id AS "obraId",
       o.data_liberacao AS "dataLiberacaoObra",
       o.data_vistoria_pos_obra AS "vistoriaPosObra",
       o.liberado_para_mudanca AS "liberadoParaMudanca",
       o.data_mudanca AS "dataMudanca",
       (SELECT string_agg(q2.codigo || '/' || l2.numero::text, ', ' ORDER BY q2.codigo, l2.numero)
          FROM lote_apoio la JOIN lotes l2 ON l2.id = la.lote_apoio_id JOIN quadras q2 ON q2.id = l2.quadra_id
          WHERE la.lote_em_obra_id = l.id) AS "loteApoio",
       l.observacao_legado AS observacoes
     FROM lotes l
     JOIN quadras q ON q.id = l.quadra_id
     LEFT JOIN lote_ocupacao_historico oc ON oc.lote_id = l.id AND oc.data_fim IS NULL
     LEFT JOIN LATERAL (
       SELECT * FROM obras ob WHERE ob.lote_id = l.id
       ORDER BY (ob.tipo = 'REFORMA'), ob.criado_em DESC
       LIMIT 1
     ) o ON true
     LEFT JOIN obra_status_historico osh ON osh.obra_id = o.id AND osh.data_fim IS NULL
     LEFT JOIN status_obra so ON so.id = osh.status_id
     WHERE q.condominio_id = $1 ${filtroQuadra}
     ORDER BY q.codigo, l.numero`,
    params
  );

  return res.rows.map(converterLinha);
}

export async function gerarWorkbookRelatorioObras(linhas: LinhaRelatorioObras[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const aba = workbook.addWorksheet(NOME_ABA);

  aba.getRow(1).getCell(1).value = "CONTROLE E GESTÃO - OBRAS E PROJETOS";
  CABECALHOS.forEach((titulo, idx) => {
    aba.getRow(3).getCell(idx + 1).value = titulo;
  });

  aba.columns = [
    { width: 10 },
    { width: 8 },
    { width: 10 },
    { width: 35 },
    { width: 30 },
    { width: 30 },
    { width: 20 },
    { width: 15 },
    { width: 22 },
    { width: 18 },
    { width: 20 },
    { width: 18 },
    { width: 40 },
  ];

  linhas.forEach((linha, idx) => {
    const row = aba.getRow(4 + idx);
    row.getCell(1).value = linha.quadra;
    row.getCell(2).value = linha.lote;
    row.getCell(3).value = linha.m2;
    // Células de texto opcionais ficam sem valor (não "") quando vazias, para
    // o exceljs devolver célula genuinamente em branco na leitura.
    if (linha.endereco) row.getCell(4).value = linha.endereco;
    if (linha.proprietario) row.getCell(5).value = linha.proprietario;
    if (linha.responsavelTecnico) row.getCell(6).value = linha.responsavelTecnico;
    if (linha.status) row.getCell(7).value = linha.status;
    if (linha.loteApoio) row.getCell(8).value = linha.loteApoio;
    if (linha.dataLiberacaoObra) {
      row.getCell(9).value = linha.dataLiberacaoObra;
      row.getCell(9).numFmt = "dd/mm/yyyy";
    }
    if (linha.vistoriaPosObra) {
      row.getCell(10).value = linha.vistoriaPosObra;
      row.getCell(10).numFmt = "dd/mm/yyyy";
    }
    if (linha.liberadoParaMudanca) row.getCell(11).value = linha.liberadoParaMudanca;
    if (linha.dataMudanca) {
      row.getCell(12).value = linha.dataMudanca;
      row.getCell(12).numFmt = "dd/mm/yyyy";
    }
    if (linha.observacoes) row.getCell(13).value = linha.observacoes;
  });

  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

// Faixa Unicode dos diacríticos combinantes (U+0300-U+036F) isolados por
// normalize("NFD") — remove acentos preservando a letra base.
const REGEX_DIACRITICOS = /[̀-ͯ]/g;

function slugificar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(REGEX_DIACRITICOS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function gerarRelatorioObras(
  pool: Pool,
  filtros: FiltrosRelatorioObras
): Promise<{ buffer: Buffer; nomeArquivo: string }> {
  const condominio = await buscarCondominioPorId(pool, filtros.condominioId);
  const linhas = await buscarLinhasRelatorioObras(pool, filtros);
  const buffer = await gerarWorkbookRelatorioObras(linhas);
  const data = new Date().toISOString().slice(0, 10);
  const nomeArquivo = `relatorio-obras-${slugificar(condominio.nome)}-${data}.xlsx`;
  return { buffer, nomeArquivo };
}
