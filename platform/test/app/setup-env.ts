import { afterAll, inject } from "vitest";

// Before any test file imports @/db (which reads DATABASE_URL once).
process.env.DATABASE_URL = inject("databaseUrl");
process.env.APP_JWT_SECRET = "test-secret-for-the-mada-core-api-0123456789";
process.env.APP_DATA_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.SUPPLIER_MODE = "mock";
process.env.SUPPLIER_MODE_FLIGHT_POSITIONS = "mock";

afterAll(async () => {
  const { sql } = await import("@/db");
  await sql.end({ timeout: 5 });
});
