import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import forge from "node-forge";
import { desc, eq } from "drizzle-orm";
import { BoardingPassesResponse, ImportBoardingPassResponse, SignInResponse, WalletLinkResponse, parseBcbp } from "@mada/shared";
import { buildBcbp } from "../../../packages/shared/src/schemas/bcbp-build";
import { db } from "@/db";
import { appLiveActivities, appWalletPassVersions } from "@/db/app-schema-native";
import { appNotifications } from "@/db/app-schema";
import { POST as otpStart } from "@/app/api/app/v1/auth/otp/start/route";
import { POST as otpVerify } from "@/app/api/app/v1/auth/otp/verify/route";
import { POST as demoPost } from "@/app/api/app/v1/trips/demo/route";
import { GET as tripGet } from "@/app/api/app/v1/trips/[id]/route";
import { GET as passesGet, POST as passesPost } from "@/app/api/app/v1/trips/[id]/boarding-passes/route";
import { DELETE as passDelete } from "@/app/api/app/v1/trips/[id]/boarding-passes/[passId]/route";
import { POST as walletPost } from "@/app/api/app/v1/trips/[id]/wallet/route";
import { GET as pkpassGet } from "@/app/api/app/v1/wallet/pass/[token]/route";
import { DELETE as regDelete, POST as regPost } from "@/app/api/app/v1/wallet/passkit/v1/devices/[device]/registrations/[passType]/[serial]/route";
import { GET as regList } from "@/app/api/app/v1/wallet/passkit/v1/devices/[device]/registrations/[passType]/route";
import { GET as passkitGet } from "@/app/api/app/v1/wallet/passkit/v1/passes/[passType]/[serial]/route";
import { POST as livePost } from "@/app/api/app/v1/live-activities/route";
import { GET as configGet } from "@/app/api/app/v1/config/route";
import { codesIn, deskImport, deskPasses, passesIn } from "@/lib/app/boarding";
import { drawPixels, drawPng } from "@/lib/app/boarding/barcode";
import { unzip, zip } from "@/lib/app/boarding/zip";
import { apnsSent, setApnsTransport } from "@/lib/app/apns";
import { liveJob } from "@/lib/app/live";
import { buildPkpass, signManifest } from "@/lib/app/wallet-pass/pkpass";
import { passSigner } from "@/lib/app/wallet-pass/config";
import { applyAlert } from "@/lib/app/trips/status";
import { call, freshIp, newPhone, type Handler } from "./helpers";

/*
 * The airline's boarding passes (BCBP read from images, PDFs and .pkpass files), Apple Wallet passes signed with a
 * throwaway certificate made here, the PassKit web service, and Live Activity pushes (APNs replaced by a recorder).
 */

type P = Record<string, string>;
const withP = <T extends P>(h: (req: Request, ctx: { params: Promise<T> }) => Promise<Response>, params: T): Handler => (req) => h(req, { params: Promise.resolve(params) });

async function signIn() {
  const phone = newPhone();
  const ip = freshIp();
  await call(otpStart, { body: { phone }, ip });
  const r = SignInResponse.parse((await call(otpVerify, { body: { phone, code: "123456" }, ip })).json);
  return { token: r.tokens.accessToken, userId: r.user.id };
}

async function upload(tripId: string, token: string, bytes: Buffer, name: string) {
  const fd = new FormData();
  fd.set("file", new Blob([new Uint8Array(bytes)]), name);
  const req = new Request(`http://localhost/api/app/v1/trips/${tripId}/boarding-passes`, { method: "POST", headers: { authorization: `Bearer ${token}`, "x-forwarded-for": freshIp() }, body: fd });
  const res = await passesPost(req, { params: Promise.resolve({ id: tripId }) });
  return { status: res.status, json: JSON.parse(await res.text()) };
}

// 2027-03-09 is day 68. The demo trip: SV263 RUH→IST for Omar, Hessa, Sara and Ahmed Alharbi.
const pass = (name: string, seat: string, seq: string, o: { flight?: string; day?: number } = {}) => buildBcbp({
  name, version: 6, issuedJulian: 67, issuer: "SV",
  legs: [{ pnr: "X7K2QD", from: "RUH", to: "IST", carrier: "SV", flight: o.flight ?? "263", julianDay: o.day ?? 68, seat, sequence: seq, ticket: "0652312345678" }],
});
const OMAR = pass("ALHARBI/OMAR MR", "14A", "21");
const HESSA = pass("ALHARBI/HESSA MRS", "14B", "22");

/** A one-page PDF with the barcode as a deflated 8-bit gray picture, the way most check-in systems print it. */
async function pdfWith(text: string, format: "pdf417" | "aztec" | "qr" = "pdf417", bits: 1 | 8 = 8) {
  const px = await drawPixels(format, text, 3);
  const rowBytes = bits === 8 ? px.width : Math.ceil(px.width / 8);
  const raw = Buffer.alloc(rowBytes * px.height);
  for (let y = 0; y < px.height; y++) for (let x = 0; x < px.width; x++) {
    const v = px.data[(y * px.width + x) * 4]!;
    if (bits === 8) raw[y * rowBytes + x] = v;
    else if (v > 127) raw[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
  }
  const img = deflateSync(raw);
  const parts = [
    "%PDF-1.4\n",
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
  ];
  const head = Buffer.from(`${parts.join("")}4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${px.width} /Height ${px.height} /ColorSpace /DeviceGray /BitsPerComponent ${bits} /Filter /FlateDecode /Length ${img.length} >>\nstream\n`, "latin1");
  const content = "q 400 0 0 120 100 600 cm /Im1 Do Q";
  const tail = Buffer.from(`\nendstream\nendobj\n5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`, "latin1");
  return Buffer.concat([head, img, tail]);
}

/* A throwaway certificate authority standing in for Apple's WWDR, and a Pass Type ID certificate it signed. */
function testCerts() {
  const mk = () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = forge.pki.privateKeyFromPem(privateKey.export({ type: "pkcs1", format: "pem" }).toString());
    return { key, pub: forge.pki.setRsaPublicKey(key.n, key.e) };
  };
  const ca = mk(), leaf = mk();
  const caCert = forge.pki.createCertificate();
  caCert.publicKey = ca.pub; caCert.serialNumber = "01";
  caCert.validity.notBefore = new Date(Date.now() - 86_400_000); caCert.validity.notAfter = new Date(Date.now() + 86_400_000);
  caCert.setSubject([{ name: "commonName", value: "Test WWDR" }]); caCert.setIssuer([{ name: "commonName", value: "Test WWDR" }]);
  caCert.setExtensions([{ name: "basicConstraints", cA: true }, { name: "keyUsage", keyCertSign: true, digitalSignature: true }]);
  caCert.sign(ca.key, forge.md.sha256.create());
  const cert = forge.pki.createCertificate();
  cert.publicKey = leaf.pub; cert.serialNumber = "02";
  cert.validity.notBefore = caCert.validity.notBefore; cert.validity.notAfter = caCert.validity.notAfter;
  cert.setSubject([{ name: "commonName", value: "Pass Type ID: pass.sa.madatrips.test" }, { name: "organizationalUnitName", value: "ABCDE12345" }]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([{ name: "keyUsage", digitalSignature: true }]);
  cert.sign(ca.key, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(leaf.key), wwdrPem: forge.pki.certificateToPem(caCert) };
}

const ENV_KEYS = ["APPLE_TEAM_ID", "APPLE_PASS_TYPE_ID", "APPLE_PASS_CERT_PEM", "APPLE_PASS_KEY_PEM", "APPLE_WWDR_CERT", "APNS_KEY_P8", "APNS_KEY_ID", "APP_PUBLIC_URL"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const b64 = (s: string) => Buffer.from(s).toString("base64");
let certs: ReturnType<typeof testCerts>;
function credentials(on: boolean) {
  if (!on) { for (const k of ENV_KEYS) delete process.env[k]; return; }
  process.env.APPLE_TEAM_ID = "ABCDE12345";
  process.env.APPLE_PASS_TYPE_ID = "pass.sa.madatrips.test";
  process.env.APPLE_PASS_CERT_PEM = b64(certs.certPem);
  process.env.APPLE_PASS_KEY_PEM = b64(certs.keyPem);
  process.env.APPLE_WWDR_CERT = b64(certs.wwdrPem);
  process.env.APNS_KEY_P8 = b64(generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  process.env.APNS_KEY_ID = "KEY1234567";
  process.env.APP_PUBLIC_URL = "https://madatrips.test";
}

let A: { token: string; userId: string };
let tripId: string;

beforeAll(async () => {
  certs = testCerts();
  credentials(false);
  A = await signIn();
  const r = await call(demoPost, { token: A.token });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  tripId = r.json.tripId;
});
afterAll(() => {
  setApnsTransport(null);
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe("reading boarding-pass barcodes", () => {
  it("reads PDF417, Aztec and QR from an image", async () => {
    for (const f of ["pdf417", "aztec", "qr"] as const) {
      const found = await codesIn(await drawPng(f, OMAR));
      expect(found, f).toEqual([{ format: f, text: OMAR }]);
    }
  });
  it("reads the barcode picture inside a PDF, 8-bit and 1-bit", async () => {
    expect((await passesIn(await pdfWith(OMAR))).map((p) => p.bcbp.surname)).toEqual(["ALHARBI"]);
    expect((await passesIn(await pdfWith(HESSA, "aztec", 1))).map((p) => [p.format, p.bcbp.given])).toEqual([["aztec", "HESSA"]]);
  });
  it("reads the barcode from the airline's .pkpass", async () => {
    const pk = zip([{ name: "pass.json", data: Buffer.from(JSON.stringify({ barcodes: [{ format: "PKBarcodeFormatAztec", message: OMAR, messageEncoding: "iso-8859-1" }] })) }, { name: "icon.png", data: await drawPng("qr", "x") }]);
    const found = await passesIn(pk);
    expect(found).toHaveLength(1);
    expect(found[0]!.format).toBe("aztec");
    expect(found[0]!.bcbp.legs[0]!.seat).toBe("14A");
  });
  it("reads every pass in the app's demo PDF (the mock build's fixture is a real one)", async () => {
    const found = await passesIn(readFileSync(join(__dirname, "../../../apps/mobile/test/fixtures/demo-boarding-passes.pdf")));
    expect(found.map((p) => `${p.bcbp.given} ${p.bcbp.legs[0]!.seat}`)).toEqual(["OMAR 14A", "HESSA 14B", "SARA 14C", "AHMED 14D"]);
  });
  it("ignores codes that aren't boarding passes", async () => {
    expect(await passesIn(await drawPng("qr", "https://example.com/menu"))).toEqual([]);
  });
});

describe("boarding passes on the trip", () => {
  it("shows when check-in opens before any pass exists, never a made-up barcode", async () => {
    const r = await call(withP(passesGet, { id: tripId }), { method: "GET", token: A.token });
    expect(r.status).toBe(200);
    const b = BoardingPassesResponse.parse(r.json);
    expect(b.passes).toEqual([]);
    expect(b.checkIn[0]).toMatchObject({ airline: "Saudia", opensLocal: "09:40", opensAt: "2027-03-08T06:40:00.000Z", open: false, url: "https://www.saudia.com/" });
    expect(b.appleWallet).toBe(false);
  });

  it("adds a family's passes from the airline's files, each matched to its traveller", async () => {
    const one = await upload(tripId, A.token, await drawPng("pdf417", OMAR), "omar.png");
    expect(one.status, JSON.stringify(one.json)).toBe(201);
    const added = ImportBoardingPassResponse.parse(one.json).added;
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ name: "ALHARBI/OMAR MR", seat: "14A", sequence: "21", pnr: "X7K2QD", flightNumber: "SV263", format: "pdf417", message: OMAR, source: "traveller" });
    expect(added[0]!.svg).toMatch(/^<svg viewBox="0 0 \d+ \d+"/);
    const two = await upload(tripId, A.token, await pdfWith(HESSA), "hessa.pdf");
    expect(two.status, JSON.stringify(two.json)).toBe(201);

    const trip = (await call(withP(tripGet, { id: tripId }), { method: "GET", token: A.token })).json.trip;
    const list = BoardingPassesResponse.parse((await call(withP(passesGet, { id: tripId }), { method: "GET", token: A.token })).json).passes;
    expect(list.map((p) => [p.name, trip.travellers.find((t: { id: string }) => t.id === p.travellerId)?.firstName])).toEqual([["ALHARBI/OMAR MR", "Omar"], ["ALHARBI/HESSA MRS", "Hessa"]]);
    // The barcode drawn for the phone is the airline's text, unchanged.
    expect(parseBcbp(list[0]!.message)!.raw).toBe(OMAR);

    // Checking in again replaces the old pass instead of adding a second.
    await upload(tripId, A.token, await drawPng("qr", pass("ALHARBI/OMAR MR", "15C", "40")), "again.png");
    const after = BoardingPassesResponse.parse((await call(withP(passesGet, { id: tripId }), { method: "GET", token: A.token })).json).passes;
    expect(after.filter((p) => p.name === "ALHARBI/OMAR MR").map((p) => p.seat)).toEqual(["15C"]);
  });

  it("says plainly when a file has no pass, or a pass for another flight", async () => {
    const none = await upload(tripId, A.token, await drawPng("qr", "hello"), "menu.png");
    expect(none.status).toBe(400);
    expect(none.json.error.message).toBe("No boarding pass barcode in that file. Try a screenshot of the barcode itself.");
    const other = await upload(tripId, A.token, await drawPng("pdf417", pass("ALHARBI/OMAR MR", "3A", "1", { flight: "1021" })), "other.png");
    expect(other.status).toBe(400);
    expect(other.json.error.message).toBe("That pass is for SV1021, not this trip.");
    const notImage = await upload(tripId, A.token, Buffer.from("just text"), "x.txt");
    expect(notImage.status).toBe(400);
  });

  it("takes the desk's upload on the order, and tells the traveller", async () => {
    const SARA = pass("ALHARBI/SARA MISS", "14C", "23");
    const r = await deskImport(tripId, { bytes: await drawPng("aztec", SARA), name: "sara.png" }, "Faisal");
    expect(r.added.map((a) => [a.name, a.source])).toEqual([["ALHARBI/SARA MISS", "desk"]]);
    const desk = await deskPasses(tripId);
    expect(desk.find((d) => d.name === "ALHARBI/SARA MISS")).toMatchObject({ traveller: "Sara Alharbi", addedBy: "Faisal", seat: "14C" });
    const [note] = await db.select().from(appNotifications).where(eq(appNotifications.userId, A.userId)).orderBy(desc(appNotifications.createdAt)).limit(1);
    expect(note).toMatchObject({ title: "Your boarding passes are in", href: "/wallet" });
  });

  it("keeps passes to their owner", async () => {
    const B = await signIn();
    expect((await call(withP(passesGet, { id: tripId }), { method: "GET", token: B.token })).status).toBe(404);
    const list = BoardingPassesResponse.parse((await call(withP(passesGet, { id: tripId }), { method: "GET", token: A.token })).json).passes;
    expect((await call(withP(passDelete, { id: tripId, passId: list[0]!.id }), { method: "DELETE", token: B.token })).status).toBe(404);
  });
});

describe("Apple Wallet passes", () => {
  it("hides Wallet until the certificates are set", async () => {
    credentials(false);
    const list = BoardingPassesResponse.parse((await call(withP(passesGet, { id: tripId }), { method: "GET", token: A.token })).json);
    const r = await call(withP(walletPost, { id: tripId }), { body: { passId: list.passes[0]!.id }, token: A.token });
    expect(r.status).toBe(501);
    expect((await call(configGet, { method: "GET" })).json.features).toMatchObject({ appleWallet: false, liveActivityPush: false });
  });

  it("signs a pass whose manifest covers every file, with a detached PKCS #7 that verifies", () => {
    credentials(true);
    const signer = passSigner()!;
    expect(signer).toBeTruthy();
    const built = buildPkpass({
      kind: "flight", serial: "bp-test", authToken: "a".repeat(32), webServiceURL: "https://madatrips.test/api/app/v1/wallet/passkit/",
      airline: "Saudia", brand: "#0b6b52", flightNumber: "SV263", carrierCode: "SV", from: "RUH", to: "IST", fromCity: "Riyadh", toCity: "Istanbul",
      departLocal: "2027-03-09T09:40", departIso: "2027-03-09T06:40:00.000Z", arriveIso: "2027-03-09T10:55:00.000Z", boards: "08:55", departs: "09:40",
      gate: "B12", terminal: "Terminal 3", seat: "14A", sequence: "21", pnr: "X7K2QD", passenger: "ALHARBI/OMAR MR", format: "pdf417", message: OMAR, cancelled: false,
    }, signer);
    const files = unzip(built.bytes);
    const manifest = JSON.parse(files.get("manifest.json")!.toString()) as Record<string, string>;
    for (const [name, data] of files) {
      if (name === "manifest.json" || name === "signature") continue;
      expect(manifest[name], name).toBe(createHash("sha1").update(data).digest("hex"));
    }
    expect(Object.keys(manifest).sort()).toEqual(expect.arrayContaining(["pass.json", "icon.png", "icon@2x.png", "logo.png", "en.lproj/pass.strings", "ar.lproj/pass.strings"]));
    const pj = JSON.parse(files.get("pass.json")!.toString());
    expect(pj).toMatchObject({ passTypeIdentifier: "pass.sa.madatrips.test", teamIdentifier: "ABCDE12345", serialNumber: "bp-test", barcodes: [{ format: "PKBarcodeFormatPDF417", message: OMAR }] });
    expect(pj.boardingPass.transitType).toBe("PKTransitTypeAir");
    expect(files.get("ar.lproj/pass.strings")!.toString()).toContain('"pkpass.gate" = "البوابة";');

    // The signature is over manifest.json, by the pass certificate, chaining to the WWDR stand-in.
    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(files.get("signature")!.toString("binary"))) as unknown as { certificates: forge.pki.Certificate[] };
    expect(p7.certificates.map((c) => c.subject.getField("CN").value)).toEqual(["Pass Type ID: pass.sa.madatrips.test", "Test WWDR"]);
    let opensslOk = true;
    try { execFileSync("openssl", ["version"], { stdio: "ignore" }); } catch { opensslOk = false; }
    if (opensslOk) {
      const dir = mkdtempSync(join(tmpdir(), "pkpass-"));
      writeFileSync(join(dir, "manifest.json"), files.get("manifest.json")!);
      writeFileSync(join(dir, "signature"), files.get("signature")!);
      writeFileSync(join(dir, "ca.pem"), certs.wwdrPem);
      const out = execFileSync("openssl", ["smime", "-verify", "-binary", "-inform", "DER", "-in", join(dir, "signature"), "-content", join(dir, "manifest.json"), "-CAfile", join(dir, "ca.pem"), "-purpose", "any", "-out", "/dev/null"], { stdio: ["ignore", "pipe", "pipe"] });
      expect(out).toBeDefined();
      // A changed manifest no longer verifies.
      writeFileSync(join(dir, "manifest.json"), Buffer.concat([files.get("manifest.json")!, Buffer.from(" ")]));
      expect(() => execFileSync("openssl", ["smime", "-verify", "-binary", "-inform", "DER", "-in", join(dir, "signature"), "-content", join(dir, "manifest.json"), "-CAfile", join(dir, "ca.pem"), "-purpose", "any", "-out", "/dev/null"], { stdio: "ignore" })).toThrow();
    }
    expect(signManifest(Buffer.from("{}"), signer).length).toBeGreaterThan(500);
  });

  it("adds a boarding pass and the hotel to Wallet, and keeps them current", async () => {
    credentials(true);
    const sent: string[] = [];
    setApnsTransport(async (r) => { sent.push(`${r.headers["apns-topic"]} ${r.path}`); return { status: 200, reason: null }; });
    const list = BoardingPassesResponse.parse((await call(withP(passesGet, { id: tripId }), { method: "GET", token: A.token })).json);
    expect(list.appleWallet).toBe(true);
    const link = WalletLinkResponse.parse((await call(withP(walletPost, { id: tripId }), { body: { passId: list.passes[0]!.id }, token: A.token })).json);
    expect(link.url).toMatch(/^https:\/\/madatrips\.test\/api\/app\/v1\/wallet\/pass\//);
    const token = link.url.split("/").pop()!;
    const res = await pkpassGet(new Request(link.url), { params: Promise.resolve({ token }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.apple.pkpass");
    const pj = JSON.parse(unzip(Buffer.from(await res.arrayBuffer())).get("pass.json")!.toString());
    expect(pj.serialNumber).toBe(`bp-${list.passes[0]!.id}`);
    expect(pj.boardingPass.headerFields[0].value).toBe("B12");
    // A tampered link is refused.
    expect((await pkpassGet(new Request(link.url), { params: Promise.resolve({ token: `${token.slice(0, -2)}xx` }) })).status).toBe(404);

    const trip = (await call(withP(tripGet, { id: tripId }), { method: "GET", token: A.token })).json.trip;
    const stayLink = await call(withP(walletPost, { id: tripId }), { body: { stayId: trip.stays[0].id }, token: A.token });
    expect(stayLink.status).toBe(200);
    const stayToken = stayLink.json.url.split("/").pop();
    const stay = JSON.parse(unzip(Buffer.from(await (await pkpassGet(new Request(stayLink.json.url), { params: Promise.resolve({ token: stayToken }) })).arrayBuffer())).get("pass.json")!.toString());
    expect(stay.generic.primaryFields[0].value).toBe("Bereketzade Hotel");
    expect(stay.barcodes).toBeUndefined();

    // Wallet registers the device, with the pass's own token.
    const serial = pj.serialNumber as string;
    const auth = `ApplePass ${pj.authenticationToken}`;
    const regParams = { device: "device-1", passType: "pass.sa.madatrips.test", serial };
    const reg = (h: string) => regPost(new Request("https://x/", { method: "POST", headers: { authorization: h }, body: JSON.stringify({ pushToken: "aabbccddeeff00112233" }) }), { params: Promise.resolve(regParams) });
    expect((await reg("ApplePass wrong")).status).toBe(401);
    expect((await reg(auth)).status).toBe(201);
    expect((await reg(auth)).status).toBe(200);

    // The gate changes: the pass gets a new version, the device a push, and Wallet fetches the new face.
    const before = Date.now() - 1;
    await applyAlert({ flightNumber: "SV263", date: "2027-03-09", gate: "C4", source: "Live · airline" });
    expect(sent).toContain("pass.sa.madatrips.test /3/device/aabbccddeeff00112233");
    const [v] = await db.select().from(appWalletPassVersions).where(eq(appWalletPassVersions.serial, serial));
    expect(v!.fingerprint.startsWith("C4|")).toBe(true);
    const changed = await regList(new Request(`https://x/?passesUpdatedSince=${before}`), { params: Promise.resolve({ device: "device-1", passType: "pass.sa.madatrips.test" }) });
    expect(changed.status).toBe(200);
    expect((await changed.json()).serialNumbers).toEqual([serial]);
    const fresh = await passkitGet(new Request("https://x/", { headers: { authorization: auth } }), { params: Promise.resolve({ passType: "pass.sa.madatrips.test", serial }) });
    expect(fresh.status).toBe(200);
    expect(JSON.parse(unzip(Buffer.from(await fresh.arrayBuffer())).get("pass.json")!.toString()).boardingPass.headerFields[0].value).toBe("C4");
    expect((await passkitGet(new Request("https://x/"), { params: Promise.resolve({ passType: "pass.sa.madatrips.test", serial }) })).status).toBe(401);
    expect((await regDelete(new Request("https://x/", { method: "DELETE", headers: { authorization: auth } }), { params: Promise.resolve(regParams) })).status).toBe(200);
  });
});

describe("the lock-screen flight", () => {
  it("registers the activity and pushes when the gate changes, then ends it after landing", async () => {
    credentials(true);
    apnsSent.length = 0;
    setApnsTransport(async () => ({ status: 200, reason: null }));
    const trip = (await call(withP(tripGet, { id: tripId }), { method: "GET", token: A.token })).json.trip;
    const out = trip.segments.find((s: { direction: string }) => s.direction === "out");
    const r = await call(livePost, { body: { tripId, segmentId: out.id, activityId: "act-1", pushToken: "ab".repeat(32), platform: "ios", locale: "ar" }, token: A.token });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.push).toBe(true);
    expect((await call(livePost, { body: { tripId, segmentId: out.id, activityId: "act-x", pushToken: null, platform: "ios" }, token: (await signIn()).token })).status).toBe(404);

    await applyAlert({ flightNumber: "SV263", date: "2027-03-09", gate: "D9", delayMin: 40, status: "delayed", source: "Live · airline" });
    const push = apnsSent.find((x) => x.headers["apns-push-type"] === "liveactivity");
    expect(push).toBeTruthy();
    expect(push!.path).toBe(`/3/device/${"ab".repeat(32)}`);
    expect(push!.headers["apns-topic"]).toBe("sa.madatrips.app.push-type.liveactivity");
    expect(push!.headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    const aps = JSON.parse(push!.body).aps;
    expect(aps.event).toBe("update");
    expect(aps["content-state"]).toMatchObject({ flight: "SV263", gate: "D9", delayMin: 40, status: "gate_changed", statusText: "البوابة صارت \u2066D9\u2069", departs: "10:20" });

    // Nothing changed: nothing sent.
    const n = apnsSent.length;
    await applyAlert({ flightNumber: "SV263", date: "2027-03-09", gate: "D9", delayMin: 40, status: "delayed", source: "Live · airline" });
    expect(apnsSent.length).toBe(n);

    const after = Date.parse("2027-03-09T13:00:00Z"); // landed 11:35Z with the delay, + 30 min
    const res = await liveJob(after);
    expect(res.ended).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(apnsSent.at(-1)!.body).aps.event).toBe("end");
    const [row] = await db.select().from(appLiveActivities).where(eq(appLiveActivities.activityId, "act-1"));
    expect(row!.endedAt).not.toBeNull();
  });

  it("sends nothing without the APNs key", async () => {
    credentials(false);
    apnsSent.length = 0;
    const trip = (await call(withP(tripGet, { id: tripId }), { method: "GET", token: A.token })).json.trip;
    const r = await call(livePost, { body: { tripId, segmentId: trip.segments[0].id, activityId: "act-2", pushToken: "cd".repeat(32), platform: "ios" }, token: A.token });
    expect(r.json.push).toBe(false);
    await applyAlert({ flightNumber: "SV263", date: "2027-03-09", gate: "E1", source: "Live · airline" });
    expect(apnsSent.filter((x) => x.headers["apns-push-type"] === "liveactivity")).toEqual([]);
  });
});
