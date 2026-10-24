import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireClientUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { withBase } from "@/lib/base";
import { scrub } from "@/lib/portal";
import { Sidebar, type NavSection } from "@/components/shell/sidebar";
import { LocaleSwitch, ThemeToggle } from "@/components/client";
import { logout } from "../login/actions";

export const metadata = { title: { default: "Workspace", template: "%s · Mada" } };

const ROLE = { admin: "Admin", approver: "Approver", requester: "Requester", viewer: "Viewer" } as const;

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const u = await requireClientUser();
  const t = await getT();
  const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, u.clientId));
  if (!c?.portalEnabled) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="max-w-md rounded-card bg-surface p-8 text-center shadow-card">
          <h1 className="text-[22px] font-medium">{t("Your workspace is switched off")}</h1>
          <p className="mt-2 text-[14px] text-ink-3">{t("Contact Mada to switch it back on.")}</p>
          <form action={logout} className="mt-6"><button className="h-10 rounded-full bg-ink px-5 text-[14px] text-bg">{t("Sign out")}</button></form>
        </div>
      </main>
    );
  }
  const [{ pending }] = await db.select({ pending: sql<number>`count(*)::int` }).from(schema.portalRequests)
    .where(and(eq(schema.portalRequests.clientId, c.id), eq(schema.portalRequests.status, "awaiting_approval")));
  const canApprove = u.clientRole === "admin" || u.clientRole === "approver";
  const sections: NavSection[] = [{ label: c.name, items: [
    { href: "/adminwork/portal", label: t("Home"), icon: "Home", count: canApprove ? pending : 0 },
    { href: "/adminwork/portal/requests", label: t("Requests"), icon: "FileText" },
    { href: "/adminwork/portal/invoices", label: t("Invoices"), icon: "ReceiptText" },
    { href: "/adminwork/portal/team", label: t("Team"), icon: "Users2" },
  ] }];
  const brand = (
    <a href="/adminwork/portal" className="flex h-20 items-center gap-3 px-7">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={withBase("/symbol-green.svg")} alt="Mada" className="h-[18px] dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={withBase("/symbol-sand.svg")} alt="Mada" className="hidden h-[18px] dark:block" />
      <span className="text-[12px] text-ink-4">×</span>
      {c.portalLogoId
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={withBase(`/api/portal/logo/${c.id}`)} alt={c.name} className="h-8 max-w-[120px] rounded-[6px] object-contain" />
        : <span className="grid h-8 place-items-center rounded-[9px] px-2.5 text-[12px] font-semibold text-white" style={{ background: c.portalColor ?? "#1e352d" }}>{c.name.split(/\s+/).map((w) => w[0]).slice(0, 3).join("").toUpperCase()}</span>}
    </a>
  );
  return (
    <div className="min-h-dvh">
      <Sidebar sections={scrub(sections, c.hiddenNames)} user={{ name: u.name, role: `${t(ROLE[u.clientRole])} · ${c.name}` }} logout={logout} brand={brand} profileHref="/adminwork/portal/account" />
      <div className="lg:ps-[272px]">
        <header className="sticky top-0 z-30 px-4 pt-3 ps-16 lg:ps-4 lg:pe-6 lg:pt-4">
          <div className="flex h-14 items-center gap-2 rounded-full bg-tile ps-5 pe-2 text-tile-ink shadow-float">
            <span className="truncate text-[13.5px] text-tile-ink-3">{t("Mada Business · prepared for {name}", { name: c.name })}</span>
            <div className="ms-auto flex shrink-0 items-center gap-1"><LocaleSwitch /><ThemeToggle /></div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-8 lg:pe-6 lg:ps-4">{children}</main>
      </div>
    </div>
  );
}
