"use client";
import { useState } from "react";
import { airlineLogoUrl, LOGO_EXCLUDE } from "./types";

// The operating airline's logo.
//  - Most carriers use the shared logo CDN, keyed by IATA code.
//  - For a few codes the CDN serves a WRONG brand because the IATA code was reassigned (e.g. OV is now
//    SalamAir but the CDN still shows Estonian Air). Those are listed in LOGO_EXCLUDE and instead look for a
//    correct logo bundled at /adminwork/airlines/<code>.png. Drop a file there to give any such airline its
//    logo (and the same path overrides any airline whose CDN logo you don't like).
//  - If no logo is available or it fails to load, nothing is shown and the airline name (always beside it)
//    carries the document.
export function AirlineLogo({ code, name }: { code?: string; name?: string }) {
  const [broken, setBroken] = useState(false);
  if (!code) return null;
  const src = LOGO_EXCLUDE.has(code) ? `/adminwork/airlines/${code.toLowerCase()}.png` : airlineLogoUrl(code);
  if (broken) return null;
  return (
    <img
      src={src}
      alt={name || code}
      style={{ height: 17, width: "auto", maxWidth: 88, objectFit: "contain", display: "inline-block", verticalAlign: "middle" }}
      onError={() => setBroken(true)}
    />
  );
}
