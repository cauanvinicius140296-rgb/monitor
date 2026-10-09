"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { ensureBootstrapped } from "@/db/bootstrap";
import { fail, done, type ActionState } from "@/lib/action-state";
import { consumeRateLimit } from "@/lib/rate-limit";
import { testMercadoLivreConnection } from "@/lib/adapters/mercado-livre";

/**
 * Testa a integração real com a API do Mercado Livre a partir do servidor.
 * O resultado aparece como mensagem; nenhum token é exibido.
 */
export async function testMercadoLivreAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  await ensureBootstrapped();
  const limit = await consumeRateLimit(`source-test:${user.id}`, 10, 60 * 60);
  if (!limit.allowed) return fail("Muitos testes nesta hora. Tente mais tarde.");
  const report = await testMercadoLivreConnection({ timeoutMs: 15_000, fetchImpl: fetch });
  revalidatePath("/fontes");
  return report.ok ? done(report.message) : fail(report.message);
}
