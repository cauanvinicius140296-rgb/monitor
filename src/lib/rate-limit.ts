import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Limite de requisições por janela fixa, persistido no banco (funciona em serverless).
 * Incremento atômico: uma única instrução SQL por chamada.
 */
export async function consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const db = getDb();
  const rows = await db.execute<{ hits: number; window_start: Date }>(sql`
    INSERT INTO rate_limits (key, window_start, hits, updated_at)
    VALUES (${key}, now(), 1, now())
    ON CONFLICT (key) DO UPDATE SET
      hits = CASE
        WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
          THEN 1
        ELSE rate_limits.hits + 1
      END,
      window_start = CASE
        WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
          THEN now()
        ELSE rate_limits.window_start
      END,
      updated_at = now()
    RETURNING hits, window_start
  `);
  const row = rows[0];
  const hits = Number(row.hits);
  const windowStart = new Date(row.window_start).getTime();
  const retryAfter = Math.max(0, Math.ceil((windowStart + windowSeconds * 1000 - Date.now()) / 1000));
  return {
    allowed: hits <= limit,
    remaining: Math.max(0, limit - hits),
    retryAfterSeconds: retryAfter,
  };
}
