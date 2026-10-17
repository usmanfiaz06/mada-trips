import "server-only";
import { createHash } from "node:crypto";
import forge from "node-forge";
import { catalogueFor, type BarcodeFormat } from "@mada/shared";
import { zip } from "../boarding/zip";
import { PASS_IMAGES } from "./images";
import type { PassSigner } from "./config";

/*
 * Signed Apple Wallet passes (.pkpass): pass.json, the pictures, en/ar strings, manifest.json (SHA-1 of every file)
 * and signature (a detached PKCS #7 of the manifest, signed with the Pass Type ID certificate, carrying Apple's WWDR
 * intermediate). A boarding pass carries the airline's own barcode text; a hotel pass carries none.
 */

const PK_FORMAT: Record<BarcodeFormat, string> = { pdf417: "PKBarcodeFormatPDF417", aztec: "PKBarcodeFormatAztec", qr: "PKBarcodeFormatQR" };

export type PassService = { serial: string; authToken: string; webServiceURL: string | null };

export type FlightPass = PassService & {
  kind: "flight";
  airline: string; brand: string; flightNumber: string; carrierCode: string;
  from: string; to: string; fromCity: string; toCity: string;
  /** "2027-03-09T09:40" at the departure airport, its zone offset, and the instant. */
  departLocal: string; departIso: string; arriveIso: string; boards: string; departs: string;
  gate: string | null; terminal: string | null; seat: string; sequence: string; pnr: string; passenger: string;
  format: BarcodeFormat; message: string; cancelled: boolean;
};

export type StayPass = PassService & {
  kind: "stay";
  hotel: string; checkIn: string; nights: number; rooms: number; confirmation: string | null; address: string | null; relevantIso: string; city: string;
};

const field = (key: string, label: string, value: string | number, extra: Record<string, unknown> = {}) => ({ key, label, value, ...extra });
const rgb = (hex: string) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `rgb(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)})` : "rgb(30, 53, 45)";
};

export function passJson(p: FlightPass | StayPass, signer: Pick<PassSigner, "teamId" | "passTypeId">): Record<string, unknown> {
  const base: Record<string, unknown> = {
    formatVersion: 1, passTypeIdentifier: signer.passTypeId, teamIdentifier: signer.teamId, serialNumber: p.serial,
    organizationName: "Mada Trips", foregroundColor: "rgb(255, 253, 249)", labelColor: "rgb(212, 190, 140)",
    ...(p.webServiceURL ? { webServiceURL: p.webServiceURL, authenticationToken: p.authToken } : {}),
  };
  if (p.kind === "flight") {
    return {
      ...base,
      description: `${p.airline} ${p.flightNumber} boarding pass`, logoText: p.airline, backgroundColor: rgb(p.brand),
      relevantDate: p.departIso, relevantDates: [{ startDate: new Date(Date.parse(p.departIso) - 4 * 3_600_000).toISOString(), endDate: p.arriveIso }],
      expirationDate: new Date(Date.parse(p.arriveIso) + 24 * 3_600_000).toISOString(), voided: p.cancelled,
      barcodes: [{ format: PK_FORMAT[p.format], message: p.message, messageEncoding: "iso-8859-1" }],
      semantics: {
        airlineCode: p.carrierCode, flightCode: p.flightNumber, flightNumber: Number(p.flightNumber.replace(/^\D+/, "")) || undefined,
        departureAirportCode: p.from, destinationAirportCode: p.to, departureGate: p.gate ?? undefined, departureTerminal: p.terminal ?? undefined,
        originalDepartureDate: p.departIso, currentDepartureDate: p.departIso, seats: [{ seatNumber: p.seat }], passengerName: { familyName: p.passenger.split("/")[0], givenName: p.passenger.split("/")[1] ?? "" },
        confirmationNumber: p.pnr,
      },
      boardingPass: {
        transitType: "PKTransitTypeAir",
        headerFields: [field("gate", "pkpass.gate", p.gate ?? "–", { changeMessage: "pkpass.gateChanged" })],
        primaryFields: [field("from", p.fromCity, p.from), field("to", p.toCity, p.to)],
        secondaryFields: [field("passenger", "pkpass.passenger", p.passenger), field("flight", "pkpass.flight", p.flightNumber)],
        auxiliaryFields: [
          field("boards", "pkpass.boards", p.boards, { changeMessage: "pkpass.timeChanged" }),
          field("departs", "pkpass.departs", p.departs, { changeMessage: "pkpass.timeChanged" }),
          field("seat", "pkpass.seat", p.seat || "–"), field("seq", "pkpass.seq", p.sequence),
        ],
        backFields: [field("pnr", "pkpass.pnr", p.pnr), field("help", "pkpass.help", "pkpass.helpBody")],
      },
    };
  }
  return {
    ...base,
    description: `${p.hotel}, ${p.city}`, logoText: "Mada Trips", backgroundColor: "rgb(30, 53, 45)", relevantDate: p.relevantIso,
    generic: {
      primaryFields: [field("hotel", "pkpass.hotel", p.hotel)],
      secondaryFields: [field("checkIn", "pkpass.checkIn", p.checkIn), field("nights", "pkpass.nights", p.nights)],
      auxiliaryFields: [field("rooms", "pkpass.rooms", p.rooms), ...(p.confirmation ? [field("conf", "pkpass.confirmation", p.confirmation)] : [])],
      backFields: [...(p.address ? [field("address", "pkpass.address", p.address)] : []), field("help", "pkpass.help", "pkpass.helpBody")],
    },
  };
}

/** pass.strings for one language: every pkpass.* key in the catalogue. */
export function passStrings(locale: "en" | "ar"): Buffer {
  const cat = catalogueFor(locale);
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  const lines = Object.entries(cat).filter(([k]) => k.startsWith("pkpass.")).map(([k, v]) => `"${k}" = "${esc(v)}";`);
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

const sha1 = (b: Buffer) => createHash("sha1").update(b).digest("hex");

/** A detached PKCS #7 signature of `data`, by the pass certificate, carrying the WWDR intermediate. */
export function signManifest(data: Buffer, s: Pick<PassSigner, "certPem" | "keyPem" | "wwdrPem">, at = new Date()): Buffer {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(data.toString("binary"));
  const cert = forge.pki.certificateFromPem(s.certPem);
  p7.addCertificate(cert);
  p7.addCertificate(forge.pki.certificateFromPem(s.wwdrPem));
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(s.keyPem), certificate: cert, digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: at as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), "binary");
}

/** The whole .pkpass, signed. */
export function buildPkpass(p: FlightPass | StayPass, signer: PassSigner): { bytes: Buffer; files: Map<string, Buffer>; manifest: Record<string, string> } {
  const files = new Map<string, Buffer>();
  files.set("pass.json", Buffer.from(JSON.stringify(passJson(p, signer)), "utf8"));
  for (const [name, b64] of Object.entries(PASS_IMAGES)) files.set(name, Buffer.from(b64, "base64"));
  files.set("en.lproj/pass.strings", passStrings("en"));
  files.set("ar.lproj/pass.strings", passStrings("ar"));
  const manifest = Object.fromEntries([...files].map(([n, b]) => [n, sha1(b)]));
  const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8");
  files.set("manifest.json", manifestBytes);
  files.set("signature", signManifest(manifestBytes, signer));
  return { bytes: zip([...files].map(([name, data]) => ({ name, data }))), files, manifest };
}
