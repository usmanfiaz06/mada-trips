import { z } from 'zod';
import { Id, IsoDateTime, IsoDay } from './common';

/*
 * Documents in chat (docs/app/ASK-INTEGRATED.md §6, U6). A photo or file sent in Ask is read on the phone first (the two
 * machine-readable lines of a passport, visa or ID); only those lines go up, and the photo itself only when the phone
 * couldn't read it. The server answers with one card: we already have it, a newer one (replace?), whose is it, their OK
 * to keep it, or we couldn't read it. Nothing is saved before the traveller taps the card. The model reads only what
 * the card says in words (first name, the last two characters, the month it expires), never the number or the lines.
 */

export const ASK_ATTACHMENTS_ROUTE = '/ask/attachments';
export const askAttachmentRoute = (id: string) => `/ask/attachments/${id}`;
export const ASK_SHARES_ROUTE = '/ask/shares';
export const askShareRoute = (id: string) => `/ask/shares/${id}`;

/** What the lines say the document is. */
export const AskDocKind = z.enum(['passport', 'visa', 'id', 'other']);
export type AskDocKind = z.infer<typeof AskDocKind>;

/**
 * Where the card stands.
 *   have_it      the same document is already on file ("We already have this one. Use it?")
 *   renewed      the same person, another number ("A newer passport for Omar. Replace the old one?")
 *   add          a person in the household by name and date of birth, nothing on file yet ("Add it?")
 *   whose        no match: "Whose passport is this?" (household names, or someone new)
 *   consent      someone outside the family: "Do you have their OK to keep it?" (keep, or this booking only)
 *   unreadable   the lines couldn't be read: take it again, or type it
 *   used · saved · replaced · booking_only · discarded   after the tap
 */
export const AskDocCase = z.enum(['have_it', 'renewed', 'add', 'whose', 'consent', 'unreadable', 'used', 'saved', 'replaced', 'booking_only', 'discarded']);
export type AskDocCase = z.infer<typeof AskDocCase>;

/** The passport against the trip this chat is about (6 months after the return, passport-ready.ts). */
export const AskDocExpiry = z.object({ state: z.enum(['ready', 'expiring']), needUntil: IsoDay, reason: z.enum(['expired', 'short']).nullable() });

export const ChatDocCard = z.object({
  type: z.literal('document'),
  attachmentId: Id,
  kind: AskDocKind,
  case: AskDocCase,
  /** The holder's first name as printed, or the household person it matched. */
  holder: z.string().max(60).nullable(),
  personId: Id.nullable(),
  /** The last two characters of the number, as the masked number already shows them. Never more. */
  ending: z.string().max(4).nullable(),
  validTo: IsoDay.nullable(),
  /** The one on file, for a renewed passport. */
  old: z.object({ ending: z.string().max(4).nullable(), validTo: IsoDay.nullable() }).nullable(),
  /** For "Whose passport is this?": the household, first names only. */
  people: z.array(z.object({ id: Id, name: z.string().max(60) })).max(8),
  expiry: AskDocExpiry.nullable(),
  /** A copy of the photo can be kept with it (the phone sent the photo). */
  hasFile: z.boolean(),
});
export type ChatDocCard = z.infer<typeof ChatDocCard>;

/** "Ask Abdullah to share": a companion with their own account shares their passport for one trip, with a tap. */
export const AskShareStatus = z.enum(['draft', 'sent', 'shared', 'declined', 'expired']);
export const ChatShareCard = z.object({
  type: z.literal('doc_share'),
  shareId: Id,
  name: z.string().max(60),
  trip: z.string().max(80).nullable(),
  status: AskShareStatus,
});
export type ChatShareCard = z.infer<typeof ChatShareCard>;

/**
 * POST /ask/attachments (multipart: optional `file`, and `meta` as JSON; or JSON with the meta alone). `mrz` is what the
 * phone read (2 or 3 lines), null when it couldn't read any; the file comes only then, or when they keep a copy.
 */
export const AskAttachmentMeta = z.object({
  threadId: Id.nullish(),
  tripId: Id.nullish(),
  mrz: z.array(z.string().max(48)).min(2).max(3).nullish(),
  source: z.enum(['camera', 'library', 'file']).default('library'),
});
export type AskAttachmentMeta = z.input<typeof AskAttachmentMeta>;

/** The tap on the card. */
export const AskDocChoice = z.enum(['use', 'add', 'replace', 'keep_old', 'not_mine', 'person', 'new_person', 'keep', 'booking_only', 'discard']);
export type AskDocChoice = z.infer<typeof AskDocChoice>;
export const AskDocTap = z.object({ choice: AskDocChoice, personId: Id.nullish(), keepCopy: z.boolean().optional() });
export type AskDocTap = z.input<typeof AskDocTap>;

/** What comes back from a read or a tap: the card as it stands, Mada's line about it, the next step. */
export const AskAttachmentResponse = z.object({
  threadId: Id,
  card: ChatDocCard,
  say: z.string(),
  next: z.array(z.string().min(1).max(60)).max(3),
  /** The traveller's own line in the chat ("Passport photo"). */
  label: z.string(),
});
export type AskAttachmentResponse = z.infer<typeof AskAttachmentResponse>;

/** GET /ask/shares/{id}: the request as each side sees it (the companion answers it, the owner sends it). */
export const AskShare = z.object({
  id: Id,
  status: AskShareStatus,
  /** The other person's first name (who asks, for the companion; who shares, for the owner). */
  name: z.string(),
  trip: z.string().nullable(),
  until: IsoDateTime.nullable(),
  mine: z.boolean(),
  /** For the owner once shared: the passport as the mask shows it. */
  ending: z.string().nullable(),
  validTo: IsoDay.nullable(),
});
export type AskShare = z.infer<typeof AskShare>;
export const AskShareResponse = z.object({ share: AskShare });
export const AskShareAnswer = z.object({ action: z.enum(['send', 'share', 'decline']) });
export type AskShareAnswer = z.infer<typeof AskShareAnswer>;

/** "Passport · Omar · ••41": the line the transcript, the desk and the model read. */
export function docLabel(kind: AskDocKind, holder: string | null, ending: string | null, words: { passport: string; visa: string; id: string; other: string }): string {
  return [words[kind], holder, ending ? `••${ending}` : null].filter(Boolean).join(' · ');
}

/** The last two characters of a masked number ("A08•••41" → "41"): what the card and the model may say. */
export const endingOf = (masked: string | null | undefined) => (masked ? masked.replace(/[^A-Z0-9]/gi, '').slice(-2) || null : null);
