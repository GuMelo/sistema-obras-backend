import type { Pool } from "pg";

export interface StatusObraCatalogo {
  id: string;
  codigo: string;
  descricao: string;
  ordemExibicao: number;
  ativo: boolean;
}

export async function listarStatusObra(pool: Pool): Promise<StatusObraCatalogo[]> {
  const res = await pool.query<StatusObraCatalogo>(
    `SELECT id, codigo, descricao, ordem_exibicao AS "ordemExibicao", ativo
     FROM status_obra
     ORDER BY ordem_exibicao`
  );
  return res.rows;
}
