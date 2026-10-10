-- Resilience (src/db/app-schema-resilience.ts). Pending: the lead folds this into one generated migration.
CREATE TABLE IF NOT EXISTS "app_idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_hash" text NOT NULL,
	"state" text DEFAULT 'running' NOT NULL,
	"response_status" integer,
	"response_body" text,
	"response_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "app_idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_idempotency_expires_idx" ON "app_idempotency_keys" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_supplier_health" (
	"name" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"last_problem" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_runtime" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
