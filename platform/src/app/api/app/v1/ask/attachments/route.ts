import { AskAttachmentResponse, todayIn } from "@mada/shared";
import { AppError, json } from "@/lib/app/http";
import { authed } from "@/lib/app/account/route";
import { hit } from "@/lib/app/circles/limits";
import { localeOfUser } from "@/lib/app/locale";
import { readUpload } from "@/lib/app/documents/storage";
import { readAttachment } from "@/lib/app/ask-chat/attachments";

// POST /ask/attachments: a passport, visa or ID sent in Ask (docs/app/ASK-INTEGRATED.md §6). JSON { threadId?, tripId?,
// mrz: [line, line], source } when the phone read the lines; multipart (file + meta) when it couldn't, or to keep a copy.
// → { threadId, card, say, next, label }. Nothing is saved until the card is tapped (POST /ask/attachments/{id}).
export const dynamic = "force-dynamic";

export const POST = authed(async (req, { userId, ipHash }) => {
  await hit(`askdoc:min:${userId}`, 10, 60);
  await hit(`askdoc:day:${userId}`, 60, 86_400);
  const multipart = (req.headers.get("content-type") ?? "").startsWith("multipart/form-data");
  let meta: unknown;
  let file: { name: string; mime: string; bytes: Buffer } | null = null;
  if (multipart) {
    const up = await readUpload(req);
    meta = up.meta;
    file = { name: up.name, mime: up.mime, bytes: up.bytes };
  } else {
    try { meta = await req.json(); } catch { throw new AppError("VALIDATION", { fields: { meta: "json" } }); }
  }
  const out = await readAttachment(userId, meta, file, { lang: await localeOfUser(userId), ipHash, today: todayIn() });
  return json(AskAttachmentResponse.parse(out));
});
