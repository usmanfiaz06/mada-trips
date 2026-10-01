CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account" text NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"counterparty" text,
	"note" text,
	"txn_date" date NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_txn_account_idx" ON "bank_transactions" USING btree ("account");--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_txn_ok" CHECK ("amount" > 0 AND "direction" IN ('in','out')) NOT VALID;
