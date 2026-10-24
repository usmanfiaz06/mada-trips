-- Corporate workspace: client companies sign in to Mada Ops and see only their own workspace.
ALTER TABLE "clients" ADD COLUMN "portal_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_color" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_logo_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_services" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_markup_bps" integer;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_terms" integer[] DEFAULT '{24,36,48}' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_hidden_vehicles" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_needs_approval" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "hidden_names" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "account_manager_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_account_manager_id_users_id_fk" FOREIGN KEY ("account_manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "client_role" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_client_idx" ON "users" USING btree ("client_id");--> statement-breakpoint
-- A client login is never a partner, and always has a client role.
ALTER TABLE "users" ADD CONSTRAINT "users_client_ok" CHECK (
  ("client_id" IS NULL AND "client_role" IS NULL)
  OR ("client_id" IS NOT NULL AND "partner_id" IS NULL AND "client_role" IN ('admin','approver','requester','viewer')));--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "portal_request_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "portal_month" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_portal_month_once" ON "bookings" USING btree ("portal_request_id","portal_month") WHERE "portal_request_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"trim" text,
	"category" text NOT NULL,
	"year" integer NOT NULL,
	"engine" text,
	"drive" text,
	"fuel" text,
	"seats" integer,
	"image" text,
	"supplier" text,
	"cost" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"on_request" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "client_vehicle_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"term" integer NOT NULL,
	"price" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_vehicle_prices" ADD CONSTRAINT "client_vehicle_prices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_vehicle_prices" ADD CONSTRAINT "client_vehicle_prices_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_vehicle_price_once" ON "client_vehicle_prices" USING btree ("client_id","vehicle_id","term");--> statement-breakpoint
CREATE TABLE "portal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"client_id" uuid NOT NULL,
	"status" text DEFAULT 'awaiting_approval' NOT NULL,
	"lines" jsonb NOT NULL,
	"term" integer NOT NULL,
	"monthly" bigint NOT NULL,
	"monthly_cost" bigint DEFAULT 0 NOT NULL,
	"delivery" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"decision_note" text,
	"months_billed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_requests_ref_unique" UNIQUE("ref"),
	CONSTRAINT "portal_requests_status_ok" CHECK ("status" IN ('awaiting_approval','submitted','confirmed','delivering','active','completed','declined','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "portal_requests" ADD CONSTRAINT "portal_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_requests" ADD CONSTRAINT "portal_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_requests" ADD CONSTRAINT "portal_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_requests" ADD CONSTRAINT "portal_requests_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_requests_client_idx" ON "portal_requests" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "portal_requests_status_idx" ON "portal_requests" USING btree ("status");--> statement-breakpoint
CREATE TABLE "portal_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"request_id" uuid,
	"author_id" uuid,
	"side" text NOT NULL,
	"kind" text DEFAULT 'message' NOT NULL,
	"body" text NOT NULL,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_messages_values_ok" CHECK ("side" IN ('client','mada','system') AND "kind" IN ('message','price','call','issue','quote','status'))
);
--> statement-breakpoint
ALTER TABLE "portal_messages" ADD CONSTRAINT "portal_messages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_messages" ADD CONSTRAINT "portal_messages_request_id_portal_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."portal_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_messages" ADD CONSTRAINT "portal_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_messages_client_idx" ON "portal_messages" USING btree ("client_id","created_at");--> statement-breakpoint
-- Client logins hold a role with no staff permissions at all; what they can do comes from client_role.
INSERT INTO "roles" ("key", "name", "name_ar", "description", "permissions", "is_system")
VALUES ('client_user', 'Corporate client', 'عميل شركة', 'People at a corporate client. They see only their own company''s workspace.', '{}', true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- The lease catalog from the September 2026 supplier quote (Theeb) and Mada's KEO quotation. Amounts in halalas per month.
INSERT INTO "vehicles" ("key","make","model","trim","category","year","engine","drive","fuel","seats","image","supplier","cost","price","on_request","sort") VALUES
('tahoe','Chevrolet','Tahoe','LS','Full-size SUV',2026,'5.3L V8','4×4','Petrol',8,'/vehicles/tahoe.png',NULL,'{}','{"24":792000,"36":653100,"48":594000}',false,10),
('highlander','Toyota','Highlander','GLE HEV','Hybrid SUV',2026,'2.5L Hybrid','4×4','Hybrid',7,'/vehicles/highlander.png','Theeb','{"12":856000,"24":586000,"36":473100,"48":436500}','{"12":856000,"24":586000,"36":473100,"48":436500}',false,20),
('fortuner','Toyota','Fortuner','GX2','Mid-size SUV',2026,'2.7L','4×4','Petrol',7,'/vehicles/fortuner.png','Theeb','{"12":700500,"24":487500,"36":401500,"48":368500}','{"12":700500,"24":487500,"36":401500,"48":368500}',false,30),
('rav4','Toyota','RAV4','LE','Compact SUV',2026,'2.0L','4×4','Petrol',5,'/vehicles/rav4.png','Theeb','{"12":579500,"24":404500,"36":330500,"48":308000}','{"12":579500,"24":404500,"36":330500,"48":308000}',false,40),
('sportage','Kia','Sportage','STD','Compact SUV',2026,'1.5L','4×2','Petrol',5,'/vehicles/sportage.png','Theeb','{"12":531000,"24":356500,"36":290500,"48":267500}','{"12":531000,"24":356500,"36":290500,"48":267500}',false,50),
('urbancruiser','Toyota','Urban Cruiser','GL','City SUV',2026,'1.5L','4×2','Petrol',5,'/vehicles/urbancruiser.png','Theeb','{"12":367100,"24":264500,"36":223000,"48":211000}','{"12":367100,"24":264500,"36":223000,"48":211000}',false,60),
('prado','Toyota','Land Cruiser Prado',NULL,'Full-size SUV',2026,NULL,'4×4',NULL,7,NULL,NULL,'{}','{}',true,70),
('suburban','Chevrolet','Suburban',NULL,'Full-size SUV',2026,NULL,'4×4',NULL,8,NULL,NULL,'{}','{}',true,80),
('everest','Ford','Everest',NULL,'Mid-size SUV',2026,NULL,'4×4',NULL,7,NULL,NULL,'{}','{}',true,90),
('explorer','Ford','Explorer',NULL,'Mid-size SUV',2026,NULL,'4×4',NULL,7,NULL,NULL,'{}','{}',true,100)
ON CONFLICT ("key") DO NOTHING;
