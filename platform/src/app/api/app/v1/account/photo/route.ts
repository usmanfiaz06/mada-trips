import { AccountResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { readPhoto, removePhoto, setPhoto } from "@/lib/app/account/privacy";
import { fileResponse, readUpload } from "@/lib/app/documents/storage";
import { authed } from "@/lib/app/account/route";

// GET /account/photo → the photo (owner only). PUT (multipart "file": JPEG or PNG, up to 10 MB) → { account }. DELETE → { account }.
export const dynamic = "force-dynamic";

export const GET = authed(async (_req, { userId }) => {
  const { file, bytes } = await readPhoto(userId);
  return fileResponse(file, bytes);
});

export const PUT = authed(async (req, { userId, ipHash }) => {
  const up = await readUpload(req, { allow: ["image/jpeg", "image/png", "image/webp", "image/heic"] });
  return json(AccountResponse.parse({ account: await setPhoto(userId, up, ipHash) }));
});

export const DELETE = authed(async (_req, { userId, ipHash }) => json(AccountResponse.parse({ account: await removePhoto(userId, ipHash) })));
