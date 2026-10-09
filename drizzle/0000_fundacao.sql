CREATE TYPE "public"."alert_status" AS ENUM('nao_lido', 'lido', 'arquivado');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('preco_alvo', 'orcamento', 'queda_percentual', 'menor_preco_observado', 'oportunidade_outra_loja');--> statement-breakpoint
CREATE TYPE "public"."availability" AS ENUM('disponivel', 'indisponivel', 'desconhecido');--> statement-breakpoint
CREATE TYPE "public"."collection_status" AS ENUM('sucesso', 'erro');--> statement-breakpoint
CREATE TYPE "public"."integration_mode" AS ENUM('api', 'manual', 'pendente');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('confirmado', 'pendente', 'divergente');--> statement-breakpoint
CREATE TYPE "public"."offer_source" AS ENUM('api', 'manual', 'demo');--> statement-breakpoint
CREATE TYPE "public"."product_priority" AS ENUM('alta', 'media', 'baixa');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('monitorando', 'comprado', 'pausado', 'arquivado');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('executando', 'concluido', 'parcial', 'falhou', 'ignorado');--> statement-breakpoint
CREATE TYPE "public"."run_trigger" AS ENUM('cron', 'manual');--> statement-breakpoint
CREATE TABLE "alert_states" (
	"product_id" uuid NOT NULL,
	"type" "alert_type" NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"last_alert_price_cents" integer,
	"last_evaluated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_states_product_id_type_pk" PRIMARY KEY("product_id","type")
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"offer_id" uuid,
	"store_id" uuid,
	"run_id" uuid,
	"type" "alert_type" NOT NULL,
	"status" "alert_status" DEFAULT 'nao_lido' NOT NULL,
	"title" varchar(240) NOT NULL,
	"message" text NOT NULL,
	"observed_price_cents" integer,
	"target_price_cents" integer,
	"reference_price_cents" integer,
	"offer_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(60) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"locked_until" timestamp with time zone,
	"locked_by" varchar(120),
	"last_started_at" timestamp with time zone,
	"last_finished_at" timestamp with time zone,
	"last_status" "run_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"trigger" "run_trigger" NOT NULL,
	"product_id" uuid,
	"status" "run_status" DEFAULT 'executando' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"offers_selected" integer DEFAULT 0 NOT NULL,
	"offers_ok" integer DEFAULT 0 NOT NULL,
	"offers_failed" integer DEFAULT 0 NOT NULL,
	"alerts_created" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"url" text NOT NULL,
	"external_id" varchar(80),
	"dedupe_key" varchar(400) NOT NULL,
	"title" varchar(300),
	"image_url" text,
	"seller_name" varchar(160),
	"current_price_cents" integer,
	"current_shipping_cents" integer,
	"shipping_known" boolean DEFAULT false NOT NULL,
	"current_availability" "availability" DEFAULT 'desconhecido' NOT NULL,
	"source" "offer_source" DEFAULT 'manual' NOT NULL,
	"match_status" "match_status" DEFAULT 'pendente' NOT NULL,
	"match_notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"offer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"run_id" uuid,
	"status" "collection_status" NOT NULL,
	"price_cents" integer,
	"shipping_cents" integer,
	"shipping_known" boolean DEFAULT false NOT NULL,
	"total_cents" integer,
	"availability" "availability" DEFAULT 'desconhecido' NOT NULL,
	"source" varchar(40) NOT NULL,
	"error_code" varchar(60),
	"error_message" text,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(240) NOT NULL,
	"category" varchar(80) DEFAULT 'Outros' NOT NULL,
	"subcategory" varchar(80),
	"brand" varchar(120),
	"model" varchar(160),
	"manufacturer_code" varchar(120),
	"gtin" varchar(14),
	"image_url" text,
	"reference_url" text,
	"target_price_cents" integer,
	"max_budget_cents" integer,
	"reference_price_cents" integer,
	"notes" text,
	"priority" "product_priority" DEFAULT 'media' NOT NULL,
	"status" "product_status" DEFAULT 'monitorando' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"offer_id" uuid,
	"store_id" uuid,
	"quantity" integer DEFAULT 1 NOT NULL,
	"paid_unit_cents" integer NOT NULL,
	"paid_shipping_cents" integer DEFAULT 0 NOT NULL,
	"reference_unit_cents" integer,
	"reference_kind" varchar(40),
	"realized_saving_cents" integer,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" varchar(200) PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"room" varchar(40) DEFAULT 'Outros' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"planned_unit_budget_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) DEFAULT 'Minha Lista de Compras' NOT NULL,
	"total_budget_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"adapter_key" varchar(60),
	"integration_mode" "integration_mode" DEFAULT 'manual' NOT NULL,
	"automated" boolean DEFAULT false NOT NULL,
	"integration_note" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(120),
	"password_hash" text NOT NULL,
	"role" varchar(20) DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_states" ADD CONSTRAINT "alert_states_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_run_id_monitoring_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."monitoring_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD CONSTRAINT "monitoring_runs_job_id_monitoring_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."monitoring_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD CONSTRAINT "monitoring_runs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_run_id_monitoring_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."monitoring_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_list_id_shopping_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."shopping_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_status_created_idx" ON "alerts" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "alerts_product_type_idx" ON "alerts" USING btree ("product_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_jobs_name_uq" ON "monitoring_jobs" USING btree ("name");--> statement-breakpoint
CREATE INDEX "monitoring_runs_started_idx" ON "monitoring_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_product_dedupe_uq" ON "offers" USING btree ("product_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "offers_product_idx" ON "offers" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "offers_store_idx" ON "offers" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "offers_due_idx" ON "offers" USING btree ("is_active","last_checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_history_offer_run_uq" ON "price_history" USING btree ("offer_id","run_id") WHERE "price_history"."run_id" is not null;--> statement-breakpoint
CREATE INDEX "price_history_product_time_idx" ON "price_history" USING btree ("product_id","collected_at");--> statement-breakpoint
CREATE INDEX "price_history_offer_time_idx" ON "price_history" USING btree ("offer_id","collected_at");--> statement-breakpoint
CREATE INDEX "price_history_store_time_idx" ON "price_history" USING btree ("store_id","collected_at");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "products_gtin_idx" ON "products" USING btree ("gtin");--> statement-breakpoint
CREATE INDEX "products_brand_model_idx" ON "products" USING btree ("brand","model");--> statement-breakpoint
CREATE INDEX "purchases_product_idx" ON "purchases" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_items_list_product_uq" ON "shopping_list_items" USING btree ("list_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stores_slug_uq" ON "stores" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));