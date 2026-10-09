import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { alerts, offers, products, purchases, settings, shoppingListItems, shoppingLists, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { loadSettings } from "@/lib/repos/settings-repo";
import { resetData } from "./helpers";

// Mocks de infraestrutura do Next.js (os servidores de ações rodam fora de uma requisição).
// O banco, a validação e as regras de negócio continuam reais.
const h = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(public url: string) {
      super("NEXT_REDIRECT");
    }
  }
  return {
    RedirectSignal,
    currentUser: { id: "00000000-0000-4000-8000-000000000001", email: "admin@teste.local", name: "Admin", role: "admin" },
  };
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new h.RedirectSignal(url);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9" }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("@/lib/auth/session", () => ({
  SESSION_COOKIE: "radar_sessao",
  requireUser: async () => h.currentUser,
  getCurrentUser: async () => h.currentUser,
  createSession: async () => "token-de-teste",
  destroyCurrentSession: async () => {},
  hashSessionToken: (t: string) => t,
  newSessionToken: () => "token-de-teste",
}));

const {
  createProductAction,
  updateProductAction,
  setProductStatusAction,
  identifyUrlAction,
} = await import("@/app/actions/products");
const { addOfferAction, registerManualPriceAction, toggleOfferAction } = await import("@/app/actions/offers");
const { registerPurchaseAction } = await import("@/app/actions/purchases");
const { addListItemAction, setListBudgetAction, updateListItemAction, removeListItemAction } = await import(
  "@/app/actions/list"
);
const { setAlertStatusAction, markAllAlertsReadAction } = await import("@/app/actions/alerts");
const { saveSettingsAction } = await import("@/app/actions/settings");
const { loginAction } = await import("@/app/actions/auth");

const EMPTY = { ok: false, message: "" } as const;
const ADMIN_EMAIL = "admin@teste.local";
const ADMIN_PASSWORD = "senha-de-teste-123";

function fd(obj: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.set(k, v);
  return f;
}

/** Executa uma ação e devolve o estado retornado ou o caminho do redirecionamento. */
async function run(p: Promise<unknown>): Promise<{ redirect: string } | { state: { ok: boolean; message: string; errors?: Record<string, string> } }> {
  try {
    const state = (await p) as { ok: boolean; message: string; errors?: Record<string, string> };
    return { state };
  } catch (err) {
    if (err instanceof h.RedirectSignal) return { redirect: err.url };
    throw err;
  }
}

function stateOf(r: Awaited<ReturnType<typeof run>>) {
  if (!("state" in r)) throw new Error(`esperava estado, veio redirecionamento para ${r.redirect}`);
  return r.state;
}

/** Dígito verificador EAN-13 (para gerar GTINs válidos nos testes). */
function ean13(base12: string): string {
  const sum = [...base12].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return base12 + String((10 - (sum % 10)) % 10);
}

const BASE_PRODUCT = {
  category: "Eletrodomésticos",
  brand: "Exemplo",
  targetPriceCents: "300,00",
  priority: "alta",
  status: "monitorando",
};

/** Cada produto de teste recebe um modelo próprio, para não cair na checagem de marca+modelo. */
async function createProduct(name: string, extra: Record<string, string> = {}) {
  const r = await run(createProductAction(EMPTY as never, fd({ ...BASE_PRODUCT, model: name, name, ...extra })));
  if (!("redirect" in r)) throw new Error(`cadastro não redirecionou: ${JSON.stringify(r.state)}`);
  return r.redirect.replace("/produtos/", "");
}

beforeAll(async () => {
  const db = getDb();
  await db.delete(users).where(eq(users.email, ADMIN_EMAIL));
  await db.insert(users).values({
    email: ADMIN_EMAIL,
    name: "Admin",
    passwordHash: await hashPassword(ADMIN_PASSWORD),
    role: "admin",
  });
});

beforeEach(async () => {
  await resetData();
});

describe("ações de produtos", () => {
  it("rejeita cadastro sem nome com erro de campo (validação no servidor)", async () => {
    const state = stateOf(await run(createProductAction(EMPTY as never, fd({ ...BASE_PRODUCT, name: "" }))));
    expect(state.ok).toBe(false);
    expect(state.errors?.name).toBeTruthy();
    const rows = await getDb().select().from(products);
    expect(rows).toHaveLength(0);
  });

  it("cadastra produto e redireciona para a página de detalhes", async () => {
    const id = await createProduct("Air fryer 5L Ação");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const [row] = await getDb().select().from(products).where(eq(products.id, id));
    expect(row.name).toBe("Air fryer 5L Ação");
    expect(row.targetPriceCents).toBe(30000);
    expect(row.priority).toBe("alta");
  });

  it("bloqueia duplicata por GTIN até confirmação explícita", async () => {
    const gtin = ean13("789100010010");
    await createProduct("Panela de pressão 6L", { gtin });

    const dup = stateOf(await run(createProductAction(EMPTY as never, fd({ ...BASE_PRODUCT, name: "Panela outra", gtin }))));
    expect(dup.ok).toBe(false);
    expect(dup.message).toContain("Possível duplicata");

    const confirmed = await run(
      createProductAction(EMPTY as never, fd({ ...BASE_PRODUCT, name: "Panela outra", gtin, confirmDuplicate: "1" })),
    );
    expect("redirect" in confirmed).toBe(true);
    expect(await getDb().select().from(products)).toHaveLength(2);
  });

  it("não agrupa por nome semelhante: produtos com mesmo nome e GTINs diferentes coexistem", async () => {
    await createProduct("Liquidificador Potente", { gtin: ean13("789100020010"), brand: "Marca A", model: "LP-1" });
    const second = await run(
      createProductAction(
        EMPTY as never,
        fd({ ...BASE_PRODUCT, name: "Liquidificador Potente", brand: "Marca B", model: "LP-2", gtin: ean13("789100030010") }),
      ),
    );
    // Nome igual com GTIN/marca/modelo diferentes não é duplicata: cadastra direto, sem pedir confirmação.
    expect("redirect" in second).toBe(true);
    expect(await getDb().select().from(products)).toHaveLength(2);
  });

  it("atualiza produto existente", async () => {
    const id = await createProduct("Cafeteira Antiga");
    const r = await run(
      updateProductAction(id, EMPTY as never, fd({ ...BASE_PRODUCT, name: "Cafeteira Nova", notes: "editado" })),
    );
    const state = "redirect" in r ? { ok: true } : r.state;
    expect(state.ok).toBe(true);
    const [row] = await getDb().select().from(products).where(eq(products.id, id));
    expect(row.name).toBe("Cafeteira Nova");
  });

  it("altera o status do produto (monitorando → pausado → arquivado)", async () => {
    const id = await createProduct("Batedeira Status");
    const fdStatus = (status: string) => fd({ productId: id, status });
    await setProductStatusAction(fdStatus("pausado"));
    let [row] = await getDb().select().from(products).where(eq(products.id, id));
    expect(row.status).toBe("pausado");
    await setProductStatusAction(fdStatus("arquivado"));
    [row] = await getDb().select().from(products).where(eq(products.id, id));
    expect(row.status).toBe("arquivado");
  });
});

describe("segurança de URLs nas ações", () => {
  it("recusa URL apontando para rede interna ao adicionar oferta (sem SSRF)", async () => {
    const id = await createProduct("Produto SSRF");
    const state = stateOf(
      await run(addOfferAction(EMPTY as never, fd({ productId: id, url: "http://127.0.0.1:8080/admin", priceCents: "10,00" }))),
    );
    expect(state.ok).toBe(false);
    expect(await getDb().select().from(offers)).toHaveLength(0);
  });

  it("recusa URL de rede interna na identificação", async () => {
    const r = stateOf(await run(identifyUrlAction("http://localhost/x")));
    expect(r.ok).toBe(false);
  });
});

describe("ações de ofertas", () => {
  it("adiciona oferta manual, registra preço e alterna ativação", async () => {
    const productId = await createProduct("Air fryer com oferta");
    const add = stateOf(
      await run(
        addOfferAction(
          EMPTY as never,
          fd({ productId, url: "https://loja-exemplo.com.br/produto/123", priceCents: "289,90", shippingCents: "" }),
        ),
      ),
    );
    expect(add).toMatchObject({ ok: true });
    const [offer] = await getDb().select().from(offers).where(eq(offers.productId, productId));
    expect(offer.isActive).toBe(true);
    expect(offer.shippingKnown).toBe(false);

    const reg = stateOf(
      await run(registerManualPriceAction(EMPTY as never, fd({ offerId: offer.id, productId, priceCents: "275,00", shippingCents: "0", availability: "disponivel" }))),
    );
    expect(reg.ok).toBe(true);

    await toggleOfferAction(fd({ offerId: offer.id, productId, active: "0" }));
    const [after] = await getDb().select().from(offers).where(eq(offers.id, offer.id));
    expect(after.isActive).toBe(false);
  });

  it("recusa a mesma URL duas vezes para o mesmo produto", async () => {
    const productId = await createProduct("Air fryer duplicada");
    const f = () => fd({ productId, url: "https://loja-exemplo.com.br/produto/777", priceCents: "100,00" });
    expect(stateOf(await run(addOfferAction(EMPTY as never, f()))).ok).toBe(true);
    expect(stateOf(await run(addOfferAction(EMPTY as never, f()))).ok).toBe(false);
  });
});

describe("ações de compras e lista de compras", () => {
  it("registra compra com valor pago e recusa oferta de outro produto", async () => {
    const productA = await createProduct("Produto A compra");
    const productB = await createProduct("Produto B compra");
    await addOfferAction(EMPTY as never, fd({ productId: productB, url: "https://loja-exemplo.com.br/b/1", priceCents: "50,00" }));
    const [offerB] = await getDb().select().from(offers).where(eq(offers.productId, productB));

    const wrong = stateOf(
      await run(registerPurchaseAction(EMPTY as never, fd({ productId: productA, offerId: offerB.id, quantity: "1", paidUnitCents: "100,00", paidShippingCents: "0" }))),
    );
    expect(wrong.ok).toBe(false);

    const ok = stateOf(
      await run(registerPurchaseAction(EMPTY as never, fd({ productId: productA, offerId: "", quantity: "2", paidUnitCents: "450,00", paidShippingCents: "10,00" }))),
    );
    expect(ok.ok).toBe(true);
    const rows = await getDb().select().from(purchases).where(eq(purchases.productId, productA));
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(2);
  });

  it("gerencia itens da lista por cômodo, orçamento e remoção", async () => {
    const productId = await createProduct("Item da lista");
    const add = stateOf(
      await run(addListItemAction(EMPTY as never, fd({ productId, room: "Cozinha", quantity: "2", plannedUnitBudgetCents: "199,90" }))),
    );
    expect(add.ok).toBe(true);
    const dup = stateOf(
      await run(addListItemAction(EMPTY as never, fd({ productId, room: "Cozinha", quantity: "1", plannedUnitBudgetCents: "" }))),
    );
    expect(dup.ok).toBe(false);

    const [item] = await getDb().select().from(shoppingListItems);
    expect(item.room).toBe("Cozinha");
    expect(item.quantity).toBe(2);
    expect(item.plannedUnitBudgetCents).toBe(19990);

    const upd = stateOf(
      await run(updateListItemAction(EMPTY as never, fd({ id: item.id, room: "Lavanderia", quantity: "3", plannedUnitBudgetCents: "" }))),
    );
    expect(upd.ok).toBe(true);
    const [edited] = await getDb().select().from(shoppingListItems).where(eq(shoppingListItems.id, item.id));
    expect(edited.room).toBe("Lavanderia");

    const budget = stateOf(await run(setListBudgetAction(EMPTY as never, fd({ totalBudgetCents: "15.000,00" }))));
    expect(budget.ok).toBe(true);
    const [list] = await getDb().select().from(shoppingLists);
    expect(list.totalBudgetCents).toBe(1500000);

    await removeListItemAction(fd({ id: item.id }));
    expect(await getDb().select().from(shoppingListItems)).toHaveLength(0);
  });
});

describe("ações de alertas", () => {
  async function insertAlert(productId: string, title: string) {
    const [row] = await getDb()
      .insert(alerts)
      .values({ productId, type: "preco_alvo", title, message: "teste", observedPriceCents: 25000, targetPriceCents: 30000 })
      .returning({ id: alerts.id });
    return row.id;
  }

  it("marca como lido, arquiva e volta para não lido", async () => {
    const productId = await createProduct("Produto com alerta");
    const alertId = await insertAlert(productId, "Atingiu o preço-alvo");

    await setAlertStatusAction(fd({ id: alertId, status: "lido" }));
    let [row] = await getDb().select().from(alerts).where(eq(alerts.id, alertId));
    expect(row.status).toBe("lido");
    expect(row.readAt).not.toBeNull();

    await setAlertStatusAction(fd({ id: alertId, status: "arquivado" }));
    [row] = await getDb().select().from(alerts).where(eq(alerts.id, alertId));
    expect(row.status).toBe("arquivado");
    expect(row.archivedAt).not.toBeNull();

    await setAlertStatusAction(fd({ id: alertId, status: "nao_lido" }));
    [row] = await getDb().select().from(alerts).where(eq(alerts.id, alertId));
    expect(row.status).toBe("nao_lido");
    expect(row.readAt).toBeNull();
  });

  it("ignora status inválido sem alterar o alerta", async () => {
    const productId = await createProduct("Produto alerta inválido");
    const alertId = await insertAlert(productId, "Teste");
    await setAlertStatusAction(fd({ id: alertId, status: "hackeado" }));
    const [row] = await getDb().select().from(alerts).where(eq(alerts.id, alertId));
    expect(row.status).toBe("nao_lido");
  });

  it("marca todos como lidos", async () => {
    const productId = await createProduct("Produto alertas em massa");
    await insertAlert(productId, "A");
    await insertAlert(productId, "B");
    await markAllAlertsReadAction();
    const rows = await getDb().select().from(alerts);
    expect(rows.every((r) => r.status === "lido")).toBe(true);
  });
});

describe("ações de configurações", () => {
  it("recusa valores fora da faixa e salva valores válidos", async () => {
    const bad = stateOf(await run(saveSettingsAction(EMPTY as never, fd({ intervalHours: "999", batchSize: "25", referenceMode: "maior_90d" }))));
    expect(bad.ok).toBe(false);
    expect(bad.errors?.intervalHours).toBeTruthy();

    const good = stateOf(await run(saveSettingsAction(EMPTY as never, fd({ intervalHours: "12", batchSize: "25", referenceMode: "maior_90d" }))));
    expect(good.ok).toBe(true);
    const loaded = await loadSettings(getDb());
    expect(loaded.intervalHours).toBe(12);
    const rows = await getDb().select().from(settings);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("login", () => {
  it("recusa senha incorreta sem criar sessão", async () => {
    const state = stateOf(await run(loginAction(EMPTY as never, fd({ email: ADMIN_EMAIL, password: "errada" }))));
    expect(state.ok).toBe(false);
  });

  it("aceita credenciais corretas e redireciona para o painel", async () => {
    const r = await run(loginAction(EMPTY as never, fd({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })));
    expect(r).toEqual({ redirect: "/" });
  });
});
