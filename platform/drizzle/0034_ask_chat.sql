CREATE TABLE "app_ask_spend" (
	"day" date NOT NULL,
	"owner_key" text NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "app_ask_spend_day_owner_key_pk" PRIMARY KEY("day","owner_key")
);
--> statement-breakpoint
CREATE TABLE "app_ask_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_ask_threads" ADD CONSTRAINT "app_ask_threads_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_ask_threads_owner_idx" ON "app_ask_threads" USING btree ("owner_id","updated_at");