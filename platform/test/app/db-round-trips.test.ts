import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import net from "node:net";
import postgres from "postgres";

/*
 * scripts/patch-postgres.mjs: with prepare:false (the pooler), a query with plain parameters is one round trip, not
 * two. Measured through a proxy that holds every packet 60 ms each way (one round trip = 120 ms), like the far database.
 */

const DELAY = 60;
let server: net.Server;
let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const db = new URL(inject("databaseUrl"));
  const target = { port: Number(db.port), host: db.hostname };
  server = net.createServer((c) => {
    const u = net.connect(target.port, target.host);
    const pipe = (a: net.Socket, b: net.Socket) => a.on("data", (d) => setTimeout(() => b.write(d), DELAY)).on("close", () => b.destroy()).on("error", () => {});
    pipe(c, u); pipe(u, c);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  db.hostname = "127.0.0.1";
  db.port = String(port);
  sql = postgres(db.toString(), { max: 1, prepare: false, onnotice: () => {} });
  await sql`SELECT 1`; // connect first: only the queries are timed
});

afterAll(async () => {
  await sql?.end({ timeout: 1 });
  server?.close();
});

async function timed<T>(run: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const t = performance.now();
  const value = await run();
  return { ms: performance.now() - t, value };
}

describe("database round trips", () => {
  it("sends a query with plain parameters in one round trip", async () => {
    const at = new Date("2026-10-17T10:00:00Z");
    const { ms, value } = await timed(() => sql`SELECT ${"a8f7c1d2-1111-4222-8333-944455556666"}::uuid AS id, ${42} + 1 AS n, ${true} AS yes, ${at}::timestamptz AS at, ${null}::text AS none`);
    expect(value[0]).toMatchObject({ id: "a8f7c1d2-1111-4222-8333-944455556666", n: 43, yes: true, none: null });
    expect((value[0]!.at as Date).toISOString()).toBe(at.toISOString());
    expect(ms).toBeLessThan(DELAY * 2 * 1.6);
  });

  it("still asks for the types first when a parameter is an array, and writes it right", async () => {
    const { ms, value } = await timed(() => sql`SELECT 'b' = ANY(${["a", "b"]}::text[]) AS has, ${[1, 2, 3]}::int[] AS xs`);
    expect(value[0]).toMatchObject({ has: true, xs: [1, 2, 3] });
    expect(ms).toBeGreaterThanOrEqual(DELAY * 2 * 2 - 10);
  });
});
