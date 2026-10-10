import { defineConfig } from "drizzle-kit";

// Mada Ops tables live in schema.ts; the Mada Trips app's tables (all prefixed app_) in app-schema.ts.
// Both generate into the same drizzle/ folder and run through the same migrator.
export default defineConfig({
  schema: ["./src/db/schema.ts", "./src/db/app-schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://mada:mada@localhost:5432/mada_ops" },
});
