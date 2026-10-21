import {
  ASK_ATTACHMENTS_ROUTE, AskAttachmentResponse, AskShareResponse, UPLOAD_MAX_BYTES, askAttachmentRoute, askShareRoute,
  type AskAttachmentMeta, type AskDocTap, type AskShareAnswer, type ChatCard,
} from '@mada/shared';
import { request } from './api';
import { API_MODE, SHOW_DEMO_HINTS } from './config';
import { useAskChat, type ChatTurn } from './ask-chat';
import { buzz } from './haptics';
import { t } from './i18n';
import { chooseFile, choosePhoto, takePhoto } from './pick';
import { isPdf } from './passport-scan';
import { toast } from './toast';
import { multipart, type PickedFile } from './wallet';

/*
 * Documents in Ask (docs/app/ASK-INTEGRATED.md §6): the composer's + opens the camera, the photo library or files. A
 * photo is read on the phone first (lib/ocr, the same reader as the passport scan); when its two lines read with valid
 * check digits only those lines go up, never the photo. When they don't (or it's a PDF) the file goes, encrypted, and
 * the server keeps it at most 24 hours. The answer is one card in the chat; nothing is saved until it's tapped.
 */

export type AttachSource = 'camera' | 'library' | 'file';

/** Mock builds only, for the web e2e and screenshots: `__MADA_DEMO__.attachMrz` stands for a photo read on the phone. */
function demoLines(): string[] | null {
  if (API_MODE !== 'mock' || !SHOW_DEMO_HINTS) return null;
  const v = (globalThis as { __MADA_DEMO__?: { attachMrz?: unknown } }).__MADA_DEMO__?.attachMrz;
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
}

async function pick(source: AttachSource): Promise<PickedFile | null | 'denied'> {
  if (source === 'camera') return takePhoto();
  if (source === 'library') return choosePhoto();
  return chooseFile();
}

/** The two lines, read on the phone, or null. Never throws: a reader that can't load means the file goes instead. */
async function readOnPhone(f: PickedFile): Promise<string[] | null> {
  if (isPdf(f) || !f.uri) return null;
  try {
    const { readPassport } = await import('./ocr');
    const r = await readPassport(f.uri);
    return r.ok && r.lines.length >= 2 ? r.lines : null;
  } catch {
    return null;
  }
}

export const askDocsApi = {
  send: (meta: AskAttachmentMeta, file: PickedFile | null) =>
    file ? multipart('POST', ASK_ATTACHMENTS_ROUTE, file, meta, AskAttachmentResponse) : request({ method: 'POST', path: ASK_ATTACHMENTS_ROUTE, body: meta }, AskAttachmentResponse),
  tap: (id: string, tap: AskDocTap) => request({ method: 'POST', path: askAttachmentRoute(id), body: tap }, AskAttachmentResponse),
  share: (id: string) => request({ method: 'GET', path: askShareRoute(id), retries: 0 }, AskShareResponse),
  answerShare: (id: string, action: AskShareAnswer['action']) => request({ method: 'POST', path: askShareRoute(id), body: { action } }, AskShareResponse),
};

let seq = 1_000_000;
const update = (id: number, fn: (x: ChatTurn) => ChatTurn) => useAskChat.setState((s) => ({ turns: s.turns.map((x) => (x.id === id ? fn(x) : x)) }));

/**
 * The + in Ask: pick, read on the phone, send, and show the answer as a turn of the chat (the traveller's line by its
 * masked label, Mada's line and the card). Resolves when it is on screen (or the traveller cancelled).
 */
export async function attachToChat(source: AttachSource, opts: { tripId?: string | null } = {}): Promise<void> {
  const demo = demoLines();
  const picked = demo ? null : await pick(source);
  if (picked === 'denied') { toast(t('passport.camera.deniedTitle')); return; }
  if (!demo && !picked) return;
  if (picked && picked.size > UPLOAD_MAX_BYTES) { toast(t('doc.attach.tooBig')); return; }
  buzz('tap');
  const id = ++seq;
  const at = new Date().toISOString();
  const blank: ChatTurn = { id, me: t(picked && isPdf(picked) ? 'doc.me.file' : 'doc.me.photo'), at, attachment: { kind: 'other', label: '' }, text: '', status: t('doc.attach.reading'), statusTool: 'read_document', cards: [], pay: null, handoff: null, intent: null, lang: 'en', state: 'streaming' };
  useAskChat.setState((s) => ({ turns: [...s.turns, blank].slice(-12), busy: true }));
  try {
    const mrz = demo ?? (picked ? await readOnPhone(picked) : null);
    const meta: AskAttachmentMeta = { threadId: useAskChat.getState().threadId, tripId: opts.tripId ?? null, mrz, source };
    // Read on the phone: only the lines go up. Not read: the file goes (encrypted, kept a day at most).
    const r = await askDocsApi.send(meta, mrz ? null : picked);
    useAskChat.setState({ threadId: r.threadId });
    update(id, (x) => ({ ...x, me: r.label, attachment: { kind: r.card.kind, label: r.label }, text: r.say, cards: [r.card], status: null, statusTool: null, state: 'done', next: r.next.length ? r.next : undefined }));
  } catch {
    useAskChat.setState((s) => ({ turns: s.turns.filter((x) => x.id !== id) }));
    toast(t('doc.attach.notSent'));
  } finally {
    useAskChat.setState({ busy: false });
  }
}

/**
 * A tap on a document card: the server's answer moves the card under Mada's new line (the question it answered stays
 * above, without its buttons).
 */
export async function tapDocument(turnId: number, attachmentId: string, tap: AskDocTap): Promise<boolean> {
  try {
    const r = await askDocsApi.tap(attachmentId, tap);
    buzz(r.card.case === 'discarded' ? 'soft' : 'success');
    const keep = (c: ChatCard) => !(c.type === 'document' && c.attachmentId === attachmentId);
    const next: ChatTurn = { id: ++seq, me: '', text: r.say, status: null, cards: [r.card], pay: null, handoff: null, intent: null, lang: 'en', state: 'done', at: new Date().toISOString() };
    useAskChat.setState((s) => ({ turns: [...s.turns.map((x) => (x.id === turnId ? { ...x, cards: x.cards.filter(keep) } : x)), next].slice(-12) }));
    return true;
  } catch {
    toast(t('doc.attach.notSent'));
    return false;
  }
}

/** "Ask Abdullah to share": the owner's tap sends the request; the card shows where it stands. */
export async function sendShare(turnId: number, shareId: string): Promise<boolean> {
  try {
    const r = await askDocsApi.answerShare(shareId, 'send');
    buzz('success');
    useAskChat.setState((s) => ({
      turns: s.turns.map((x) => (x.id === turnId ? { ...x, cards: x.cards.map((c) => (c.type === 'doc_share' && c.shareId === shareId ? { ...c, status: r.share.status } : c)) } : x)),
    }));
    return true;
  } catch {
    toast(t('doc.attach.notSent'));
    return false;
  }
}
