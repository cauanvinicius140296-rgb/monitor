import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { monitoringJobs } from "@/db/schema";

/** Tempo de validade da trava. Deve ser maior que o tempo máximo de uma execução. */
export const LOCK_TTL_SECONDS = 15 * 60;

export interface LockHandle {
  jobId: string;
  owner: string;
}

/**
 * Tenta adquirir a trava do job de forma atômica.
 * Só uma execução por vez: UPDATE condicional com retorno da linha.
 * Se a execução anterior travou (processo morreu), a trava expira após LOCK_TTL_SECONDS.
 */
export async function tryAcquireJobLock(name: string, owner: string = randomUUID(), db: Db = getDb()): Promise<LockHandle | null> {
  const rows = await db
    .update(monitoringJobs)
    .set({
      lockedUntil: sql`now() + make_interval(secs => ${LOCK_TTL_SECONDS})`,
      lockedBy: owner,
      lastStartedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(monitoringJobs.name, name),
        eq(monitoringJobs.enabled, true),
        or(isNull(monitoringJobs.lockedUntil), lt(monitoringJobs.lockedUntil, sql`now()`)),
      ),
    )
    .returning({ id: monitoringJobs.id });
  if (rows.length === 0) return null;
  return { jobId: rows[0].id, owner };
}

export async function releaseJobLock(
  handle: LockHandle,
  status: "concluido" | "parcial" | "falhou" | "ignorado",
  db: Db = getDb(),
): Promise<void> {
  await db
    .update(monitoringJobs)
    .set({
      lockedUntil: null,
      lockedBy: null,
      lastFinishedAt: new Date(),
      lastStatus: status,
      updatedAt: new Date(),
    })
    .where(and(eq(monitoringJobs.id, handle.jobId), eq(monitoringJobs.lockedBy, handle.owner)));
}

export async function getJobLockState(name: string, db: Db = getDb()) {
  const rows = await db
    .select({
      lockedUntil: monitoringJobs.lockedUntil,
      lockedBy: monitoringJobs.lockedBy,
      lastStartedAt: monitoringJobs.lastStartedAt,
      lastFinishedAt: monitoringJobs.lastFinishedAt,
      lastStatus: monitoringJobs.lastStatus,
      enabled: monitoringJobs.enabled,
    })
    .from(monitoringJobs)
    .where(eq(monitoringJobs.name, name))
    .limit(1);
  return rows[0] ?? null;
}
