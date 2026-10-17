CREATE TABLE "app_esim_catalogue" (
	"package_id" text PRIMARY KEY NOT NULL,
	"supplier" text NOT NULL,
	"pkg" jsonb NOT NULL,
	"coverage_code" text NOT NULL,
	"gb" real,
	"days" integer NOT NULL,
	"daily" boolean DEFAULT false NOT NULL,
	"cost_e4" integer NOT NULL,
	"retail_e4" integer,
	"prev_cost_e4" integer,
	"cost_changed_at" timestamp with time zone,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_esim_price_holds" (
	"owner_id" uuid NOT NULL,
	"package_id" text NOT NULL,
	"price" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "app_esim_price_holds_owner_id_package_id_pk" PRIMARY KEY("owner_id","package_id")
);
--> statement-breakpoint
CREATE TABLE "app_esim_webhooks" (
	"notify_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_esims" ADD COLUMN "supplier_ref" text;--> statement-breakpoint
ALTER TABLE "app_esims" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_esim_price_holds" ADD CONSTRAINT "app_esim_price_holds_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_esim_catalogue_code_idx" ON "app_esim_catalogue" USING btree ("coverage_code");