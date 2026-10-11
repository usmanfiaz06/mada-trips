import "server-only";
import { APP_LINK_PATHS } from "@mada/shared";

/*
 * The files that let madatrips.sa links open the Mada Trips app instead of the browser:
 *   /.well-known/apple-app-site-association  iOS universal links (and password autofill)   env APPLE_TEAM_ID
 *   /.well-known/assetlinks.json             Android app links (verified intent filters)    env ANDROID_CERT_SHA256
 * The app side is apps/mobile/app.json (associatedDomains, intentFilters); the paths are shared (APP_LINK_PATHS).
 * Without the env vars the files are still valid, just empty, so nothing breaks and links open the web pages.
 */

export const IOS_BUNDLE_ID = "sa.madatrips.app";
export const ANDROID_PACKAGE = "sa.madatrips.app";

/** "ABCDE12345": Apple's 10-character team id, or null when not set (or not that shape). */
export function appleTeamId(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = (env.APPLE_TEAM_ID ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(v) ? v : null;
}

/**
 * The SHA-256 fingerprints of the Android signing certificates (the Play App Signing key, and the upload key if
 * you sideload builds), comma or space separated, with or without colons. Normalised to "AB:CD:…".
 */
export function androidFingerprints(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.ANDROID_CERT_SHA256 ?? "").split(/[\s,]+/).map((s) => s.replace(/:/g, "").trim().toUpperCase())
    .filter((s) => /^[0-9A-F]{64}$/.test(s))
    .map((s) => s.match(/../g)!.join(":"));
}

export function appleAppSiteAssociation(env: NodeJS.ProcessEnv = process.env) {
  const team = appleTeamId(env);
  const appId = team ? `${team}.${IOS_BUNDLE_ID}` : null;
  const paths = APP_LINK_PATHS.map((p) => `${p}*`);
  return {
    applinks: {
      // iOS 13+ reads `components`; older iOS reads `appID` + `paths`. Both say the same.
      details: appId ? [{ appIDs: [appId], appID: appId, components: paths.map((p) => ({ "/": p })), paths }] : [],
    },
    webcredentials: { apps: appId ? [appId] : [] },
  };
}

export function assetLinks(env: NodeJS.ProcessEnv = process.env) {
  const prints = androidFingerprints(env);
  if (!prints.length) return [];
  return [{
    relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
    target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: prints },
  }];
}

/** JSON with the content type both platforms require, cached briefly (Apple's CDN fetches it on install). */
export const wellKnownResponse = (data: unknown) => new Response(JSON.stringify(data), {
  status: 200,
  headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" },
});
