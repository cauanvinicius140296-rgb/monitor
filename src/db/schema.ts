/**
 * Modelo de dados do Radar de Preços (PostgreSQL + Drizzle ORM).
 *
 * Convenções:
 * - Valores monetários são armazenados em CENTAVOS (inteiros) para evitar erros de ponto flutuante.
 * - Datas são `timestamptz` (UTC) com `created_at` / `updated_at`.
 * - `price_history` é append-only: nunca sobrescrevemos observações.
 * - Unicidades de coleta (offer_id + run_id) impedem gravar a mesma coleta duas vezes.
 */
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------- enums
export const productPriorityEnum = pgEnum("product_priority", ["alta", "media", "baixa"]);
export const productStatusEnum = pgEnum("product_status", [
  "monitorando",
  "comprado",
  "pausado",
  "arquivado",
]);
export const integrationModeEnum = pgEnum("integration_mode", ["api", "manual", "pendente"]);
export const offerSourceEnum = pgEnum("offer_source", ["api", "manual", "demo"]);
export const matchStatusEnum = pgEnum("match_status", ["confirmado", "pendente", "divergente"]);
export const availabilityEnum = pgEnum("availability", ["disponivel", "indisponivel", "desconhecido"]);
export const collectionStatusEnum = pgEnum("collection_status", ["sucesso", "erro"]);
export const runTriggerEnum = pgEnum("run_trigger", ["cron", "manual"]);
export const runStatusEnum = pgEnum("run_status", [
  "executando",
  "concluido",
  "parcial",
  "falhou",
  "ignorado",
]);
export const alertTypeEnum = pgEnum("alert_type", [
  "preco_alvo",
  "orcamento",
  "queda_percentual",
  "menor_preco_observado",
  "oportunidade_outra_loja",
]);
export const alertStatusEnum = pgEnum("alert_status", ["nao_lido", "lido", "arquivado"]);

// ---------------------------------------------------------------- autenticação
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 120 }),
    passwordHash: text("password_hash").notNull(),
    role: varchar("role", { length: 20 }).notNull().default("admin"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 do token de sessão. O token bruto fica somente no cookie do navegador. */
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

/** Contadores de rate limiting por janela fixa (funciona em serverless, pois o estado fica no banco). */
export const rateLimits = pgTable("rate_limits", {
  key: varchar("key", { length: 200 }).primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  hits: integer("hits").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Configurações editáveis (limites, regras de alerta, política de referência). */
export const settings = pgTable("settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------- lojas e fontes
export const stores = pgTable(
  "stores",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: varchar("slug", { length: 60 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    /** Domínios reconhecidos para identificar URLs da loja (ex.: mercadolivre.com.br). */
    domains: text("domains").array().notNull().default(sql`'{}'::text[]`),
    /** Chave do adaptador em src/lib/adapters/registry.ts; null = apenas cadastro manual. */
    adapterKey: varchar("adapter_key", { length: 60 }),
    integrationMode: integrationModeEnum("integration_mode").notNull().default("manual"),
    /** Se verdadeiro, o agendador pode consultar esta loja automaticamente. */
    automated: boolean("automated").notNull().default(false),
    /** Documentação do requisito pendente (credenciais, programa de parceiros etc.). */
    integrationNote: text("integration_note"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("stores_slug_uq").on(t.slug)],
);

// ---------------------------------------------------------------- produtos
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 240 }).notNull(),
    category: varchar("category", { length: 80 }).notNull().default("Outros"),
    subcategory: varchar("subcategory", { length: 80 }),
    brand: varchar("brand", { length: 120 }),
    model: varchar("model", { length: 160 }),
    /** Código exato do fabricante (SKU / part number). */
    manufacturerCode: varchar("manufacturer_code", { length: 120 }),
    /** EAN/GTIN (8, 12, 13 ou 14 dígitos). */
    gtin: varchar("gtin", { length: 14 }),
    imageUrl: text("image_url"),
    referenceUrl: text("reference_url"),
    targetPriceCents: integer("target_price_cents"),
    maxBudgetCents: integer("max_budget_cents"),
    /** Preço de referência informado pelo usuário (ex.: preço "normal" antes da promoção). */
    referencePriceCents: integer("reference_price_cents"),
    notes: text("notes"),
    priority: productPriorityEnum("priority").notNull().default("media"),
    status: productStatusEnum("status").notNull().default("monitorando"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("products_status_idx").on(t.status),
    index("products_category_idx").on(t.category),
    index("products_gtin_idx").on(t.gtin),
    index("products_brand_model_idx").on(t.brand, t.model),
  ],
);

/** Oferta = um anúncio de uma loja associado a um produto. */
export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    url: text("url").notNull(),
    /** ID do anúncio na loja (ex.: MLB1234567890). */
    externalId: varchar("external_id", { length: 80 }),
    /** Chave de deduplicação: loja + ID do anúncio (ou URL normalizada). Única por produto. */
    dedupeKey: varchar("dedupe_key", { length: 400 }).notNull(),
    title: varchar("title", { length: 300 }),
    imageUrl: text("image_url"),
    sellerName: varchar("seller_name", { length: 160 }),
    currentPriceCents: integer("current_price_cents"),
    currentShippingCents: integer("current_shipping_cents"),
    shippingKnown: boolean("shipping_known").notNull().default(false),
    currentAvailability: availabilityEnum("current_availability").notNull().default("desconhecido"),
    source: offerSourceEnum("source").notNull().default("manual"),
    matchStatus: matchStatusEnum("match_status").notNull().default("pendente"),
    matchNotes: text("match_notes"),
    isActive: boolean("is_active").notNull().default(true),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("offers_product_dedupe_uq").on(t.productId, t.dedupeKey),
    index("offers_product_idx").on(t.productId),
    index("offers_store_idx").on(t.storeId),
    index("offers_due_idx").on(t.isActive, t.lastCheckedAt),
  ],
);

/**
 * Histórico de observações (append-only).
 * Cada linha pertence a uma coleta (run). A unicidade (offer_id, run_id) garante que
 * uma mesma execução não grave duas vezes a mesma oferta.
 */
export const priceHistory = pgTable(
  "price_history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    runId: uuid("run_id").references(() => monitoringRuns.id, { onDelete: "set null" }),
    status: collectionStatusEnum("status").notNull(),
    priceCents: integer("price_cents"),
    shippingCents: integer("shipping_cents"),
    shippingKnown: boolean("shipping_known").notNull().default(false),
    /** Preço + frete, apenas quando o frete for conhecido. */
    totalCents: integer("total_cents"),
    availability: availabilityEnum("availability").notNull().default("desconhecido"),
    source: varchar("source", { length: 40 }).notNull(),
    errorCode: varchar("error_code", { length: 60 }),
    errorMessage: text("error_message"),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("price_history_offer_run_uq")
      .on(t.offerId, t.runId)
      .where(sql`${t.runId} is not null`),
    index("price_history_product_time_idx").on(t.productId, t.collectedAt),
    index("price_history_offer_time_idx").on(t.offerId, t.collectedAt),
    index("price_history_store_time_idx").on(t.storeId, t.collectedAt),
  ],
);

// ---------------------------------------------------------------- monitoramento
/** Definição e trava (lock) de cada job de monitoramento. */
export const monitoringJobs = pgTable(
  "monitoring_jobs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 60 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** Trava: enquanto locked_until > now(), nenhuma outra execução inicia. */
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lockedBy: varchar("locked_by", { length: 120 }),
    lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
    lastFinishedAt: timestamp("last_finished_at", { withTimezone: true }),
    lastStatus: runStatusEnum("last_status"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("monitoring_jobs_name_uq").on(t.name)],
);

/** Registro de cada execução (lote), para diagnóstico e auditoria. */
export const monitoringRuns = pgTable(
  "monitoring_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    jobId: uuid("job_id").references(() => monitoringJobs.id, { onDelete: "set null" }),
    trigger: runTriggerEnum("trigger").notNull(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    status: runStatusEnum("status").notNull().default("executando"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    offersSelected: integer("offers_selected").notNull().default(0),
    offersOk: integer("offers_ok").notNull().default(0),
    offersFailed: integer("offers_failed").notNull().default(0),
    alertsCreated: integer("alerts_created").notNull().default(0),
    errorSummary: text("error_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("monitoring_runs_started_idx").on(t.startedAt)],
);

// ---------------------------------------------------------------- alertas
export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    offerId: uuid("offer_id").references(() => offers.id, { onDelete: "set null" }),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => monitoringRuns.id, { onDelete: "set null" }),
    type: alertTypeEnum("type").notNull(),
    status: alertStatusEnum("status").notNull().default("nao_lido"),
    title: varchar("title", { length: 240 }).notNull(),
    message: text("message").notNull(),
    observedPriceCents: integer("observed_price_cents"),
    targetPriceCents: integer("target_price_cents"),
    referencePriceCents: integer("reference_price_cents"),
    offerUrl: text("offer_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("alerts_status_created_idx").on(t.status, t.createdAt),
    index("alerts_product_type_idx").on(t.productId, t.type),
  ],
);

/**
 * Estado atual de cada regra por produto. Permite registrar transições
 * (falso -> verdadeiro) e evitar alertas repetidos a cada coleta.
 */
export const alertStates = pgTable(
  "alert_states",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    type: alertTypeEnum("type").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    lastAlertPriceCents: integer("last_alert_price_cents"),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.type] })],
);

// ---------------------------------------------------------------- lista e compras
export const shoppingLists = pgTable("shopping_lists", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 120 }).notNull().default("Minha Lista de Compras"),
  /** Orçamento total informado pelo usuário (centavos). */
  totalBudgetCents: integer("total_budget_cents"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shoppingListItems = pgTable(
  "shopping_list_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    listId: uuid("list_id")
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    room: varchar("room", { length: 40 }).notNull().default("Outros"),
    quantity: integer("quantity").notNull().default(1),
    /** Orçamento unitário planejado para o item (se vazio, usa o orçamento máximo do produto). */
    plannedUnitBudgetCents: integer("planned_unit_budget_cents"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("shopping_items_list_product_uq").on(t.listId, t.productId)],
);

/** Compras realizadas. Economia realizada = (referência - pago) x quantidade. */
export const purchases = pgTable(
  "purchases",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    offerId: uuid("offer_id").references(() => offers.id, { onDelete: "set null" }),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "set null" }),
    quantity: integer("quantity").notNull().default(1),
    paidUnitCents: integer("paid_unit_cents").notNull(),
    paidShippingCents: integer("paid_shipping_cents").notNull().default(0),
    referenceUnitCents: integer("reference_unit_cents"),
    referenceKind: varchar("reference_kind", { length: 40 }),
    realizedSavingCents: integer("realized_saving_cents"),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("purchases_product_idx").on(t.productId)],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Offer = typeof offers.$inferSelect;
export type Store = typeof stores.$inferSelect;
export type PriceHistoryRow = typeof priceHistory.$inferSelect;
export type MonitoringRun = typeof monitoringRuns.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type ShoppingListItem = typeof shoppingListItems.$inferSelect;
export type Purchase = typeof purchases.$inferSelect;
