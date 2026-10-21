import Link from "next/link";
import type { ReactNode } from "react";

/** A traveller's name anywhere on the desk: it opens their customer page (DESK-PLAN U3). Plain text when there's no id. */
export function CustomerLink({ id, children, className }: { id: string | null | undefined; children: ReactNode; className?: string }) {
  if (!id) return <bdi className={className}>{children}</bdi>;
  return (
    <Link href={`/adminwork/desk/customers/${id}`} className={`decoration-gold decoration-2 underline-offset-4 hover:underline ${className ?? ""}`}>
      <bdi>{children}</bdi>
    </Link>
  );
}
