"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { alerts } from "@/db/schema";
import { formDataToObject } from "@/lib/validation/schemas";

const statusSchema = z.enum(["nao_lido", "lido", "arquivado"]);

export async function setAlertStatusAction(formData: FormData): Promise<void> {
  await requireUser();
  const raw = formDataToObject(formData);
  const id = z.string().uuid().safeParse(raw.id);
  const status = statusSchema.safeParse(raw.status);
  if (!id.success || !status.success) return;
  const now = new Date();
  await getDb()
    .update(alerts)
    .set({
      status: status.data,
      readAt: status.data === "lido" ? now : status.data === "nao_lido" ? null : undefined,
      archivedAt: status.data === "arquivado" ? now : status.data === "nao_lido" ? null : undefined,
      updatedAt: now,
    })
    .where(eq(alerts.id, id.data));
  revalidatePath("/alertas");
  revalidatePath("/");
}

export async function markAllAlertsReadAction(): Promise<void> {
  await requireUser();
  const now = new Date();
  await getDb()
    .update(alerts)
    .set({ status: "lido", readAt: now, updatedAt: now })
    .where(eq(alerts.status, "nao_lido"));
  revalidatePath("/alertas");
  revalidatePath("/");
}
