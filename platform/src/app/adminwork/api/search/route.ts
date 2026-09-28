import { NextResponse } from "next/server";
import { desc, ilike, or, eq, and } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json([], { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json([]);
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const seeAll = u.permissions.has("sales.view_all");
  const [bookings, clients, expenses] = await Promise.all([
    db.select({ id: schema.bookings.id, ref: schema.bookings.ref, pax: schema.bookings.passengers, pnr: schema.bookings.pnr })
      .from(schema.bookings)
      .where(and(or(ilike(schema.bookings.ref, like), ilike(schema.bookings.pnr, like), ilike(schema.bookings.passengers, like), ilike(schema.bookings.ticketNumbers, like)),
        seeAll ? undefined : eq(schema.bookings.preparedBy, u.id)))
      .orderBy(desc(schema.bookings.createdAt)).limit(6),
    db.select({ id: schema.clients.id, name: schema.clients.name, type: schema.clients.type }).from(schema.clients)
      .where(or(ilike(schema.clients.name, like), ilike(schema.clients.phone, like))).limit(5),
    u.permissions.has("expenses.view_all") || u.permissions.has("expenses.create")
      ? db.select({ id: schema.expenses.id, ref: schema.expenses.ref, d: schema.expenses.description }).from(schema.expenses)
        .where(and(or(ilike(schema.expenses.ref, like), ilike(schema.expenses.description, like)), u.permissions.has("expenses.view_all") ? undefined : eq(schema.expenses.submittedBy, u.id))).limit(4)
      : Promise.resolve([]),
  ]);
  return NextResponse.json([
    ...bookings.map((b) => ({ id: b.id, kind: "booking", label: `${b.ref} · ${b.pax}`, hint: b.pnr ?? "", href: `/adminwork/sales/${b.id}` })),
    ...clients.map((c) => ({ id: c.id, kind: "client", label: c.name, hint: c.type, href: `/adminwork/clients/${c.id}` })),
    ...expenses.map((e) => ({ id: e.id, kind: "expense", label: `${e.ref} · ${e.d}`, href: `/adminwork/expenses/${e.id}` })),
  ]);
}
