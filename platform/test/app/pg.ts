/*
 * A throwaway Postgres for tests. Uses TEST_DATABASE_URL when set (CI service container); otherwise starts a private
 * cluster in a temp folder with the local Postgres binaries (initdb + pg_ctl), on a free port, and removes it afterwards.
 * Runs the server as the "postgres" OS user when the tests run as root (initdb refuses root).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chownSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

function pgBin(): string {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const base = "/usr/lib/postgresql";
  if (existsSync(base)) {
    const versions = readdirSync(base).filter((v) => existsSync(join(base, v, "bin", "initdb"))).sort((a, b) => Number(b) - Number(a));
    if (versions[0]) return join(base, versions[0], "bin");
  }
  try {
    return execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("No Postgres found. Install Postgres 16, set PG_BIN, or set TEST_DATABASE_URL.");
  }
}

const freePort = () => new Promise<number>((res, rej) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => { const a = s.address(); s.close(() => (a && typeof a === "object" ? res(a.port) : rej(new Error("no port")))); });
});

export async function startCluster(): Promise<{ url: string; stop: () => void }> {
  const bin = pgBin();
  const dir = mkdtempSync(join(tmpdir(), "mada-pg-"));
  const data = join(dir, "data");
  const asRoot = process.getuid?.() === 0;
  if (asRoot) {
    const id = execFileSync("id", ["-u", "postgres"], { encoding: "utf8" }).trim();
    const gid = execFileSync("id", ["-g", "postgres"], { encoding: "utf8" }).trim();
    chownSync(dir, Number(id), Number(gid));
  }
  const run = (cmd: string, args: string[]) => {
    const full = asRoot ? ["runuser", ["-u", "postgres", "--", join(bin, cmd), ...args]] as const : [join(bin, cmd), args] as const;
    const r = spawnSync(full[0], full[1] as string[], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr || r.stdout}`);
  };
  run("initdb", ["-D", data, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--no-sync", "--no-instructions"]);
  const port = await freePort();
  run("pg_ctl", ["-D", data, "-l", join(dir, "log"), "-w", "-o", `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`, "start"]);
  return {
    url: `postgres://postgres@127.0.0.1:${port}/postgres`,
    stop: () => {
      try { run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]); } finally { rmSync(dir, { recursive: true, force: true }); }
    },
  };
}
