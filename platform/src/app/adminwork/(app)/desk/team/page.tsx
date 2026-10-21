import { redirect } from "next/navigation";

// Team & rota split into Agents & roles, Rota & time, Performance and Saved replies (DESK-PLAN.md U7).
export default function TeamPage() {
  redirect("/adminwork/desk/agents");
}
