"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { consumeRateLimit } from "@/lib/rate-limit";
import { runCollection } from "@/lib/monitoring/collector";
import { ensureBootstrapped } from "@/db/bootstrap";
import { fail, done, type ActionState } from "@/lib/action-state";

const schema = z.object({ productId: z.string().uuid().optional() });

/**
 * Coleta manual (produto específico ou todos). Protegida por sessão e por limite por usuário.
 * O intervalo mínimo entre consultas da mesma oferta é respeitado pelo coletor.
 */
export async function runManualCollectionAction(productId: string | undefined): Promise<ActionState> {
  const user = await requireUser();
  const parsed = schema.safeParse({ productId: productId || undefined });
  if (!parsed.success) return fail("Produto inválido.");
  const limit = await consumeRateLimit(`manual-run:${user.id}`, 30, 60 * 60);
  if (!limit.allowed) return fail("Limite de atualizações manuais atingido nesta hora.");
  await ensureBootstrapped();
  const summary = await runCollection({ trigger: "manual", productId: parsed.data.productId, owner: `manual-${user.id}-${Date.now()}` });
  revalidatePath("/");
  revalidatePath("/fontes");
  revalidatePath("/alertas");
  if (parsed.data.productId) revalidatePath(`/produtos/${parsed.data.productId}`);
  const extra =
    summary.skippedCooldown > 0 && summary.selected === 0
      ? " As ofertas foram consultadas há pouco; aguarde o intervalo mínimo."
      : summary.skippedNotConfigured > 0
        ? ` ${summary.skippedNotConfigured} oferta(s) sem integração automática: registre o preço manualmente.`
        : "";
  if (summary.status === "ignorado") return fail(summary.message);
  return done(`${summary.message}${extra}`);
}
