import type { FastifyInstance } from "fastify";

export const CREDENCIAIS = {
  ADMIN: { email: "admin@ruda.local", senha: process.env.SEED_ADMIN_PASSWORD ?? "TrocarEssaSenha!123" },
  ANALISTA: { email: "analista@ruda.local", senha: process.env.SEED_ADMIN_PASSWORD ?? "TrocarEssaSenha!123" },
  CONSULTA: { email: "consulta@ruda.local", senha: process.env.SEED_ADMIN_PASSWORD ?? "TrocarEssaSenha!123" },
} as const;

export async function obterToken(app: FastifyInstance, role: keyof typeof CREDENCIAIS): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: CREDENCIAIS[role],
  });
  if (res.statusCode !== 200) {
    throw new Error(`Login de teste falhou para ${role}: ${res.statusCode} ${res.body}`);
  }
  return res.json().token as string;
}

export function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}
