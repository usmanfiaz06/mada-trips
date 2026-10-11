import type { CircleCover } from '@mada/shared';

/* Small rules about circle covers, without React Native (unit-tested in test/unit/covers.test.ts). */

/** Words on this cover: paper over a photo or a dark colour, ink on a light colour. */
export const coverIsLight = (c: CircleCover | null | undefined) => c?.kind === 'icon' && c.color !== 'green';

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
