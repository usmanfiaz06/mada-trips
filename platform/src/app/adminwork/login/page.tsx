import { redirect } from "next/navigation";
import { LoginScreen } from "./screen";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; for?: string }> }) {
  const { next, for: audience } = await searchParams;
  // Older corporate links pointed here; clients belong on their own address.
  if (audience) redirect(audience === "corporate" ? "/corporate/login" : `/corporate/${encodeURIComponent(audience)}`);
  return <LoginScreen next={next} />;
}
