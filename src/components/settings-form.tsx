import { FormWithState, type FormAction } from "./form-with-state";
import { Field, inputCls } from "./ui";
import { DEFAULT_SETTINGS, SETTING_RANGES, type AppSettings } from "@/lib/settings-defaults";
import { REFERENCE_MODES, REFERENCE_LABELS } from "@/lib/analysis/references";
import { ALERT_TYPES, ALERT_LABELS } from "@/lib/analysis/alerts-engine";

const NUMERIC_FIELDS: { key: keyof AppSettings; label: string; hint?: string; unit?: string }[] = [
  { key: "intervalHours", label: "Intervalo entre consultas automáticas", unit: "horas", hint: "Padrão: 6 h." },
  { key: "batchSize", label: "Ofertas por execução", hint: "Tamanho máximo do lote em cada execução." },
  { key: "maxPerStorePerRun", label: "Máximo por loja em cada execução", hint: "Limite por fonte para não sobrecarregar a loja." },
  { key: "minDelayBetweenRequestsMs", label: "Pausa entre requisições à mesma loja", unit: "ms", hint: "Mínimo recomendado: 1000 ms." },
  { key: "manualCooldownMinutes", label: "Intervalo mínimo entre atualizações manuais", unit: "min", hint: "Evita atualizações repetidas do mesmo produto." },
  { key: "requestTimeoutMs", label: "Tempo limite de cada requisição", unit: "ms" },
  { key: "runBudgetMs", label: "Tempo máximo de uma execução em lote", unit: "ms", hint: "Deve ficar abaixo do limite de duração da hospedagem." },
  { key: "storeFailureThreshold", label: "Falhas seguidas para marcar a fonte como indisponível", hint: "Após esse número, a loja aparece como indisponível." },
  { key: "staleAfterIntervals", label: "Intervalos sem coleta para considerar o preço desatualizado", hint: "Multiplica o intervalo de coleta." },
  { key: "dropThresholdPercent", label: "Queda para alerta de promoção", unit: "%", hint: "Comparada ao maior valor observado na janela abaixo." },
  { key: "dropWindowDays", label: "Janela da comparação de queda", unit: "dias" },
  { key: "realertDropPercent", label: "Nova queda necessária para alertar de novo", unit: "%", hint: "Só repete o alerta se o preço cair além deste patamar." },
  { key: "otherStoreThresholdPercent", label: "Diferença para alertar oportunidade em outra loja", unit: "%" },
];

export function SettingsForm({ values, action }: { values: AppSettings; action: FormAction }) {
  return (
    <FormWithState action={action} submitLabel="Salvar configurações" className="space-y-6">
      <input type="hidden" name="eventsForm" value="1" />
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-slate-900">Coleta e limites</legend>
        {NUMERIC_FIELDS.slice(0, 8).map((f) => (
          <Field key={f.key} label={`${f.label}${f.unit ? ` (${f.unit})` : ""}`} name={f.key} hint={`${f.hint ?? ""}${f.hint ? " " : ""}Faixa: ${SETTING_RANGES[f.key]?.join(" a ")}.`}>
            <input id={f.key} name={f.key} inputMode="numeric" defaultValue={String(values[f.key])} className={inputCls} />
          </Field>
        ))}
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-slate-900">Promoções e alertas</legend>
        {NUMERIC_FIELDS.slice(8).map((f) => (
          <Field key={f.key} label={`${f.label}${f.unit ? ` (${f.unit})` : ""}`} name={f.key} hint={`${f.hint ?? ""}${f.hint ? " " : ""}Faixa: ${SETTING_RANGES[f.key]?.join(" a ")}.`}>
            <input id={f.key} name={f.key} inputMode="numeric" defaultValue={String(values[f.key])} className={inputCls} />
          </Field>
        ))}
        <Field label="Referência de preço" name="referenceMode" hint="Base da economia potencial e dos alertas de queda.">
          <select id="referenceMode" name="referenceMode" defaultValue={values.referenceMode} className={inputCls}>
            {REFERENCE_MODES.map((m) => (
              <option key={m} value={m}>{REFERENCE_LABELS[m]}</option>
            ))}
          </select>
        </Field>
      </fieldset>
      <fieldset id="eventos" className="space-y-2">
        <legend className="mb-2 text-sm font-semibold text-slate-900">Eventos que geram alerta</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {ALERT_TYPES.map((t) => (
            <label key={t} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
              <input type="checkbox" name={`event_${t}`} defaultChecked={values.alertEvents[t] ?? DEFAULT_SETTINGS.alertEvents[t]} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600" />
              <span>{ALERT_LABELS[t]}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </FormWithState>
  );
}
