import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { bootstrapAdminAccount } from "@/lib/auth/admin-bootstrap";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { users } from "@/db/schema";
import { getDb, resetData } from "./helpers";

const TEST_EMAIL = "bootstrap-admin@example.test";

beforeEach(async () => {
  await resetData();
  await getDb().delete(users).where(eq(sql`lower(${users.email})`, TEST_EMAIL));
});

describe("bootstrap do administrador", () => {
  it("cria uma conta nova sem exigir confirmação de redefinição", async () => {
    const result = await bootstrapAdminAccount(getDb(), {
      email: TEST_EMAIL,
      password: "senha-inicial-segura",
    });

    expect(result).toBe("created");
    const [user] = await getDb().select().from(users).where(eq(users.email, TEST_EMAIL));
    expect(user).toBeDefined();
    expect(await verifyPassword("senha-inicial-segura", user.passwordHash)).toBe(true);
  });

  it("preserva a senha de uma conta existente até haver confirmação explícita", async () => {
    const oldPassword = "senha-anterior-segura";
    const newPassword = "senha-nova-segura";
    const oldHash = await hashPassword(oldPassword);
    await getDb().insert(users).values({ email: "BOOTSTRAP-ADMIN@example.test", passwordHash: oldHash, role: "admin" });

    const withoutConfirmation = await bootstrapAdminAccount(getDb(), {
      email: TEST_EMAIL,
      password: newPassword,
    });
    expect(withoutConfirmation).toBe("existing-unchanged");

    const [unchanged] = await getDb().select().from(users).where(eq(users.email, "BOOTSTRAP-ADMIN@example.test"));
    expect(unchanged.passwordHash).toBe(oldHash);
    expect(await verifyPassword(oldPassword, unchanged.passwordHash)).toBe(true);
    expect(await verifyPassword(newPassword, unchanged.passwordHash)).toBe(false);

    const withConfirmation = await bootstrapAdminAccount(getDb(), {
      email: TEST_EMAIL,
      password: newPassword,
      confirmExistingPasswordReset: true,
    });
    expect(withConfirmation).toBe("password-reset");

    const [updated] = await getDb().select().from(users).where(eq(users.email, "BOOTSTRAP-ADMIN@example.test"));
    expect(updated.passwordHash).not.toBe(oldHash);
    expect(await verifyPassword(newPassword, updated.passwordHash)).toBe(true);
  });
});
