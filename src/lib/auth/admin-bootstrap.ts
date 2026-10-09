import { eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { users } from "../../db/schema";
import { hashPassword } from "./password";

export type AdminBootstrapResult = "created" | "existing-unchanged" | "password-reset";

/**
 * Cria o administrador se ainda não houver uma conta com esse e-mail.
 * Uma conta existente só tem a senha alterada quando a confirmação explícita é true.
 */
export async function bootstrapAdminAccount(
  db: Db,
  input: {
    email: string;
    password: string;
    confirmExistingPasswordReset?: boolean;
  },
): Promise<AdminBootstrapResult> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, input.email))
    .limit(1);

  if (existing[0]) {
    if (!input.confirmExistingPasswordReset) return "existing-unchanged";

    const passwordHash = await hashPassword(input.password);
    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, existing[0].id));
    return "password-reset";
  }

  const passwordHash = await hashPassword(input.password);
  await db.insert(users).values({ email: input.email, passwordHash, name: "Administrador", role: "admin" });
  return "created";
}
