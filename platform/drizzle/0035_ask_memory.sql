CREATE TABLE "app_ask_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"source" text DEFAULT 'chat' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app_ask_threads" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "app_ask_threads" ADD COLUMN "folded_turns" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_ask_memory" ADD CONSTRAINT "app_ask_memory_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_ask_memory_owner_idx" ON "app_ask_memory" USING btree ("owner_id","created_at");