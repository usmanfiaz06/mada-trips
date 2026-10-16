import "server-only";

/*
 * The image check: a hook every user photo passes before it shows (tip photos, circle covers). Pluggable:
 *
 *   APP_VISION_PROVIDER=stub   (the default) no automatic check; the photo waits for a person exactly as before.
 *   APP_VISION_PROVIDER=mock   deterministic, for tests and staging: holds a photo whose bytes contain "MOCK-HOLD"
 *                              (or "MOCK-NUDITY", "MOCK-FACES"), passes everything else.
 *   APP_VISION_PROVIDER=http   POSTs the photo to APP_VISION_URL (Bearer APP_VISION_KEY) as JSON
 *                              { mime, data: base64 } and reads back { hold: boolean, labels?: string[] }. Any
 *                              vision API (Rekognition, Vision, a self-hosted model) fits behind a small adapter.
 *
 * A hold never rejects: it sends the photo to the desk's moderation queue with the labels as the reason. A failed
 * check is a hold too (we'd rather a person looks than let it through unseen).
 */

export type VisionVerdict = { hold: boolean; labels: string[]; provider: string };
export type VisionProvider = { name: string; check(bytes: Buffer, mime: string): Promise<VisionVerdict> };

export const stubVision: VisionProvider = {
  name: "stub",
  async check() { return { hold: false, labels: [], provider: "stub" }; },
};

const MOCK_MARKERS: Record<string, string> = { "MOCK-HOLD": "flagged", "MOCK-NUDITY": "nudity", "MOCK-FACES": "faces of strangers" };
export const mockVision: VisionProvider = {
  name: "mock",
  async check(bytes) {
    const text = bytes.toString("latin1");
    const labels = Object.entries(MOCK_MARKERS).filter(([m]) => text.includes(m)).map(([, l]) => l);
    return { hold: labels.length > 0, labels, provider: "mock" };
  },
};

export function httpVision(url: string, key: string | undefined, f: typeof fetch = fetch): VisionProvider {
  return {
    name: "http",
    async check(bytes, mime) {
      try {
        const res = await f(url, {
          method: "POST", signal: AbortSignal.timeout(8000),
          headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
          body: JSON.stringify({ mime, data: bytes.toString("base64") }),
        });
        if (!res.ok) return { hold: true, labels: [`check unavailable (${res.status})`], provider: "http" };
        const j = (await res.json()) as { hold?: unknown; labels?: unknown };
        const labels = Array.isArray(j.labels) ? j.labels.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
        return { hold: j.hold === true, labels, provider: "http" };
      } catch {
        return { hold: true, labels: ["check unavailable"], provider: "http" };
      }
    },
  };
}

let override: VisionProvider | null = null;
/** Tests swap the provider. */
export function setVisionProvider(p: VisionProvider | null) { override = p; }

export function visionProvider(): VisionProvider {
  if (override) return override;
  const p = process.env.APP_VISION_PROVIDER;
  if (p === "mock") return mockVision;
  if (p === "http" && process.env.APP_VISION_URL) return httpVision(process.env.APP_VISION_URL, process.env.APP_VISION_KEY);
  return stubVision;
}

/** Why a photo needs a person (a "image: …" flag), or null. */
export async function checkImage(bytes: Buffer, mime: string): Promise<string | null> {
  const v = await visionProvider().check(bytes, mime);
  return v.hold ? `image: ${v.labels.join(", ") || "flagged"}`.slice(0, 120) : null;
}
