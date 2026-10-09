import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { isProduction } from "@/lib/env";

export const SESSION_COOKIE = "radar_sessao";
const SESSION_DAYS = 7;

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSession(userId: string): Promise<string> {
  const db = getDb();
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ id: hashSessionToken(token), userId, expiresAt });
  // Limpeza oportunista de sessões expiradas.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await getDb().delete(sessions).where(eq(sessions.id, hashSessionToken(token)));
  }
  jar.delete(SESSION_COOKIE);
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
}

/** Retorna o usuário logado ou null. Sempre valida no banco (sessão revogável). */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length < 20 || token.length > 200) return null;
  const rows = await getDb()
    .select({ id: users.id, email: users.email, name: users.name })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, hashSessionToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

/** Use em todas as páginas e ações administrativas. Redireciona para /login se não autenticado. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
