import { Platform } from 'react-native';
import { z } from 'zod';
import { passportCopyFields, walletPath, type WalletDocument } from '@mada/shared';
import { request } from './api';
import { API_MODE } from './config';
import { fileSource, useDocuments, walletApi, type PickedFile } from './wallet';

/*
 * The passport copy: a photo or PDF of the photo page, kept only when the traveller chooses to, encrypted at rest on
 * the Core API with the person's documents (kind "passport", one per person). Opened only through the owner's
 * authenticated route; on the phone it lives in memory (an image) or the cache (a PDF handed to the viewer).
 */

/** This person's copy, if they kept one. */
export function usePassportCopy(personId: string | null | undefined): WalletDocument | null {
  const docs = useDocuments();
  return (docs.data ?? []).filter((d) => d.personId === personId && d.kind === 'passport' && d.file).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/** Keep (or replace) a person's copy with the details they confirmed. The number never goes with it. */
export function keepPassportCopy(personId: string, file: PickedFile, opts: { source: 'scan' | 'upload' | 'manual'; expiry?: string | null; fields?: Record<string, string | null | undefined>; replaces?: string | null }) {
  return walletApi.addDocument({
    personId, kind: 'passport', source: opts.source, fields: passportCopyFields(opts.fields ?? {}),
    ...(opts.expiry ? { validUntil: opts.expiry } : null), ...(opts.replaces ? { replaces: opts.replaces } : null),
  }, file);
}

const MockFile = z.object({ uri: z.string() });

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Something an <Image> can show: the copy, fetched with the session and kept in memory only. */
export async function loadCopy(doc: WalletDocument): Promise<string> {
  const path = walletPath('documentFile', { id: doc.id });
  if (API_MODE === 'mock') return (await request({ method: 'GET', path }, MockFile)).uri;
  const src = fileSource(path);
  const res = await fetch(src.uri, { headers: src.headers });
  if (!res.ok) throw new Error(String(res.status));
  return `data:${doc.file?.mime ?? 'image/jpeg'};base64,${toBase64(await res.arrayBuffer())}`;
}

/** A PDF copy opens in the phone's own viewer (or a new tab on the web). */
export async function openCopyPdf(doc: WalletDocument): Promise<void> {
  const path = walletPath('documentFile', { id: doc.id });
  if (API_MODE === 'mock' || Platform.OS === 'web') {
    const uri = API_MODE === 'mock' ? (await request({ method: 'GET', path }, MockFile)).uri : await loadCopy(doc);
    if (Platform.OS === 'web') { globalThis.open?.(uri, '_blank', 'noopener'); return; }
    await (await import('expo-sharing')).shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
    return;
  }
  const [{ File, Paths }, Sharing] = await Promise.all([import('expo-file-system'), import('expo-sharing')]);
  const dest = new File(Paths.cache, 'passport-copy.pdf');
  if (dest.exists) dest.delete();
  const src = fileSource(path);
  const file = await File.downloadFileAsync(src.uri, dest, { headers: src.headers, idempotent: true });
  try { await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' }); } finally { try { file.delete(); } catch { /* the cache clears it */ } }
}
