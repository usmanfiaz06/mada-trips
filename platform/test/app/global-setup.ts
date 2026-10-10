import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { TestProject } from "vitest/node";
import { startCluster } from "./pg";

declare module "vitest" {
  export interface ProvidedContext { databaseUrl: string }
}

/* One fresh database per test run, built only by the real migrations in drizzle/ (Ops and app alike). */
export default async function setup(project: TestProject) {
  let base = process.env.TEST_DATABASE_URL;
  let stopCluster: (() => void) | null = null;
  if (!base) ({ url: base, stop: stopCluster } = await startCluster());

  const name = `mada_test_${Date.now().toString(36)}_${process.pid}`;
  const admin = postgres(base, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${name}`);
  const url = new URL(base);
  url.pathname = `/${name}`;

  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  await sql.end();
  project.provide("databaseUrl", url.toString());

  return async () => {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
    await admin.end();
    stopCluster?.();
  };
}
