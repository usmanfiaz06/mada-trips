import { notFound } from "next/navigation";
import { LoginScreen } from "@/app/adminwork/login/screen";
import { SLUG_RE } from "@/lib/portal";

export const metadata = { title: { absolute: "Sign in · Mada Business" } };

/** madatrips.sa/corporate/<workspace>: the sign-in page branded for one client (e.g. /corporate/keo). */
export default async function ClientLogin({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) notFound();
  return <LoginScreen audience={slug} />;
}
