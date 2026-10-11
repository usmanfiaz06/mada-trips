CREATE TABLE "app_phone_code_hints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_hash" text NOT NULL,
	"wanted" text,
	"sent_via" text,
	"sent_at" timestamp with time zone,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_phone_code_hints_wanted" CHECK ("app_phone_code_hints"."wanted" IS NULL OR "app_phone_code_hints"."wanted" IN ('whatsapp', 'sms')),
	CONSTRAINT "app_phone_code_hints_sent_via" CHECK ("app_phone_code_hints"."sent_via" IS NULL OR "app_phone_code_hints"."sent_via" IN ('whatsapp', 'sms'))
);
--> statement-breakpoint
CREATE INDEX "app_phone_code_hints_phone_idx" ON "app_phone_code_hints" USING btree ("phone_hash","created_at");--> statement-breakpoint
CREATE INDEX "app_phone_code_hints_ip_idx" ON "app_phone_code_hints" USING btree ("ip_hash","created_at");