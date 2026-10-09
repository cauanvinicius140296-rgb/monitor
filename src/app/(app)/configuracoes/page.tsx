import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { loadSettings } from "@/lib/repos/settings-repo";
import { Card, CardTitle, PageHeader, Notice } from "@/components/ui";
import { SettingsForm } from "@/components/settings-form";
import { saveSettingsAction } from "@/app/actions/settings";
import { STORE_CATALOG } from "@/lib/stores-catalog";

export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  await requireUser();
  const settings = await loadSettings(getDb());
  return (
    <>
      <PageHeader title="Configurações" subtitle="Intervalo de coleta, limites por fonte, regras de promoção e eventos de alerta." />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card>
          <SettingsForm values={settings} action={saveSettingsAction} />
        </Card>
        <aside className="space-y-4">
          <Card>
            <CardTitle>Agendador</CardTitle>
            <p className="text-sm text-slate-600">
              A coleta automática roda no servidor pelo GitHub Actions (<code className="text-xs">0 */6 * * *</code>), chamando <code className="text-xs">/api/cron/monitor</code> com o segredo <code className="text-xs">CRON_SECRET</code>.
              O intervalo acima define quando cada oferta é consultada novamente; o agendador só dispara a verificação.
            </p>
          </Card>
          <Notice tone="info">Lojas com integração “manual” ou “pendente” não são consultadas automaticamente. Veja <a className="underline" href="/fontes">Fontes</a>.</Notice>
          <Card>
            <CardTitle>Lojas cadastradas</CardTitle>
            <ul className="space-y-1 text-sm text-slate-600">
              {STORE_CATALOG.map((s) => (
                <li key={s.slug}>{s.name} — {s.integrationMode === "api" ? "API oficial" : s.integrationMode === "manual" ? "manual" : "pendente"}</li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}
