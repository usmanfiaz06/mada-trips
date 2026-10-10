import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import type { PickedFile } from './wallet';

/*
 * Choosing a file: the camera (a photo of the page), the photo library, or files (photos and PDFs). Each returns one
 * PickedFile, or null when the person cancelled. Type and size are checked by the caller with the shared rules.
 */

const guessType = (name: string) => (/\.pdf$/i.test(name) ? 'application/pdf' : /\.png$/i.test(name) ? 'image/png' : /\.hei[cf]$/i.test(name) ? 'image/heic' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg');

function fromImage(a: ImagePicker.ImagePickerAsset): PickedFile {
  const name = a.fileName ?? a.file?.name ?? `photo-${Date.now()}.jpg`;
  return { uri: a.uri, name, type: a.mimeType ?? a.file?.type ?? guessType(name), size: a.fileSize ?? a.file?.size ?? 0, file: a.file ?? null };
}

/** The camera. Asks for permission first; returns 'denied' if the person said no. */
export async function takePhoto(): Promise<PickedFile | null | 'denied'> {
  // The web build opens the file chooser with the camera offered; there's no permission to ask for.
  if (Platform.OS !== 'web') {
    const perm = await ImagePicker.requestCameraPermissionsAsync().catch(() => ({ granted: true }));
    if (!perm.granted) return 'denied';
  }
  let r: ImagePicker.ImagePickerResult;
  try { r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85, exif: false }); } catch { return { uri: '', name: 'file', type: 'application/octet-stream', size: 0 }; }
  return r.canceled || !r.assets[0] ? null : fromImage(r.assets[0]);
}

export async function choosePhoto(): Promise<PickedFile | null> {
  let r: ImagePicker.ImagePickerResult;
  // The web picker refuses non-images by throwing: report it as the file it was, so the caller can explain.
  try { r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9, exif: false }); } catch { return { uri: '', name: 'file', type: 'application/octet-stream', size: 0 }; }
  return r.canceled || !r.assets[0] ? null : fromImage(r.assets[0]);
}

/** Photos or PDFs, from Files or the photo library. */
export async function chooseFile(): Promise<PickedFile | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true, multiple: false });
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  return { uri: a.uri, name: a.name, type: a.mimeType ?? a.file?.type ?? guessType(a.name), size: a.size ?? a.file?.size ?? 0, file: a.file ?? null };
}
