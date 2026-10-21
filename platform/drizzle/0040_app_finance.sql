CREATE TABLE "app_order_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid,
	"request_id" uuid,
	"line_key" text NOT NULL,
	"product" text NOT NULL,
	"label" text NOT NULL,
	"supplier" text,
	"supplier_ref" text,
	"sell" bigint NOT NULL,
	"vat" bigint DEFAULT 0 NOT NULL,
	"net_amount" text DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"fx_rate" text DEFAULT '1' NOT NULL,
	"net_sar" bigint DEFAULT 0 NOT NULL,
	"basis" text DEFAULT 'estimated' NOT NULL,
	"business_date" date NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_recon_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"source" text NOT NULL,
	"file_name" text,
	"period_from" date,
	"period_to" date,
	"rows" integer DEFAULT 0 NOT NULL,
	"matched" integer DEFAULT 0 NOT NULL,
	"mismatched" integer DEFAULT 0 NOT NULL,
	"fees" bigint DEFAULT 0 NOT NULL,
	"imported_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_recon_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"provider_ref" text,
	"refund_ref" text,
	"amount" bigint DEFAULT 0 NOT NULL,
	"ours" bigint,
	"fee" bigint DEFAULT 0 NOT NULL,
	"settled_on" date,
	"status" text NOT NULL,
	"payment_id" uuid,
	"refund_id" uuid,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_refunds" ADD COLUMN "requested_amount" bigint;--> statement-breakpoint
ALTER TABLE "app_refunds" ADD COLUMN "origin" text DEFAULT 'traveller' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_refunds" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "app_refunds" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "app_refunds" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_refunds" ADD COLUMN "approval_id" uuid;--> statement-breakpoint
ALTER TABLE "app_refunds" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_refunds" ADD COLUMN "checks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_refunds" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_refunds" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_refunds" ADD COLUMN "ops_payment_id" uuid;--> statement-breakpoint
ALTER TABLE "app_order_costs" ADD CONSTRAINT "app_order_costs_payment_id_app_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."app_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_order_costs" ADD CONSTRAINT "app_order_costs_order_id_app_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."app_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_order_costs" ADD CONSTRAINT "app_order_costs_request_id_app_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."app_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_order_costs" ADD CONSTRAINT "app_order_costs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_recon_imports" ADD CONSTRAINT "app_recon_imports_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_recon_rows" ADD CONSTRAINT "app_recon_rows_import_id_app_recon_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."app_recon_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_recon_rows" ADD CONSTRAINT "app_recon_rows_payment_id_app_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."app_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_recon_rows" ADD CONSTRAINT "app_recon_rows_refund_id_app_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."app_refunds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_order_costs_line_key" ON "app_order_costs" USING btree ("payment_id","line_key");--> statement-breakpoint
CREATE INDEX "app_order_costs_day_idx" ON "app_order_costs" USING btree ("business_date","product");--> statement-breakpoint
CREATE INDEX "app_recon_imports_created_idx" ON "app_recon_imports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "app_recon_rows_import_idx" ON "app_recon_rows" USING btree ("import_id","status");--> statement-breakpoint
CREATE INDEX "app_recon_rows_payment_idx" ON "app_recon_rows" USING btree ("payment_id");--> statement-breakpoint
ALTER TABLE "app_refunds" ADD CONSTRAINT "app_refunds_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_refunds" ADD CONSTRAINT "app_refunds_ops_payment_id_payments_id_fk" FOREIGN KEY ("ops_payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_refunds_stage_idx" ON "app_refunds" USING btree ("stage","updated_at");