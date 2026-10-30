ALTER TABLE "app_refunds" ADD COLUMN "bank_reference" text;--> statement-breakpoint
ALTER TABLE "app_refunds" ADD COLUMN "auto_rule" text;--> statement-breakpoint
ALTER TABLE "app_refund_groups" ADD COLUMN "bank_reference" text;--> statement-breakpoint
ALTER TABLE "app_refund_groups" ADD COLUMN "auto" boolean DEFAULT false NOT NULL;
