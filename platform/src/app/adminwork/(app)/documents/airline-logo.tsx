"use client";
import { airlineLogoUrl } from "./types";

// The operating airline's logo, by IATA code. If the code is unknown or the logo can't load, it hides
// itself and the airline name (always shown next to it) carries the document on its own.
export function AirlineLogo({ code, name }: { code?: string; name?: string }) {
  if (!code) return null;
  return (
    <img
      src={airlineLogoUrl(code)}
      alt={name || code}
      style={{ height: 17, width: "auto", maxWidth: 88, objectFit: "contain", display: "inline-block", verticalAlign: "middle" }}
      onError={(e) => { e.currentTarget.style.display = "none"; }}
    />
  );
}
