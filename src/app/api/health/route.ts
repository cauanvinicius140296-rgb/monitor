import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

export const dynamic = "force-dynamic";

/** Verificação mínima de disponibilidade (não expõe detalhes de infraestrutura). */
export async function GET(): Promise<Response> {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
