import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, resetData } from "./helpers";
import { consumeRateLimit } from "@/lib/rate-limit";
import { saveSettingsPatch, loadSettings } from "@/lib/repos/settings-repo";
import { GET as cronGet, POST as cronPost } from "@/app/api/cron/monitor/route";
import { GET as healthGet } from "@/app/api/health/route";
import { products, monitoringRuns } from "@/db/schema";
import { insertProduct } from "@/lib/services/products";
import { productInput } from "./helpers";

const CRON_URL = "http://localhost:3000/api/cron/monitor";
const SECRET = process.env.CRON_SECRET as string;

beforeEach(async () => {
  await resetData();
});

describe("endpoint do agendador (protegido por segredo)", () => {
  it("sem Authorization responde 401 e não executa coleta", async () => {
    const res = await cronGet(new Request(CRON_URL));
    expect(res.status).toBe(401);
    const runs = await getDb().select().from(monitoringRuns);
    expect(runs).toHaveLength(0);
  });

  it("segredo errado responde 401 (também em POST)", async () => {
    const headers = { authorization: "Bearer segredo-errado-que-nao-confere-com-nada" };
    expect((await cronGet(new Request(CRON_URL, { headers }))).status).toBe(401);
    expect((await cronPost(new Request(CRON_URL, { method: "POST", headers }))).status).toBe(401);
  });

  it("segredo correto executa a coleta do servidor e responde com o resumo", async () => {
    const res = await cronGet(new Request(CRON_URL, { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(["concluido", "ignorado", "parcial", "falhou"]).toContain(body.status);
    const runs = await getDb().select().from(monitoringRuns).where(eq(monitoringRuns.trigger, "cron"));
    expect(runs.length).toBeGreaterThanOrEqual(1);
  });

  it("não expõe detalhes internos nos erros", async () => {
    const res = await cronGet(new Request(CRON_URL, { headers: { authorization: "Bearer x" } }));
    const text = await res.text();
    expect(text).not.toContain("postgres");
    expect(text).not.toContain("SESSION_SECRET");
  });
});

describe("saúde e limites", () => {
  it("healthcheck público responde sem dados sensíveis", async () => {
    const res = await healthGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("limite de requisições bloqueia após o máximo na janela", async () => {
    const key = `teste:${Date.now()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consumeRateLimit(key, 3, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3].retryAfterSeconds).toBeGreaterThan(0);
  });

  it("a trava de chave do limite é independente por chave", async () => {
    const a = await consumeRateLimit(`a:${Date.now()}`, 1, 60);
    const b = await consumeRateLimit(`b:${Date.now()}`, 1, 60);
    expect(a.allowed && b.allowed).toBe(true);
  });
});

describe("configurações persistidas", () => {
  it("salva e relê valores do banco (sobrepõem o padrão)", async () => {
    await saveSettingsPatch({ batchSize: 33, referenceMode: "primeiro_observado" });
    const s = await loadSettings(getDb());
    expect(s.batchSize).toBe(33);
    expect(s.referenceMode).toBe("primeiro_observado");
  });
});

describe("produtos: integridade no banco", () => {
  it("cadastro não cria produto com status fora do conjunto permitido", async () => {
    const db = getDb();
    await insertProduct(db, productInput());
    const rows = await db.select().from(products);
    expect(rows.every((r) => ["monitorando", "comprado", "pausado", "arquivado"].includes(r.status))).toBe(true);
  });
});
