import { Linking, Platform } from 'react-native';
import { directionsLinks, offeredLinks, openUrlOf, type GoLink, type GoMode, type GoPlatform, type GoTarget } from '@mada/shared';

/*
 * Directions from Things to do: which maps and ride apps this phone has (Linking.canOpenURL, the schemes are declared
 * in app.json › ios.infoPlist.LSApplicationQueriesSchemes and as Android <queries> in app.config.js), and opening one,
 * falling back to its web page when the app says no. The links themselves are built in @mada/shared (directions.ts).
 */

export type Offered = GoLink & { installed: boolean };

export const platformOf = (): GoPlatform => (Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web');

/** The apps to offer for a place, checking each probe once. `canOpen` is injectable for tests. */
export async function appsFor(t: GoTarget, mode: GoMode, platform: GoPlatform = platformOf(), canOpen: (url: string) => Promise<boolean> = (u) => Linking.canOpenURL(u)): Promise<Offered[]> {
  const links = directionsLinks(t, platform, mode);
  const probes = [...new Set(links.map((l) => l.probe).filter((p): p is string => !!p))];
  const answers = await Promise.all(probes.map(async (p) => [p, await canOpen(p).catch(() => false)] as const));
  const has = new Map(answers);
  return offeredLinks(links, (p) => has.get(p) === true);
}

/** Open the app (or its web page when it isn't installed or refuses). On the web, a new tab. */
export async function openDirections(l: Offered, open: (url: string) => Promise<unknown> = (u) => Linking.openURL(u)): Promise<string> {
  const first = openUrlOf(l);
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(first, '_blank', 'noopener');
    return first;
  }
  try {
    await open(first);
    return first;
  } catch {
    if (l.web && l.web !== first) { await open(l.web); return l.web; }
    throw new Error('cannot open');
  }
}
