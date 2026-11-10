import "server-only";
import { cache } from "react";
import { asc, eq } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";

// The company's bank accounts are data, not code: directors add them in Banks & cash and they flow to every
// picker, validation and label from this one place. Nothing about accounts is hardcoded anymore.
export type Account = { key: string; name: string; bank: string | null; iban: string | null; sort: number };

// All accounts, ordered. cache() dedupes within one request so pages/actions can call it freely.
export const listAccounts = cache(async (): Promise<Account[]> =>
  db.select({ key: schema.bankAccounts.key, name: schema.bankAccounts.name, bank: schema.bankAccounts.bank, iban: schema.bankAccounts.iban, sort: schema.bankAccounts.sort })
    .from(schema.bankAccounts).orderBy(asc(schema.bankAccounts.sort), asc(schema.bankAccounts.name)));

// Options for a <Select> / picker: { value: key, label: display name }.
export const accountOptions = cache(async () => (await listAccounts()).map((a) => ({ value: a.key, label: a.name })));

// key → display name, for labelling a stored account key.
export const accountNames = cache(async (): Promise<Record<string, string>> =>
  Object.fromEntries((await listAccounts()).map((a) => [a.key, a.name])));

export async function isValidAccount(key: string): Promise<boolean> {
  return (await listAccounts()).some((a) => a.key === key);
}

// The default / primary account (lowest sort) — used when a submitted value is missing or invalid.
export async function primaryAccountKey(): Promise<string> {
  return (await listAccounts())[0]?.key ?? "retail";
}

// Display name within a transaction (sees rows written in the same tx). Falls back to the key.
export async function accountNameTx(q: Tx | typeof db, key: string): Promise<string> {
  const [a] = await q.select({ name: schema.bankAccounts.name }).from(schema.bankAccounts).where(eq(schema.bankAccounts.key, key));
  return a?.name ?? key;
}

// A stable, unique, lowercase key derived from the account name (e.g. "Alrajhi (B2B)" → "alrajhi_b2b").
export async function uniqueAccountKey(name: string): Promise<string> {
  const base = (name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32)) || "account";
  const taken = new Set((await db.select({ key: schema.bankAccounts.key }).from(schema.bankAccounts)).map((a) => a.key));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
  return `${base}_${Date.now()}`;
}
