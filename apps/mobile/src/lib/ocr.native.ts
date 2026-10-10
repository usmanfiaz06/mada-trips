import { findMrz, type MrzResult } from '@mada/shared';

/*
 * Reading the passport on the phone: ML Kit text recognition (Latin script), entirely on device, then the shared MRZ
 * parser with ICAO check digits. Needs a development build (the native module isn't in Expo Go); without it, the
 * camera screen offers the demo passport and typing it by hand.
 */

export type ReadResult = MrzResult & { attempts?: number };

type MlKit = { recognize: (uri: string) => Promise<{ text: string; blocks?: { text: string }[] }> };

function mlkit(): MlKit | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-ml-kit/text-recognition');
    return (mod?.default ?? mod) as MlKit;
  } catch {
    return null;
  }
}

export function warmUp(): void { /* ML Kit loads its model on first use, on device */ }

export const canReadPhotos = () => !!mlkit();

export async function readPassport(uri: string, onProgress: (pct: number) => void = () => {}): Promise<ReadResult> {
  const kit = mlkit();
  if (!kit) throw new Error('reader');
  onProgress(20);
  let text: string;
  try {
    const r = await kit.recognize(uri);
    text = r.text || (r.blocks ?? []).map((b) => b.text).join('\n');
  } catch (e) {
    throw new Error(/open|decode|image/i.test(String(e)) ? 'open' : 'reader');
  }
  onProgress(90);
  const out = findMrz(text);
  onProgress(100);
  return { ...out, attempts: 1 };
}
