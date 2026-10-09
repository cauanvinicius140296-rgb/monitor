"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { formDataToObject } from "@/lib/validation/schemas";
import { fail, done, type ActionState } from "@/lib/action-state";
import { saveSettingsPatch } from "@/lib/repos/settings-repo";
import { DEFAULT_SETTINGS, SETTING_RANGES, type AppSettings } from "@/lib/settings-defaults";
import { REFERENCE_MODES, type ReferenceMode } from "@/lib/analysis/references";
import { ALERT_TYPES, type AlertType } from "@/lib/analysis/alerts-engine";

const NUMERIC_KEYS = Object.keys(SETTING_RANGES) as (keyof AppSettings)[];

export async function saveSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const raw = formDataToObject(formData);
  const patch: Partial<AppSettings> = {};
  const errors: Record<string, string> = {};

  for (const key of NUMERIC_KEYS) {
    const value = raw[key];
    if (value === undefined) continue;
    const n = Number(value.replace(",", "."));
    const [min, max] = SETTING_RANGES[key] as [number, number];
    if (!Number.isFinite(n) || n < min || n > max) {
      errors[key] = `Use um valor entre ${min} e ${max}.`;
      continue;
    }
    (patch as Record<string, number>)[key] = Math.round(n);
  }

  const mode = raw.referenceMode;
  if (mode !== undefined) {
    if ((REFERENCE_MODES as readonly string[]).includes(mode)) patch.referenceMode = mode as ReferenceMode;
    else errors.referenceMode = "Escolha uma opção válida.";
  }

  const alertEvents = { ...DEFAULT_SETTINGS.alertEvents };
  if (Object.keys(raw).some((k) => k.startsWith("event_") || k === "eventsForm")) {
    for (const t of ALERT_TYPES) alertEvents[t as AlertType] = raw[`event_${t}`] === "on";
    patch.alertEvents = alertEvents;
  }

  if (Object.keys(errors).length > 0) return fail("Revise os valores destacados.", errors);
  await saveSettingsPatch(patch);
  revalidatePath("/configuracoes");
  revalidatePath("/");
  revalidatePath("/produtos");
  return done("Configurações salvas.");
}
