import { redirect } from "next/navigation";
import { withBase } from "@/lib/base";
import { getCurrentUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { ActionForm, SubmitButton, LocaleSwitch } from "@/components/client";
import { login } from "./actions";

export const metadata = { title: "Sign in" };

// A faint sunburst fanning out of the top corner — an echo of the Mada mark.
function Sunburst() {
  const rays = Array.from({ length: 17 }, (_, i) => 96 + i * (86 / 16)); // fan across the top-inner quadrant
  return (
    <svg viewBox="0 0 560 560" className="absolute -end-6 -top-6 h-[560px] w-[560px] text-sand [mask-image:radial-gradient(120%_120%_at_100%_0%,black,transparent_62%)]" aria-hidden fill="none">
      {rays.map((a, i) => {
        const r = (a * Math.PI) / 180;
        return <line key={i} x1={560} y1={0} x2={560 + 560 * Math.cos(r)} y2={560 * Math.sin(r)} stroke="currentColor" strokeWidth={i % 2 ? 0.6 : 1} strokeOpacity={0.12} />;
      })}
    </svg>
  );
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/adminwork");
  const t = await getT();
  const { next } = await searchParams;
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="night grain relative hidden overflow-hidden lg:block">
        <div className="night-grid absolute inset-0" />
        {/* Corner sun: layered orbital rings, one slowly turning, over a breathing glow. */}
        <Sunburst />
        <div className="absolute -end-8 -top-8 size-[240px] rounded-full bg-[radial-gradient(circle,rgba(217,183,122,.45),transparent_65%)] animate-aurora" />
        <div className="animate-orbit absolute -end-48 -top-48 size-[620px] rounded-full border border-dashed border-sand/10" />
        <div className="animate-orbit-rev absolute -end-32 -top-32 size-[440px] rounded-full border border-sand/[0.08]" />
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_20%_120%,rgba(32,165,124,.10),transparent_60%)]" />

        <div className="relative flex h-full flex-col justify-between p-12 xl:p-16">
          <div className="flex items-center gap-3">
            <img src={withBase("/symbol-sand.svg")} alt="" className="h-7" />
            <span className="text-[15px] font-semibold tracking-[0.02em]">Mada Ops</span>
          </div>

          <div className="max-w-lg">
            <div className="mb-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#d9b77a]">
              <span className="h-px w-8 bg-gradient-to-r from-[#d9b77a] to-transparent" />{t("Internal platform")}
            </div>
            <h1 className="text-[46px] font-semibold leading-[1.03] tracking-[-0.035em] xl:text-[54px]">{t("Every booking, riyal and decision in one place.")}</h1>
            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-[#efe9de]/60">{t("Sales, issuance, approvals, daily close and settlement — one calm, secure workspace.")}</p>
          </div>

          <div className="h-px w-16 bg-gradient-to-r from-[#efe9de]/25 to-transparent" />
        </div>
      </section>
      <section className="relative flex items-center justify-center p-6">
        <div className="absolute end-5 top-5"><LocaleSwitch dark={false} /></div>
        <div className="w-full max-w-[380px] animate-rise">
          <img src={withBase("/symbol-green.svg")} alt="Mada" className="mb-8 h-8 dark:hidden" />
          <img src={withBase("/symbol-sand.svg")} alt="Mada" className="mb-8 hidden h-8 dark:block" />
          <h2 className="text-[24px] font-semibold tracking-[-0.02em]">{t("Sign in")}</h2>
          <p className="mb-7 mt-1 text-[14px] text-ink-3">{t("Use the email your administrator set up for you.")}</p>
          <ActionForm action={login} className="space-y-4">
            <input type="hidden" name="next" value={next ?? "/adminwork"} />
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">{t("Email")}</span>
              <input name="email" type="email" autoComplete="username" required autoFocus className="field h-11" dir="ltr" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">{t("Password")}</span>
              <input name="password" type="password" autoComplete="current-password" required className="field h-11" dir="ltr" />
            </label>
            <SubmitButton size="lg" className="mt-2 w-full">{t("Sign in")}</SubmitButton>
          </ActionForm>
          <p className="mt-8 text-[12px] text-ink-4">{t("Every sign-in is recorded in the activity log.")}</p>
        </div>
      </section>
    </main>
  );
}
