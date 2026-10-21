import { redirect } from "next/navigation";

// eSIM pricing moved under App finance (DESK-PLAN U6); old links still land.
export default function OldPricingPage() {
  redirect("/adminwork/desk/finance/esim-pricing");
}
