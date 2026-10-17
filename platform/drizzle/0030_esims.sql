CREATE TABLE "app_esims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"trip_id" uuid,
	"traveller_id" uuid,
	"supplier" text NOT NULL,
	"package_id" text NOT NULL,
	"plan" jsonb NOT NULL,
	"net_usd_cents" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"supplier_order_id" text,
	"iccid" text,
	"install" jsonb,
	"usage" jsonb,
	"usage_checked_at" timestamp with time zone,
	"topups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb,
	"problem" text,
	"installed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_esims" ADD CONSTRAINT "app_esims_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_esims" ADD CONSTRAINT "app_esims_order_id_app_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."app_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_esims" ADD CONSTRAINT "app_esims_trip_id_app_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."app_trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_esims" ADD CONSTRAINT "app_esims_traveller_id_app_people_id_fk" FOREIGN KEY ("traveller_id") REFERENCES "public"."app_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_esims_order_idx_key" ON "app_esims" USING btree ("order_id","idx");--> statement-breakpoint
CREATE UNIQUE INDEX "app_esims_iccid_key" ON "app_esims" USING btree ("iccid") WHERE "app_esims"."iccid" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "app_esims_owner_idx" ON "app_esims" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "app_esims_trip_idx" ON "app_esims" USING btree ("trip_id");