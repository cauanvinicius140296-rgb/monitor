import { and, eq, gte, isNull, lt, ne, or, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { ensureBaseData, JOB_COLETA_AUTOMATICA } from "@/db/bootstrap";
import { monitoringRuns, offers, products, stores } from "@/db/schema";
import { getAdapterByKey } from "../adapters/registry";
import { SourceError, type FetchContext, type OfferSnapshot, type PriceSourceAdapter } from "../adapters/types";
import { loadSettings } from "../repos/settings-repo";
import type { AppSettings } from "../settings-defaults";
import { releaseJobLock, tryAcquireJobLock } from "./lock";
import { selectWithQuotas, sleep } from "./selection";
import { recordFailure, recordSuccess, updateStoreHealth } from "./observations";
import { evaluateProductAlerts } from "./alerts-service";

export type RunStatus = "concluido" | "parcial" | "falhou" | "ignorado";

export interface CollectorOptions {
  trigger: "cron" | "manual";
  /** Restringe a execução a um produto (atualização manual). */
  productId?: string;
  /** Identificador de quem executa (para a trava). */
  owner?: string;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  /** Substitui o registro de adaptadores (testes). */
  adapterFor?: (key: string) => PriceSourceAdapter | null;
  sleepImpl?: (ms: number) => Promise<void>;
  settingsOverride?: Partial<AppSettings>;
  /** Pula o retry (testes). */
  retryDelayMs?: number;
  db?: Db;
}

export interface RunSummary {
  status: RunStatus;
  runId: string | null;
  message: string;
  selected: number;
  ok: number;
  failed: number;
  deferred: number;
  skippedNotConfigured: number;
  skippedCooldown: number;
  alertsCreated: number;
  stoppedByBudget: boolean;
  errors: { offerId: string; storeSlug: string; code: string; message: string }[];
  perStore: Record<string, { selected: number; ok: number; failed: number }>;
}

interface Candidate {
  offerId: string;
  productId: string;
  priority: number;
  storeId: string;
  storeSlug: string;
  adapterKey: string | null;
  url: string;
  externalId: string | null;
  lastCheckedAt: Date | null;
  storeAutomated: boolean;
}

const PRIORITY_RANK: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
const RETRYABLE_ATTEMPTS = 2;
/**
 * Circuit breaker por loja, dentro de uma execução: após este número de falhas de fonte
 * seguidas (indisponível, limite, erro interno), as demais ofertas da loja ficam adiadas
 * nesta rodada, sem novas requisições. O estado no banco (consecutive_failures) segue sendo
 * registrado para o painel de fontes.
 */
export const SOURCE_CIRCUIT_THRESHOLD = 3;

function emptySummary(status: RunStatus, message: string, runId: string | null): RunSummary {
  return {
    status,
    runId,
    message,
    selected: 0,
    ok: 0,
    failed: 0,
    deferred: 0,
    skippedNotConfigured: 0,
    skippedCooldown: 0,
    alertsCreated: 0,
    stoppedByBudget: false,
    errors: [],
    perStore: {},
  };
}

/**
 * Executa uma coleta em lote.
 * - Trava global: nunca há duas execuções simultâneas (cron e manual compartilham a trava).
 * - Limites: lote máximo, máximo por loja, intervalo mínimo por oferta, pausa entre requisições.
 * - Orçamento de tempo: para com segurança antes do limite da hospedagem.
 * - Toda execução fica registrada em monitoring_runs (inclusive as ignoradas).
 */
export async function runCollection(opts: CollectorOptions): Promise<RunSummary> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? (() => new Date());
  const startedMs = Date.now();
  await ensureBaseData(db);
  const baseSettings = await loadSettings(db);
  const settings: AppSettings = { ...baseSettings, ...(opts.settingsOverride ?? {}) };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleepImpl = opts.sleepImpl ?? sleep;
  const adapterFor = opts.adapterFor ?? getAdapterByKey;
  const owner = opts.owner ?? `${opts.trigger}-${crypto.randomUUID()}`;

  const lock = await tryAcquireJobLock(JOB_COLETA_AUTOMATICA, owner, db);
  if (!lock) {
    const [ignored] = await db
      .insert(monitoringRuns)
      .values({
        trigger: opts.trigger,
        productId: opts.productId ?? null,
        status: "ignorado",
        startedAt: now(),
        finishedAt: now(),
        errorSummary: "Outra execução ainda está em andamento. Esta foi ignorada para evitar duplicidade.",
      })
      .returning({ id: monitoringRuns.id });
    return emptySummary("ignorado", "Já existe uma coleta em andamento. Tente novamente em instantes.", ignored.id);
  }

  let runId: string | null = null;
  let status: RunStatus = "concluido";
  const summary = emptySummary("concluido", "", null);
  try {
    const startedAt = now();
    const [run] = await db
      .insert(monitoringRuns)
      .values({
        jobId: lock.jobId,
        trigger: opts.trigger,
        productId: opts.productId ?? null,
        status: "executando",
        startedAt,
      })
      .returning({ id: monitoringRuns.id });
    runId = run.id;
    summary.runId = runId;

    const isManual = opts.trigger === "manual";
    const cutoff = isManual
      ? new Date(startedAt.getTime() - settings.manualCooldownMinutes * 60_000)
      : new Date(startedAt.getTime() - settings.intervalHours * 3_600_000);

    const rows = await db
      .select({
        offerId: offers.id,
        productId: offers.productId,
        productPriority: products.priority,
        storeId: offers.storeId,
        storeSlug: stores.slug,
        adapterKey: stores.adapterKey,
        url: offers.url,
        externalId: offers.externalId,
        lastCheckedAt: offers.lastCheckedAt,
        storeAutomated: stores.automated,
        isActive: offers.isActive,
        productStatus: products.status,
      })
      .from(offers)
      .innerJoin(products, eq(offers.productId, products.id))
      .innerJoin(stores, eq(offers.storeId, stores.id))
      .where(
        and(
          eq(offers.isActive, true),
          ne(offers.source, "demo"),
          ne(products.status, "arquivado"),
          opts.productId
            ? eq(offers.productId, opts.productId)
            : eq(products.status, "monitorando"),
          isManual ? sql`true` : eq(stores.automated, true),
          or(isNull(offers.lastCheckedAt), lt(offers.lastCheckedAt, cutoff)),
        ),
      )
      .orderBy(sql`${offers.lastCheckedAt} asc nulls first`)
      .limit(settings.batchSize * 10);

    // Filtra ofertas sem adaptador ou sem credenciais (não contam como falha da fonte).
    const eligible: Candidate[] = [];
    for (const r of rows) {
      const adapter = r.adapterKey ? adapterFor(r.adapterKey) : null;
      if (!adapter || !adapter.isConfigured() || (!isManual && !adapter.automated)) {
        summary.skippedNotConfigured++;
        continue;
      }
      eligible.push({
        offerId: r.offerId,
        productId: r.productId,
        priority: PRIORITY_RANK[r.productPriority] ?? 1,
        storeId: r.storeId,
        storeSlug: r.storeSlug,
        adapterKey: r.adapterKey,
        url: r.url,
        externalId: r.externalId,
        lastCheckedAt: r.lastCheckedAt,
        storeAutomated: r.storeAutomated,
      });
    }
    if (isManual) {
      // Em atualização manual, ofertas recentes entram na contagem de "ignoradas por intervalo".
      const recent = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(offers)
        .where(and(opts.productId ? eq(offers.productId, opts.productId) : sql`true`, gte(offers.lastCheckedAt, cutoff)));
      summary.skippedCooldown = recent[0]?.n ?? 0;
    }

    const { selected, deferred } = selectWithQuotas(eligible, settings.batchSize, settings.maxPerStorePerRun);
    summary.deferred = deferred;
    summary.selected = selected.length;

    const affectedProducts = new Set<string>();
    const lastRequestAt = new Map<string, number>();
    const sourceFailureStreak = new Map<string, number>();
    let stoppedByBudget = false;
    let handled = 0; // itens tratados nesta rodada (processados ou adiados pelo circuit breaker)

    for (const item of selected) {
      if (Date.now() - startedMs > settings.runBudgetMs) {
        stoppedByBudget = true;
        break;
      }
      handled++;
      const adapter = adapterFor(item.adapterKey as string);
      if (!adapter) continue;

      // Circuit breaker: loja com falhas seguidas nesta rodada não recebe novas requisições.
      if ((sourceFailureStreak.get(item.storeSlug) ?? 0) >= SOURCE_CIRCUIT_THRESHOLD) {
        summary.deferred++;
        continue;
      }

      // Pausa entre requisições à mesma fonte.
      const last = lastRequestAt.get(item.storeSlug);
      if (last !== undefined) {
        const wait = settings.minDelayBetweenRequestsMs - (Date.now() - last);
        if (wait > 0) await sleepImpl(wait);
      }

      const ctx: FetchContext = { timeoutMs: settings.requestTimeoutMs, fetchImpl };
      const ref = { externalId: item.externalId, url: item.url };
      const perStore = (summary.perStore[item.storeSlug] ??= { selected: 0, ok: 0, failed: 0 });
      perStore.selected++;

      let snapshot: OfferSnapshot | null = null;
      let failure: SourceError | null = null;
      for (let attempt = 1; attempt <= RETRYABLE_ATTEMPTS; attempt++) {
        lastRequestAt.set(item.storeSlug, Date.now());
        try {
          snapshot = await adapter.fetchOffer(ref, ctx);
          failure = null;
          break;
        } catch (err) {
          failure = err instanceof SourceError ? err : new SourceError("unavailable", "Falha inesperada na coleta.", true);
          if (!failure.retryable || attempt === RETRYABLE_ATTEMPTS) break;
          await sleepImpl(opts.retryDelayMs ?? 2000);
        }
      }

      const observedAt = now();
      const offerTarget = { id: item.offerId, productId: item.productId, storeId: item.storeId };
      const sourceLevel = failure !== null && failure.code !== "not_found" && failure.code !== "unsupported_url";
      if (snapshot) {
        sourceFailureStreak.set(item.storeSlug, 0);
        await recordSuccess(db, { runId, offer: offerTarget, snapshot, now: observedAt });
        await updateStoreHealth(db, { storeId: item.storeId, ok: true, sourceLevelError: false, now: observedAt });
        summary.ok++;
        perStore.ok++;
      } else if (failure) {
        await recordFailure(db, { runId, offer: offerTarget, error: failure, source: adapter.key, now: observedAt });
        await updateStoreHealth(db, {
          storeId: item.storeId,
          ok: false,
          sourceLevelError: sourceLevel,
          message: failure.message,
          now: observedAt,
        });
        if (sourceLevel) sourceFailureStreak.set(item.storeSlug, (sourceFailureStreak.get(item.storeSlug) ?? 0) + 1);
        summary.failed++;
        perStore.failed++;
        summary.errors.push({ offerId: item.offerId, storeSlug: item.storeSlug, code: failure.code, message: failure.message });
      }
      affectedProducts.add(item.productId);
    }
    summary.stoppedByBudget = stoppedByBudget;
    if (stoppedByBudget) summary.deferred += selected.length - handled;

    // Alertas: somente produtos cujas ofertas foram atualizadas nesta execução.
    for (const productId of affectedProducts) {
      const r = await evaluateProductAlerts(db, { productId, runId, now: now(), settings });
      summary.alertsCreated += r.created;
    }

    if (selected.length === 0) {
      status = "concluido";
      summary.message = "Nenhuma oferta elegível para consulta automática neste momento.";
    } else if (summary.ok === 0 && summary.failed > 0) {
      status = "falhou";
      summary.message = "Todas as consultas desta execução falharam. Verifique a aba Fontes.";
    } else if (summary.failed > 0 || stoppedByBudget) {
      status = "parcial";
      summary.message = stoppedByBudget
        ? "Execução interrompida por limite de tempo; o restante será consultado na próxima rodada."
        : "Execução concluída com algumas falhas.";
    } else {
      summary.message = `${summary.ok} oferta(s) atualizada(s) com sucesso.`;
    }
  } catch (err) {
    status = "falhou";
    const message = err instanceof Error ? err.message : String(err);
    summary.message = "Erro interno durante a coleta. Consulte o registro da execução.";
    summary.errors.push({ offerId: "-", storeSlug: "-", code: "internal", message: message.slice(0, 300) });
    if (runId) {
      await db
        .update(monitoringRuns)
        .set({ errorSummary: message.slice(0, 1000) })
        .where(eq(monitoringRuns.id, runId));
    }
  } finally {
    if (runId) {
      await db
        .update(monitoringRuns)
        .set({
          status,
          finishedAt: now(),
          offersSelected: summary.selected,
          offersOk: summary.ok,
          offersFailed: summary.failed,
          alertsCreated: summary.alertsCreated,
          errorSummary: summary.errors.length
            ? summary.errors.slice(0, 20).map((e) => `[${e.storeSlug}] ${e.code}: ${e.message}`).join("\n").slice(0, 2000)
            : null,
        })
        .where(eq(monitoringRuns.id, runId));
    }
    await releaseJobLock(lock, status, db);
  }
  summary.status = status;
  return summary;
}

