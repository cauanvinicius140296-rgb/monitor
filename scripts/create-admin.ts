/**
 * Cria a conta de administrador ou, com confirmação explícita, substitui a senha existente.
 * Uso: ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run admin:create
 * Para autorizar a troca de senha de uma conta existente, acrescente:
 *   npm run admin:create -- --confirm-existing-password-reset
 * A senha nunca é exibida nem gravada em texto puro: apenas o hash scrypt.
 */
import postgres from "postgres";
import { isLocalDatabaseUrl } from "../src/lib/db-url";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema";
import { bootstrapAdminAccount } from "../src/lib/auth/admin-bootstrap";

const RESET_FLAG = "--confirm-existing-password-reset";

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== RESET_FLAG)) {
    throw new Error(`Argumento inválido. Uso: npm run admin:create [-- ${RESET_FLAG}]`);
  }

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
    const result = await bootstrapAdminAccount(db, {
      email,
      password,
      confirmExistingPasswordReset: args.includes(RESET_FLAG),
    });

    if (result === "created") console.log("Administrador criado.");
    else if (result === "existing-unchanged") {
      console.log("A conta de administrador já existe; nenhuma credencial foi alterada.");
      console.log(`Para autorizar a troca, execute novamente com ${RESET_FLAG}.`);
    } else console.log("Senha atualizada após confirmação explícita.");
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
