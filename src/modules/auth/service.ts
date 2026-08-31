import bcrypt from "bcryptjs";
import type { Pool } from "pg";
import { UnauthorizedError } from "../../lib/errors.js";
import type { RoleUsuario } from "../../plugins/auth.js";

export interface UsuarioRow {
  id: string;
  nome: string;
  email: string;
  senha_hash: string;
  role: RoleUsuario;
  ativo: boolean;
}

export async function autenticar(
  pool: Pool,
  email: string,
  senha: string
): Promise<{ id: string; nome: string; email: string; role: RoleUsuario }> {
  const res = await pool.query<UsuarioRow>(
    `SELECT id, nome, email, senha_hash, role, ativo FROM usuarios WHERE email = $1`,
    [email]
  );

  const usuario = res.rows[0];
  if (!usuario || !usuario.ativo) {
    throw new UnauthorizedError("Credenciais inválidas.");
  }

  const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
  if (!senhaValida) {
    throw new UnauthorizedError("Credenciais inválidas.");
  }

  return { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role };
}
