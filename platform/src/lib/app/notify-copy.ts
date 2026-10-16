import "server-only";
import { t, type CopyKey, type Lang, type Vars } from "@mada/shared";

/*
 * An inbox line is stored as its copy keys and parameters next to the words, so the inbox renders it in whatever
 * language the reader uses at read time, not the one the sender had when it was written (the Arabic inbox used to
 * show "Mada replied" when the traveller had switched language since). The push still goes out in the words of
 * the moment: a push is only a nudge, and the inbox has the line.
 */

export type NotifyCopy = { title: [CopyKey, Vars?]; body: [CopyKey, Vars?] };

/** A parameter that is itself a copy key ("your table"), rendered in the reader's language with the line. */
export type VarRef = { k: CopyKey; v?: Vars };
export type NotifyVars = Record<string, string | number | VarRef>;
const isVarRef = (x: unknown): x is VarRef => typeof x === "object" && x !== null && typeof (x as VarRef).k === "string";
/** The parameters with any nested copy keys rendered in `locale`. */
export function resolveVars(vars: NotifyVars | Vars | undefined, locale?: Lang): Vars {
  const out: Vars = {};
  for (const [k, v] of Object.entries(vars ?? {})) out[k] = isVarRef(v) ? t(v.k, v.v, locale) : v;
  return out;
}

/** The `data` column with the copy reference folded in. */
export function withCopy(data: Record<string, unknown> | null | undefined, copy: { title: [CopyKey, (Vars | NotifyVars)?]; body: [CopyKey, (Vars | NotifyVars)?] }): Record<string, unknown> {
  return { ...(data ?? {}), copy: { title: [copy.title[0], copy.title[1] ?? {}], body: [copy.body[0], copy.body[1] ?? {}] } };
}

const isRef = (x: unknown): x is [CopyKey, NotifyVars] => Array.isArray(x) && typeof x[0] === "string" && (x[1] === undefined || (typeof x[1] === "object" && x[1] !== null));

/** The line in the reader's language when the row carries its keys; the stored words otherwise. */
export function renderNotification(row: { title: string; body: string; data: Record<string, unknown> | null }, locale: Lang): { title: string; body: string } {
  const c = (row.data?.copy ?? null) as { title?: unknown; body?: unknown } | null;
  if (!c || !isRef(c.title) || !isRef(c.body)) return { title: row.title, body: row.body };
  const render = (ref: [CopyKey, NotifyVars], fallback: string) => {
    const s = t(ref[0], resolveVars(ref[1], locale), locale);
    return s.startsWith("⟦") ? fallback : s; // a key this build doesn't know: keep the words as sent
  };
  return { title: render(c.title, row.title), body: render(c.body, row.body) };
}

/** Clipped to the lock-screen limits (COPY.md §1: title ≤ 32, body ≤ 90). */
export const clipLine = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
