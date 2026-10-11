-- One OpenStreetMap object can belong to two nearby cities (Riyadh and Diriyah): key app_activities by city and id.
ALTER TABLE "app_activities" DROP CONSTRAINT "app_activities_pkey";--> statement-breakpoint
ALTER TABLE "app_activities" ADD CONSTRAINT "app_activities_pk" PRIMARY KEY("place_id","id");
