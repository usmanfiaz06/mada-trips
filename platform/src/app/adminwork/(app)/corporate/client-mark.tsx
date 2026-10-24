import { withBase } from "@/lib/base";

/** A client's logo when they have one, otherwise their initials on their brand colour. */
export function ClientMark({ clientId, name, hasLogo, color, size = 32 }: { clientId: string; name: string; hasLogo: boolean; color?: string | null; size?: number }) {
  if (hasLogo) {
    return (
      <span className="inline-grid shrink-0 place-items-center overflow-hidden rounded-[10px] bg-white ring-1 ring-line" style={{ height: size, width: size * 1.9 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={withBase(`/api/portal/logo/${clientId}`)} alt={name} className="max-h-[80%] max-w-[86%] object-contain" />
      </span>
    );
  }
  const initials = name.split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 3).join("").toUpperCase();
  return (
    <span className="inline-grid shrink-0 place-items-center rounded-[10px] font-semibold text-white" style={{ height: size, minWidth: size, padding: "0 6px", fontSize: Math.max(10, size * 0.32), background: color || "#1e352d" }}>
      {initials}
    </span>
  );
}
