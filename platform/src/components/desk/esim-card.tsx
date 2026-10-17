import Link from "next/link";
import { Smartphone } from "lucide-react";
import { getT } from "@/lib/i18n";
import { deskEsimsOf } from "@/lib/app/esim/service";
import { Badge, Card, CardHead } from "@/components/ui";

/*
 * The traveller's eSIMs beside a chat (desk › Chats): where, its state, what's left, the ICCID, and a link to the eSIM's
 * page for top-ups, notes and refunds. Nothing when they have none.
 */

const LABEL: Record<string, string> = {
  ordering: "Ordering", ready: "Ready to install", installed: "Installed", active: "On", used_up: "All used", expired: "Ended", refunded: "Refunded", stuck: "With Mada",
};
const TONE: Record<string, "ok" | "warn" | "bad" | "neutral" | "info"> = {
  ordering: "info", ready: "info", installed: "ok", active: "ok", used_up: "neutral", expired: "neutral", refunded: "warn", stuck: "bad",
};

export async function EsimCard({ userId }: { userId: string | null }) {
  if (!userId) return null;
  const list = await deskEsimsOf(userId);
  if (!list.length) return null;
  const t = await getT();
  return (
    <Card>
      <CardHead title={<span className="inline-flex items-center gap-1.5"><Smartphone className="size-4" />{t("eSIMs")}</span>} />
      <ul className="space-y-3">
        {list.map((e) => {
          const plan = e.plan as { coverage?: { name?: string }; gb?: number | null; days?: number };
          const u = e.usage as { leftMb?: number | null; totalMb?: number | null } | null;
          return (
            <li key={e.id} className="text-[13px] leading-snug">
              <Link href={`/adminwork/desk/esims/${e.id}`} className="flex items-center justify-between gap-2 text-ink underline decoration-gold underline-offset-4">
                <span className="truncate">{plan.coverage?.name ?? ""} · {plan.gb === null ? t("Unlimited") : `${plan.gb} GB`}</span>
                <Badge tone={TONE[e.status] ?? "neutral"}>{t(LABEL[e.status] ?? e.status)}</Badge>
              </Link>
              {u?.totalMb ? <span className="block text-[12px] text-ink-3">{t("{left} of {total} MB left", { left: u.leftMb ?? 0, total: u.totalMb })}</span> : null}
              <span className="num block text-[11.5px] text-ink-4" dir="ltr">{e.iccid ?? "—"}</span>
              {!e.installedAt && e.iccid && e.status !== "refunded" ? <span className="block text-[12px] text-warn">{t("Not installed yet")}</span> : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
