/**
 * Cria (ou atualiza a senha de) o único administrador do painel.
 * Uso: ADMIN_EMAIL=voce@exemplo.com ADMIN_PASSWORD='senha-forte' npm run admin:create
 * A senha nunca é exibida nem gravada em texto puro: apenas o hash scrypt.
 */
import postgres from "postgres";
import { isLocalDatabaseUrl } from "../src/lib/db-url";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";

async function main() {
  const url = process.env.DATABASE_URL;
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!url) throw new Error("DATABASE_URL não definida.");
  if (!email || !email.includes("@")) throw new Error("Defina ADMIN_EMAIL com um e-mail válido.");
  if (password.length < 10) throw new Error("Defina ADMIN_PASSWORD com pelo menos 10 caracteres.");

  const isLocal = isLocalDatabaseUrl(url);
  const client = postgres(url, { max: 1, prepare: false, ssl: isLocal ? false : "require" });
  try {
    const db = drizzle(client, { schema });
    const passwordHash = await hashPassword(password);
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, email))
      .limit(1);
    if (existing[0]) {
      await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, existing[0].id));
      console.log(`Senha do administrador atualizada: ${email}`);
    } else {
      await db.insert(users).values({ email, passwordHash, name: "Administrador", role: "admin" });
      console.log(`Administrador criado: ${email}`);
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
