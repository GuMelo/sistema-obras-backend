import type { Pool } from "pg";
import { NotFoundError, ValidationAppError } from "../../lib/errors.js";
import { montarResultadoPaginado, resolverPaginacao, type PaginatedResult } from "../../lib/pagination.js";

export interface Documento {
  id: string;
  loteId: string | null;
  obraId: string | null;
  tipo: "FOTO" | "PDF" | "OUTRO";
  nomeArquivo: string;
  mimeType: string | null;
  tamanhoBytes: number | null;
  descricao: string | null;
  dataUpload: string;
}

const SELECT = `SELECT id, lote_id AS "loteId", obra_id AS "obraId", tipo, nome_arquivo AS "nomeArquivo",
  mime_type AS "mimeType", tamanho_bytes AS "tamanhoBytes", descricao, data_upload AS "dataUpload" FROM documentos`;

export async function listarDocumentos(
  pool: Pool,
  filtros: { loteId?: string; obraId?: string; page?: number; pageSize?: number }
): Promise<PaginatedResult<Documento>> {
  const paginacao = resolverPaginacao(filtros);
  const condicoes: string[] = [];
  const params: unknown[] = [];
  if (filtros.loteId) {
    params.push(filtros.loteId);
    condicoes.push(`lote_id = $${params.length}`);
  }
  if (filtros.obraId) {
    params.push(filtros.obraId);
    condicoes.push(`obra_id = $${params.length}`);
  }
  const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";

  const totalRes = await pool.query<{ total: string }>(`SELECT count(*) AS total FROM documentos ${where}`, params);
  const dadosRes = await pool.query<Documento>(
    `${SELECT} ${where} ORDER BY data_upload DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, paginacao.limit, paginacao.offset]
  );

  return montarResultadoPaginado(dadosRes.rows, Number(totalRes.rows[0].total), paginacao);
}

export async function buscarDocumentoPorId(pool: Pool, id: string): Promise<Documento> {
  const res = await pool.query<Documento>(`${SELECT} WHERE id = $1`, [id]);
  if (res.rowCount === 0) throw new NotFoundError("Documento", id);
  return res.rows[0];
}

/** Cria apenas o METADADO do documento — não há upload/armazenamento físico
 * nesta fase (ver DOMAIN_MODEL.md). `storageProvider`/`storageKey` ficam
 * nulos até essa integração existir. */
export async function criarDocumento(
  pool: Pool,
  dados: {
    loteId?: string;
    obraId?: string;
    tipo: "FOTO" | "PDF" | "OUTRO";
    nomeArquivo: string;
    mimeType?: string | null;
    tamanhoBytes?: number | null;
    descricao?: string | null;
  }
): Promise<Documento> {
  if ((dados.loteId ? 1 : 0) + (dados.obraId ? 1 : 0) !== 1) {
    throw new ValidationAppError("Informe exatamente um entre loteId e obraId.");
  }
  if (dados.loteId) {
    const existe = await pool.query(`SELECT 1 FROM lotes WHERE id = $1`, [dados.loteId]);
    if (existe.rowCount === 0) throw new NotFoundError("Lote", dados.loteId);
  }
  if (dados.obraId) {
    const existe = await pool.query(`SELECT 1 FROM obras WHERE id = $1`, [dados.obraId]);
    if (existe.rowCount === 0) throw new NotFoundError("Obra", dados.obraId);
  }

  const res = await pool.query<Documento>(
    `INSERT INTO documentos (lote_id, obra_id, tipo, nome_arquivo, mime_type, tamanho_bytes, descricao)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, lote_id AS "loteId", obra_id AS "obraId", tipo, nome_arquivo AS "nomeArquivo",
       mime_type AS "mimeType", tamanho_bytes AS "tamanhoBytes", descricao, data_upload AS "dataUpload"`,
    [
      dados.loteId ?? null,
      dados.obraId ?? null,
      dados.tipo,
      dados.nomeArquivo,
      dados.mimeType ?? null,
      dados.tamanhoBytes ?? null,
      dados.descricao ?? null,
    ]
  );
  return res.rows[0];
}

export async function removerDocumento(pool: Pool, id: string): Promise<void> {
  const res = await pool.query(`DELETE FROM documentos WHERE id = $1`, [id]);
  if (res.rowCount === 0) throw new NotFoundError("Documento", id);
}
