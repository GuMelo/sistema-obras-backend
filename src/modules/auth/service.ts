import bcrypt from "bcryptjs";
import type { Pool } from "pg";
import { NotFoundError, UnauthorizedError, ValidationAppError } from "../../lib/errors.js";
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

// Fluxo de "trocar a própria senha" (qualquer papel) — distinto do fluxo de
// ADMIN redefinir a senha de outro usuário via PATCH /users/:id
// (atualizarUsuario, em users/service.ts), que não exige a senha atual por
// já ser uma ação privilegiada. Aqui, 400 (não 401) para senha atual errada:
// a sessão do usuário continua válida, é só um erro de validação do
// formulário — 401 poderia disparar um logout automático no frontend.
export async function alterarSenhaPropria(
  pool: Pool,
  usuarioId: string,
  senhaAtual: string,
  novaSenha: string
): Promise<void> {
  const res = await pool.query<{ senha_hash: string }>(`SELECT senha_hash FROM usuarios WHERE id = $1`, [usuarioId]);
  if (res.rowCount === 0) throw new NotFoundError("Usuário", usuarioId);

  const senhaValida = await bcrypt.compare(senhaAtual, res.rows[0].senha_hash);
  if (!senhaValida) {
    throw new ValidationAppError("Senha atual incorreta.");
  }

  const novaSenhaHash = await bcrypt.hash(novaSenha, 10);
  await pool.query(`UPDATE usuarios SET senha_hash = $2, atualizado_em = now() WHERE id = $1`, [
    usuarioId,
    novaSenhaHash,
  ]);
}
