"use server";
import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/auth";
import { optStr, str, toState, type ActionState } from "@/lib/actions";
import { isUuid } from "@/lib/security";
import { DeskError } from "@/lib/app/desk/core";
import { bookOnHotelbeds, saveWhatsOn, setWhatsOnActive } from "@/lib/app/desk/whats-on";

/* What's on (the desk's curated events) and "Book on Hotelbeds" for activity requests. */

export async function saveWhatsOnAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.view");
    const id = optStr(fd, "id");
    if (id && !isUuid(id)) throw new DeskError("Not found", "NOT_FOUND");
    await saveWhatsOn(u, id, {
      placeId: str(fd, "placeId"), title: str(fd, "title"), titleAr: optStr(fd, "titleAr"), body: optStr(fd, "body"), bodyAr: optStr(fd, "bodyAr"),
      startsOn: str(fd, "startsOn"), endsOn: str(fd, "endsOn"), time: optStr(fd, "time"), venue: optStr(fd, "venue"), imageUrl: optStr(fd, "imageUrl"),
      imageCredit: optStr(fd, "imageCredit"), link: optStr(fd, "link"), family: str(fd, "family") === "yes",
    });
    revalidatePath("/adminwork/desk/whats-on");
    return { ok: id ? "Saved" : "Added to What's on" };
  } catch (e) { return toState(e); }
}

export async function toggleWhatsOnAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.view");
    const id = str(fd, "id");
    if (!isUuid(id)) throw new DeskError("Not found", "NOT_FOUND");
    await setWhatsOnActive(u, id, str(fd, "active") === "yes");
    revalidatePath("/adminwork/desk/whats-on");
    return { ok: str(fd, "active") === "yes" ? "Showing in the app" : "Hidden from the app" };
  } catch (e) { return toState(e); }
}

export async function bookOnHotelbedsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.view");
    const id = str(fd, "id");
    if (!isUuid(id)) throw new DeskError("Not found", "NOT_FOUND");
    const note = await bookOnHotelbeds(u, id);
    revalidatePath("/adminwork/desk", "layout");
    return { ok: `Booked on Hotelbeds: ${note.reference}` };
  } catch (e) { return toState(e); }
}
