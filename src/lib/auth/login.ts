import { eq, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { users } from "@/db/schema";
import { verifyPassword } from "./password";
import { consumeRateLimit } from "../rate-limit";

export type LoginResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "rate_limited"; retryAfterSeconds?: number };

/**
 * Valida credenciais. Mensagem genérica para e-mail ou senha incorretos
 * (não revela qual campo está errado). Aplica limites por IP e por e-mail.
 */
export async function authenticate(
  email: string,
  password: string,
  ip: string,
  db: Db = getDb(),
): Promise<LoginResult> {
  const normalized = email.trim().toLowerCase();
  const byIp = await consumeRateLimit(`login:ip:${ip}`, 20, 15 * 60);
  const byEmail = await consumeRateLimit(`login:email:${normalized}`, 8, 15 * 60);
  if (!byIp.allowed || !byEmail.allowed) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: Math.max(byIp.retryAfterSeconds, byEmail.retryAfterSeconds) };
  }
  const rows = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(sql`lower(${users.email})`, normalized))
    .limit(1);
  const user = rows[0];
  // Executa a verificação mesmo sem usuário, para não revelar existência pelo tempo de resposta.
  const valid = await verifyPassword(
    password,
    user?.passwordHash ?? "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA",
  ).catch(() => false);
  if (!user || !valid) return { ok: false, reason: "invalid" };
  return { ok: true, userId: user.id };
}
