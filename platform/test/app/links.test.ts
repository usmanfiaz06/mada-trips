import { afterEach, describe, expect, it, vi } from "vitest";
import { sql as raw } from "drizzle-orm";
import { CircleDetail, InviteLink } from "@mada/shared";
import { db } from "@/db";
import { GET as aasaGet } from "@/app/.well-known/apple-app-site-association/route";
import { GET as assetLinksGet } from "@/app/.well-known/assetlinks.json/route";
import { GET as joinGet } from "@/app/join/[code]/route";
import { GET as shortGet } from "@/app/i/[code]/route";
import { GET as planGet } from "@/app/plan/[id]/route";
import { GET as tripGet } from "@/app/trip/[id]/route";
import { GET as cityGet } from "@/app/city/[id]/route";
import { GET as ogJoinGet } from "@/app/links/og/join/[code]/route";
import { GET as ogPlanGet } from "@/app/links/og/plan/[id]/route";
import { GET as coverGet } from "@/app/links/cover/[file]/route";
import { GET as fontGet } from "@/app/links/font/[file]/route";
import { POST as circlesPost } from "@/app/api/app/v1/circles/route";
import { POST as linkPost } from "@/app/api/app/v1/circles/[id]/link/route";
import { POST as invitesPost } from "@/app/api/app/v1/invites/route";
import { DELETE as inviteDelete } from "@/app/api/app/v1/invites/[ref]/route";
import { call, person, withParams, type Who } from "./circles-helpers";
import { freshIp } from "./helpers";

/* madatrips.sa links: the files that hand them to the app, and the pages and preview pictures for people without it. */

let ipSeq = 0;
const get = <P extends Record<string, string>>(handler: (req: Request, ctx: { params: Promise<P> }) => Promise<Response> | Response, path: string, params: P, headers: Record<string, string> = {}) =>
  handler(new Request(`https://madatrips.sa${path}`, { headers: { "x-forwarded-for": `10.77.${(ipSeq += 1) >> 8}.${ipSeq & 255}`, ...headers } }), { params: Promise.resolve(params) });
const meta = (html: string, prop: string) => new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`).exec(html)?.[1] ?? null;

async function circleLink(owner: Who, name: string, extra: Record<string, unknown> = {}) {
  const c = CircleDetail.parse((await call(circlesPost, { token: owner.token, ip: freshIp(), body: { name, ...extra } })).json);
  return { id: c.circle.id, link: InviteLink.parse((await call(withParams(linkPost, { id: c.circle.id }), { token: owner.token, ip: freshIp() })).json) };
}

describe("/.well-known files", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("apple-app-site-association: JSON, the team's app id, every app path, without a redirect", async () => {
    vi.stubEnv("APPLE_TEAM_ID", "abcde12345");
    const res = aasaGet();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    const j = await res.json();
    expect(j.applinks.details[0].appIDs).toEqual(["ABCDE12345.sa.madatrips.app"]);
    expect(j.applinks.details[0].components.map((c: { "/": string }) => c["/"])).toEqual(["/join/*", "/i/*", "/trip/*", "/plan/*", "/city/*"]);
    expect(j.applinks.details[0].paths).toContain("/join/*");
    expect(j.webcredentials.apps).toEqual(["ABCDE12345.sa.madatrips.app"]);
  });

  it("apple-app-site-association without APPLE_TEAM_ID (or a malformed one) is valid and empty", async () => {
    vi.stubEnv("APPLE_TEAM_ID", "");
    expect((await aasaGet().json()).applinks.details).toEqual([]);
    vi.stubEnv("APPLE_TEAM_ID", "not-a-team");
    expect((await aasaGet().json()).applinks.details).toEqual([]);
  });

  it("assetlinks.json: the package and every fingerprint, normalised; empty without them", async () => {
    const hex = "ab".repeat(32);
    vi.stubEnv("ANDROID_CERT_SHA256", `${hex}, ${"CD:".repeat(31)}CD , garbage`);
    const res = assetLinksGet();
    expect(res.headers.get("content-type")).toBe("application/json");
    const j = await res.json();
    expect(j[0].target).toEqual({
      namespace: "android_app", package_name: "sa.madatrips.app",
      sha256_cert_fingerprints: [Array(32).fill("AB").join(":"), Array(32).fill("CD").join(":")],
    });
    expect(j[0].relation).toContain("delegate_permission/common.handle_all_urls");
    vi.stubEnv("ANDROID_CERT_SHA256", "");
    expect(await assetLinksGet().json()).toEqual([]);
  });
});

describe("/join/<code>: the invite page", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("shows the circle, who invited you, who's in, the open button and the code; previews well (Open Graph, Twitter)", async () => {
    const abdullah = await person("Abdullah");
    const { link } = await circleLink(abdullah, "Istanbul for Eid", { cover: "istanbul" });
    const res = await get(joinGet, `/join/${link.code}`, { code: link.code }, { "accept-language": "en-GB,en;q=0.9" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("vary")).toContain("Accept-Language");
    const html = await res.text();
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain("Abdullah invited you");
    expect(html).toContain("Istanbul for Eid");
    expect(html).toContain("If you join, they see");
    expect(html).toContain(`href="madatrips://join/${link.code}"`);
    expect(html).toContain(`<code id="code">${link.code}</code>`);
    expect(html).toContain("/links/cover/istanbul.jpg");
    expect(meta(html, "og:title")).toBe("Abdullah invited you to Istanbul for Eid");
    expect(meta(html, "og:description")).toBe("Plan, vote and pay your share in one place.");
    expect(meta(html, "og:image")).toBe(`https://madatrips.sa/links/og/join/${link.code}?lang=en`);
    expect(meta(html, "og:image:width")).toBe("1200");
    expect(meta(html, "twitter:card")).toBe("summary_large_image");
    expect(meta(html, "og:url")).toBe(`https://madatrips.sa/join/${link.code}`);
    expect(meta(html, "robots")).toBe("noindex, nofollow");
    expect(html).not.toContain(abdullah.phone);
    // A Content-Security-Policy that only lets the page's own script run.
    expect(res.headers.get("content-security-policy")).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
  });

  it("in Arabic by Accept-Language (or ?lang=ar): right to left, Arabic words, Arabic preview", async () => {
    const abdullah = await person("Abdullah");
    const { link } = await circleLink(abdullah, "رحلة العيد", { cover: "alula" });
    const html = await (await get(joinGet, `/join/${link.code}`, { code: link.code }, { "accept-language": "ar-SA,ar;q=0.9,en;q=0.5" })).text();
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain("افتح في مادا للرحلات");
    expect(html).toContain("رحلة العيد");
    expect(meta(html, "og:locale")).toBe("ar_SA");
    expect(meta(html, "og:image")).toContain("lang=ar");
    expect(meta(html, "og:title")).toContain("دعاك إلى رحلة العيد");
    const en = await (await get(joinGet, `/join/${link.code}?lang=en`, { code: link.code }, { "accept-language": "ar" })).text();
    expect(en).toContain('dir="ltr"');
  });

  it("store buttons from env (Play carries the invite for the app to pick up); 'Not in the stores yet' without", async () => {
    const omar = await person("Omar");
    const { link } = await circleLink(omar, "Stores");
    let html = await (await get(joinGet, `/join/${link.code}`, { code: link.code })).text();
    expect(html).toContain('id="not-yet"');
    expect(html).toContain("Not in the stores yet");
    expect(html).not.toContain("apps.apple.com");
    vi.stubEnv("APP_STORE_URL", "https://apps.apple.com/sa/app/mada-trips/id1234567890");
    vi.stubEnv("PLAY_STORE_URL", "https://play.google.com/store/apps/details?id=sa.madatrips.app");
    vi.stubEnv("APP_STORE_ID", "1234567890");
    html = await (await get(joinGet, `/join/${link.code}`, { code: link.code })).text();
    expect(html).not.toContain('id="not-yet"');
    expect(html).toContain('href="https://apps.apple.com/sa/app/mada-trips/id1234567890"');
    expect(html).toContain(`referrer=invite%3D${link.code}`);
    expect(meta(html, "apple-itunes-app")).toBe(`app-id=1234567890, app-argument=https://madatrips.sa/join/${link.code}`);
    vi.stubEnv("APP_STORE_URL", "javascript:alert(1)");
    html = await (await get(joinGet, `/join/${link.code}`, { code: link.code })).text();
    expect(html).not.toContain("javascript:alert");
  });

  it("the short link /i/<code> shows the same page", async () => {
    const omar = await person("Omar");
    const { link } = await circleLink(omar, "Short");
    const html = await (await get(shortGet, `/i/${link.code}`, { code: link.code })).text();
    expect(html).toContain("Omar invited you");
    expect(meta(html, "og:url")).toBe(`https://madatrips.sa/join/${link.code}`);
  });

  it("unknown and forged codes are a 404 page; expired, turned-off and full links say so, without the code", async () => {
    const r404 = await get(joinGet, "/join/aaaaaaaa-bbbbbb", { code: "aaaaaaaa-bbbbbb" });
    expect(r404.status).toBe(404);
    expect(await r404.text()).toContain("We can’t find that invite.");
    expect((await get(joinGet, "/join/<script>", { code: "<script>" })).status).toBe(404);

    const omar = await person("Omar");
    const { id, link } = await circleLink(omar, "Changing");
    await db.execute(raw`UPDATE app_circle_invites SET expires_at = now() - interval '1 day' WHERE circle_id = ${id}`);
    let html = await (await get(joinGet, `/join/${link.code}`, { code: link.code })).text();
    expect(html).toContain("This invite has expired.");
    expect(html).not.toContain(`<code id="code">`);

    const two = await circleLink(omar, "Turned off");
    await call(withParams(inviteDelete, { ref: two.link.id! }), { method: "DELETE", token: omar.token, ip: freshIp() });
    html = await (await get(joinGet, `/join/${two.link.code}`, { code: two.link.code })).text();
    expect(html).toContain("This invite no longer works.");

    await db.execute(raw`UPDATE app_circle_invites SET max_uses = 1, uses = 1 WHERE id = ${two.link.id}`);
    await db.execute(raw`UPDATE app_circle_invites SET status = 'pending' WHERE id = ${two.link.id}`);
    html = await (await get(joinGet, `/join/${two.link.code}`, { code: two.link.code })).text();
    expect(html).toContain("This link is full.");
  });

  it("escapes what people typed", async () => {
    const omar = await person("Omar");
    const { link } = await circleLink(omar, "<img src=x>");
    const html = await (await get(joinGet, `/join/${link.code}`, { code: link.code })).text();
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img src=x&gt;");
  });

  it("a Mada invite (not a circle) invites you to travel with the person", async () => {
    const omar = await person("Omar");
    const l = InviteLink.parse((await call(invitesPost, { token: omar.token, ip: freshIp(), body: { link: true } })).json.link);
    const html = await (await get(joinGet, `/join/${l.code}`, { code: l.code })).text();
    expect(html).toContain("Travel with Omar.");
    expect(meta(html, "og:title")).toBe("Omar invited you to Mada Trips");
  });
});

describe("preview pictures (og:image)", () => {
  it("draws a 1200×630 PNG for an invite, in English and Arabic, and a plain one for anything unknown", async () => {
    const omar = await person("Omar");
    const { link } = await circleLink(omar, "Weekend in AlUla", { cover: "alula" });
    for (const lang of ["en", "ar"]) {
      const res = await get(ogJoinGet, `/links/og/join/${link.code}?lang=${lang}`, { code: link.code });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      const png = Buffer.from(await res.arrayBuffer());
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect(png.readUInt32BE(16)).toBe(1200);
      expect(png.readUInt32BE(20)).toBe(630);
    }
    const unknown = await get(ogJoinGet, "/links/og/join/aaaaaaaa-bbbbbb", { code: "aaaaaaaa-bbbbbb" });
    expect(unknown.status).toBe(200);
    expect(unknown.headers.get("content-type")).toBe("image/png");
  }, 30_000);

  it("draws one for a plan", async () => {
    const res = await get(ogPlanGet, "/links/og/plan/alula2", { id: "alula2" });
    expect(res.headers.get("content-type")).toBe("image/png");
  }, 30_000);
});

describe("other app links", () => {
  it("/plan/<id>: the plan's title, days and cover, indexable; unknown plans are a 404", async () => {
    const res = await get(planGet, "/plan/alula2", { id: "alula2" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Two days in AlUla");
    expect(html).toContain("2 days");
    expect(html).toContain("Hegra guided tour");
    expect(html).toContain('href="madatrips://plan/alula2"');
    expect(meta(html, "og:image")).toBe("https://madatrips.sa/links/og/plan/alula2?lang=en");
    expect(meta(html, "robots")).toBe("index, follow");
    expect((await get(planGet, "/plan/nope", { id: "nope" })).status).toBe(404);
    const ar = await (await get(planGet, "/plan/alula2?lang=ar", { id: "alula2" })).text();
    expect(ar).toContain('dir="rtl"');
    expect(ar).toContain("يومان");
  });

  it("/trip/<id> says nothing about the trip; /city/<id> names the city", async () => {
    const trip = await (await get(tripGet, "/trip/0b5e0e6c-1111-4111-8111-111111111111", { id: "0b5e0e6c-1111-4111-8111-111111111111" })).text();
    expect(trip).toContain("A trip on Mada Trips");
    expect(trip).toContain('href="madatrips://trip/0b5e0e6c-1111-4111-8111-111111111111"');
    const city = await (await get(cityGet, "/city/istanbul", { id: "istanbul" })).text();
    expect(city).toContain("Istanbul on Mada Trips");
    expect(city).toContain("/links/cover/istanbul.jpg");
  });

  it("serves the covers and fonts by name only, cached for a year", async () => {
    const cover = await get(coverGet, "/links/cover/alula.jpg", { file: "alula.jpg" });
    expect(cover.headers.get("content-type")).toBe("image/jpeg");
    expect(cover.headers.get("cache-control")).toContain("immutable");
    expect((await get(fontGet, "/links/font/instrument-serif.ttf", { file: "instrument-serif.ttf" })).headers.get("content-type")).toBe("font/ttf");
    expect((await get(coverGet, "/links/cover/..%2f..%2fpackage.json", { file: "../../package.json" })).status).toBe(404);
  });
});

/* LINKS_SHOTS=<dir>: also write the pages and pictures there, to look at (the e2e shots open them in a browser). */
describe.runIf(!!process.env.LINKS_SHOTS)("shots", () => {
  it("writes the invite page, the plan page and their pictures", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const dir = process.env.LINKS_SHOTS!;
    mkdirSync(dir, { recursive: true });
    const abdullah = await person("Abdullah");
    const others = [await person("Noor"), await person("Khalid"), await person("Sara")];
    const c = CircleDetail.parse((await call(circlesPost, { token: abdullah.token, ip: freshIp(), body: { name: "Istanbul for Eid", cover: "istanbul", invite: others.map((o) => o.id) } })).json);
    const { POST: acceptPost } = await import("@/app/api/app/v1/invites/[ref]/accept/route");
    for (const o of others) await call(withParams(acceptPost, { ref: c.invited.find((i) => i.person.id === o.id)!.inviteId }), { token: o.token, ip: freshIp() });
    const link = InviteLink.parse((await call(withParams(linkPost, { id: c.circle.id }), { token: abdullah.token, ip: freshIp() })).json);
    const ar = await circleLink(abdullah, "رحلة العلا مع العائلة", { cover: "alula" });
    for (const [name, lang, code] of [["join-en", "en", link.code], ["join-ar", "ar", link.code], ["join-ar-name", "ar", ar.link.code]] as const) {
      writeFileSync(`${dir}/${name}.html`, await (await get(joinGet, `/join/${code}?lang=${lang}`, { code })).text());
      writeFileSync(`${dir}/${name}-og.png`, Buffer.from(await (await get(ogJoinGet, `/links/og/join/${code}?lang=${lang}`, { code })).arrayBuffer()));
    }
    writeFileSync(`${dir}/join-gone.html`, await (await get(joinGet, "/join/aaaaaaaa-bbbbbb", { code: "aaaaaaaa-bbbbbb" })).text());
    writeFileSync(`${dir}/plan-en.html`, await (await get(planGet, "/plan/alula2", { id: "alula2" })).text());
    writeFileSync(`${dir}/plan-en-og.png`, Buffer.from(await (await get(ogPlanGet, "/links/og/plan/alula2", { id: "alula2" })).arrayBuffer()));
  }, 60_000);
});
