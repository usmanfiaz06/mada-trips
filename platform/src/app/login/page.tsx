import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { ActionForm, SubmitButton, LocaleSwitch } from "@/components/client";
import { login } from "./actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const t = await getT();
  const { next } = await searchParams;
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="night relative hidden overflow-hidden lg:block">
        <div className="night-grid absolute inset-0" />
        <div className="absolute -end-40 -top-40 size-[560px] rounded-full border border-[#e9e2d8]/10" />
        <div className="absolute -end-24 -top-24 size-[400px] rounded-full border border-[#e9e2d8]/10" />
        <div className="absolute -end-8 -top-8 size-[240px] rounded-full bg-[radial-gradient(circle,rgba(217,183,122,.35),transparent_65%)]" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-3">
            <img src="/symbol-sand.svg" alt="" className="h-7" />
            <span className="text-[15px] font-semibold tracking-[0.02em]">Mada Ops</span>
          </div>
          <div className="max-w-md">
            <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#d9b77a]">{t("Internal platform")}</div>
            <h1 className="text-[44px] font-semibold leading-[1.05] tracking-[-0.03em]">{t("Every booking, riyal and decision in one place.")}</h1>
            <p className="mt-5 text-[15px] leading-relaxed text-[#efe9de]/65">{t("Sales, issuance, approvals, daily close and the Day-25 settlement, run by the rules the partners agreed.")}</p>
          </div>
          <div className="flex gap-8 text-[12px] text-[#efe9de]/50">
            <span>Riyadh · Karachi</span><span>{t("Partners only see what their role allows")}</span>
          </div>
        </div>
      </section>
      <section className="relative flex items-center justify-center p-6">
        <div className="absolute end-5 top-5"><LocaleSwitch dark={false} /></div>
        <div className="w-full max-w-[380px] animate-rise">
          <img src="/symbol-green.svg" alt="Mada" className="mb-8 h-8 dark:hidden" />
          <img src="/symbol-sand.svg" alt="Mada" className="mb-8 hidden h-8 dark:block" />
          <h2 className="text-[24px] font-semibold tracking-[-0.02em]">{t("Sign in")}</h2>
          <p className="mb-7 mt-1 text-[14px] text-ink-3">{t("Use the email your administrator set up for you.")}</p>
          <ActionForm action={login} className="space-y-4">
            <input type="hidden" name="next" value={next ?? "/"} />
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
