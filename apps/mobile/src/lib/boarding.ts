import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { BoardingPassesResponse, ImportBoardingPassResponse, WalletLinkResponse, type BoardingPassView } from '@mada/shared';
import { request } from '@/lib/api';
import { kvGet, kvSet } from '@/lib/trips';
import { useSession } from '@/lib/session';
import { multipart, type PickedFile } from '@/lib/wallet';

/*
 * The airline's boarding passes on a trip (docs/app/NATIVE.md): GET /trips/{id}/boarding-passes, the traveller adding
 * the PDF, screenshot or .pkpass from the airline's check-in, and "Add to Apple Wallet". The last answer is kept on
 * the phone, so a pass opens at the gate with no signal. The barcode is always the airline's: the server reads it
 * from the file and draws it again; the phone never makes one up.
 */

const key = (tripId: string) => ['boarding', tripId] as const;
const cacheKey = (tripId: string) => `mada.boarding.${tripId}`;

async function load(tripId: string): Promise<BoardingPassesResponse> {
  try {
    const r = await request({ method: 'GET', path: `/trips/${tripId}/boarding-passes` }, BoardingPassesResponse);
    void kvSet(cacheKey(tripId), JSON.stringify(r));
    return r;
  } catch (e) {
    // No signal at the gate: the passes saved on this phone.
    const saved = await kvGet(cacheKey(tripId));
    const parsed = saved ? BoardingPassesResponse.safeParse(JSON.parse(saved)) : null;
    if (parsed?.success) return parsed.data;
    throw e;
  }
}

export function useBoardingPasses(tripId: string | null | undefined) {
  const signedIn = useSession((s) => s.status) === 'signedIn';
  const q = useQuery({ queryKey: key(tripId ?? ''), queryFn: () => load(tripId!), enabled: !!tripId && signedIn, staleTime: 60_000 });
  // Shown at once from the phone's copy while the network answers.
  const [saved, setSaved] = useState<BoardingPassesResponse | null>(null);
  useEffect(() => {
    if (!tripId) return;
    let live = true;
    void kvGet(cacheKey(tripId)).then((raw) => { if (!live || !raw) return; const p = BoardingPassesResponse.safeParse(JSON.parse(raw)); if (p.success) setSaved(p.data); });
    return () => { live = false; };
  }, [tripId]);
  return { ...q, data: q.data ?? saved ?? undefined };
}

const guessType = (name: string) => (/\.pdf$/i.test(name) ? 'application/pdf' : /\.pkpass$/i.test(name) ? 'application/vnd.apple.pkpass' : /\.png$/i.test(name) ? 'image/png' : 'image/jpeg');

/** The airline's file: a PDF, a screenshot or photo, or the Wallet file (.pkpass). Null when they cancelled. */
export async function chooseBoardingPass(): Promise<PickedFile | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*', 'application/vnd.apple.pkpass', 'com.apple.pkpass', 'application/octet-stream'], copyToCacheDirectory: true, multiple: false });
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  return { uri: a.uri, name: a.name, type: a.mimeType ?? a.file?.type ?? guessType(a.name), size: a.size ?? a.file?.size ?? 0, file: a.file ?? null };
}

export const boardingApi = {
  add: (tripId: string, file: PickedFile) => multipart('POST', `/trips/${tripId}/boarding-passes`, file, undefined, ImportBoardingPassResponse),
  remove: (tripId: string, passId: string) => request({ method: 'DELETE', path: `/trips/${tripId}/boarding-passes/${passId}` }, z.object({ deleted: z.boolean() })),
  walletLink: (tripId: string, ask: { passId: string } | { stayId: string }) => request({ method: 'POST', path: `/trips/${tripId}/wallet`, body: ask }, WalletLinkResponse),
};

export function useRefreshPasses() {
  const qc = useQueryClient();
  return (tripId: string) => qc.invalidateQueries({ queryKey: key(tripId) });
}

/** "Add to Apple Wallet": a ten-minute link Safari opens, which offers to add the signed pass. iPhone only. */
export async function addToAppleWallet(tripId: string, ask: { passId: string } | { stayId: string }): Promise<void> {
  const { url } = await boardingApi.walletLink(tripId, ask);
  await Linking.openURL(url);
}
export const canAddToAppleWallet = (enabled: boolean | undefined) => Platform.OS === 'ios' && !!enabled;

/** The passes for one flight, in the order of the trip's travellers (the family's own order). */
export function passesFor(passes: BoardingPassView[], segmentId: string, travellerIds: string[]): BoardingPassView[] {
  const mine = passes.filter((p) => p.segmentId === segmentId);
  const rank = (p: BoardingPassView) => { const i = p.travellerId ? travellerIds.indexOf(p.travellerId) : -1; return i < 0 ? 99 : i; };
  return [...mine].sort((a, b) => rank(a) - rank(b));
}

/** The server's barcode SVG, made to scale (a viewBox from its width and height) with its aspect, to draw at any width. */
export function passSvg(svg: string): { xml: string; w: number; h: number } {
  const xml = /viewBox=/.test(svg) ? svg : svg.replace(/<svg([^>]*?)\swidth="(\d+(?:\.\d+)?)"\s+height="(\d+(?:\.\d+)?)"/, '<svg$1 viewBox="0 0 $2 $3" width="$2" height="$3"');
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(xml) ?? /width="([\d.]+)"\s+height="([\d.]+)"/.exec(xml);
  return { xml, w: m ? Number(m[1]) : 3, h: m ? Number(m[2]) : 1 };
}
