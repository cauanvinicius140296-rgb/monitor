"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createSession, destroyCurrentSession } from "@/lib/auth/session";
import { authenticate } from "@/lib/auth/login";
import { clientIp } from "@/lib/security/secret";
import { formDataToObject } from "@/lib/validation/schemas";
import { fail, type ActionState } from "@/lib/action-state";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().trim().email("Informe um e-mail válido.").max(255),
  password: z.string().min(1, "Informe a senha.").max(500),
});

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return fail("Verifique os dados informados.", { email: parsed.error.issues[0]?.message ?? "" });

  const ip = clientIp(await headers());
  const result = await authenticate(parsed.data.email, parsed.data.password, ip);
  if (!result.ok) {
    if (result.reason === "rate_limited") {
      const minutes = Math.ceil((result.retryAfterSeconds ?? 900) / 60);
      return fail(`Muitas tentativas. Aguarde cerca de ${minutes} min e tente novamente.`);
    }
    return fail("E-mail ou senha incorretos.");
  }
  await createSession(result.userId);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await destroyCurrentSession();
  redirect("/login");
}
