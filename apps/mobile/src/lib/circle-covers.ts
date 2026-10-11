import { UploadCoverResponse, type CircleCover, type CoverPhoto } from '@mada/shared';
import { API_ORIGIN } from './config';
import { useSession } from './session';
import { multipart, type PickedFile } from './wallet';

/*
 * Circle covers on the phone: the photos we ship (the three the app always had and a few from the photo library),
 * where an uploaded cover's picture comes from, and the upload itself (multipart, straight to the Core API or the
 * in-app mock; the server checks it before anyone else in the circle sees it).
 */

export const COVER_PHOTO_SRC: Record<CoverPhoto, number> = {
  istanbul: require('../../assets/images/istanbul.jpg'),
  alula: require('../../assets/images/alula.jpg'),
  riyadh: require('../../assets/images/riyadh.jpg'),
  'dubai-skyline': require('../../assets/photos/dubai-skyline.jpg'),
  'desert-camp': require('../../assets/photos/desert-camp.jpg'),
  'maldives-overwater': require('../../assets/photos/maldives-overwater.jpg'),
  'jeddah-al-balad': require('../../assets/photos/jeddah-al-balad.jpg'),
  'abha-mountains': require('../../assets/photos/abha-mountains.jpg'),
  'baku-old-city': require('../../assets/photos/baku-old-city.jpg'),
};

/** An uploaded cover's picture: a path on the API server (signed-in read), or a local picture not uploaded yet. */
export function uploadSource(url: string | null | undefined): { uri: string; headers?: Record<string, string> } | null {
  if (!url) return null;
  if (!url.startsWith('/')) return { uri: url };
  const token = useSession.getState().tokens?.accessToken;
  return { uri: `${API_ORIGIN}${url}`, headers: token ? { Authorization: `Bearer ${token}` } : undefined };
}

/** Words on this cover: paper over a photo or a dark colour, ink on a light colour. */
export const coverIsLight = (c: CircleCover | null | undefined) => c?.kind === 'icon' && c.color !== 'green';

export const uploadCover = (file: PickedFile) => multipart('POST', '/circles/covers', file, undefined, UploadCoverResponse);

/** Covers are equal when they'd look the same. */
export function sameCover(a: CircleCover | null | undefined, b: CircleCover | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.kind === 'icon' && b.kind === 'icon') return a.icon === b.icon && a.color === b.color;
  if (a.kind === 'photo' && b.kind === 'photo') return a.id === b.id;
  if (a.kind === 'upload' && b.kind === 'upload') return a.fileId === b.fileId;
  return false;
}

/** What to send for a cover: an upload names only its file. */
export function coverInput(c: CircleCover | null) {
  if (!c) return null;
  return c.kind === 'upload' ? { kind: 'upload' as const, fileId: c.fileId } : c;
}
