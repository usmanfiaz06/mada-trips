import { LoginScreen } from "@/app/adminwork/login/screen";

export const metadata = { title: { absolute: "Sign in · Mada Business" } };

/** madatrips.sa/corporate/login: the sign-in page for people at corporate clients. */
export default function CorporateLogin() {
  return <LoginScreen audience="corporate" />;
}
