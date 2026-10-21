import { requirePerm } from "@/lib/auth";

// Desk navigation lives in the Ops sidebar, and the presence switch and supplier alerts in the header pill.
export default async function DeskLayout({ children }: { children: React.ReactNode }) {
  await requirePerm("desk.view");
  return <>{children}</>;
}
