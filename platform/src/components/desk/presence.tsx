import { getT } from "@/lib/i18n";
import { AGENT_STATUS } from "@/lib/labels";
import { Avatar, cx } from "../ui";

const DOT: Record<string, string> = { online: "bg-ok", away: "bg-warn", offline: "bg-ink-4" };

/** The agent's own Online / Away / Off switch, in the header pill next to the bell (desk agents only; from tablet width up). */
export async function PresenceSwitch({ agent, onShift, action }: { agent: { id: string; name: string; status: string }; onShift: boolean; action: (fd: FormData) => Promise<void> }) {
  const t = await getT();
  return (
    <div className="hidden items-center gap-1.5 rounded-full bg-white/[0.06] p-1 ps-1 sm:flex" title={t("You're {name} to travellers", { name: agent.name })} data-testid="presence">
      <span className="relative hidden md:block">
        <Avatar name={agent.name} size={28} className="ring-tile" />
        <span className={cx("absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full ring-2 ring-tile", DOT[agent.status] ?? "bg-ink-4")} />
      </span>
      <span className="hidden pe-0.5 text-[12px] leading-tight xl:block">
        <span className="block text-tile-ink">{agent.name}</span>
        <span className="block text-[11px] text-tile-ink-3">{onShift ? t("On shift") : t("Not on shift")}</span>
      </span>
      <form action={action} className="flex rounded-full bg-black/20 p-0.5">
        <input type="hidden" name="agentId" value={agent.id} />
        {(["online", "away", "offline"] as const).map((s) => (
          <button key={s} name="status" value={s} aria-pressed={agent.status === s}
            className={cx("h-7 rounded-full px-2 text-[12px] transition sm:px-2.5", agent.status === s ? "bg-gold text-[#1a140a]" : "text-tile-ink-3 hover:text-tile-ink")}>
            {t(s === "offline" ? "Off" : AGENT_STATUS[s]!.label)}
          </button>
        ))}
      </form>
    </div>
  );
}
