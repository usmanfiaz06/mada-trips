import { UploadCoverResponse, type CoverPhoto } from '@mada/shared';
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

export const uploadCover = (file: PickedFile) => multipart('POST', '/circles/covers', file, undefined, UploadCoverResponse);

export { coverInput, coverIsLight, sameCover } from './cover-logic';
