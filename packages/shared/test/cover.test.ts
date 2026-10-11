import { describe, expect, it } from 'vitest';
import {
  COVER_COLORS, COVER_ICONS, COVER_PHOTOS, CircleCover, CircleCoverInput, CreateCircleRequest, UpdateCircleRequest, coverArtSvg, coverIconSvg, coverTextTone, en, ar, readCover,
} from '../src';

describe('circle covers', () => {
  it('has about thirty drawings, six colours, and a name for each in English and Arabic', () => {
    expect(COVER_ICONS.length).toBeGreaterThanOrEqual(30);
    expect(COVER_COLORS).toHaveLength(6);
    for (const i of COVER_ICONS) { expect(en[`circles.cover.icon.${i}` as keyof typeof en]).toBeTruthy(); expect(ar[`circles.cover.icon.${i}` as keyof typeof ar]).toBeTruthy(); }
    for (const c of COVER_COLORS) expect(en[`circles.cover.color.${c}` as keyof typeof en]).toBeTruthy();
    for (const p of Object.keys(COVER_PHOTOS)) expect(ar[`circles.cover.photo.${p}` as keyof typeof ar]).toBeTruthy();
  });

  it('keeps sacred places and symbols out of the library', () => {
    for (const bad of ['kaaba', 'mosque', 'minaret', 'dome', 'makkah', 'madinah', 'mecca', 'cross', 'church', 'temple']) {
      expect(COVER_ICONS.some((i) => i.includes(bad))).toBe(false);
      expect(Object.keys(COVER_PHOTOS).some((p) => p.includes(bad))).toBe(false);
    }
  });

  it('credits every library photo', () => {
    for (const [id, p] of Object.entries(COVER_PHOTOS)) if (!['istanbul', 'alula', 'riyadh'].includes(id)) expect(p.credit).toMatch(/Unsplash/);
  });

  it('draws every icon as clean SVG, big and small', () => {
    for (const icon of COVER_ICONS) {
      const one = coverIconSvg(icon);
      expect(one).toMatch(/^<svg [^>]*viewBox="0 0 64 64">(<path [^>]+\/>)+<\/svg>$/);
      expect(one).not.toMatch(/NaN|undefined/);
      for (const color of COVER_COLORS) {
        const banner = coverArtSvg({ icon, color }, { width: 343, height: 200 });
        expect(banner).not.toMatch(/NaN|undefined/);
        expect(banner).toContain('viewBox="0 0 343 200"');
        const badge = coverArtSvg({ icon, color }, { width: 24, height: 24, layout: 'badge' });
        expect(badge).not.toMatch(/NaN|undefined/);
        expect(badge.length).toBeLessThan(banner.length); // no pattern at tiny sizes
      }
    }
    expect(coverArtSvg({ icon: 'plane', color: 'green' }, { width: 343, height: 200, side: 'left' })).not.toEqual(coverArtSvg({ icon: 'plane', color: 'green' }, { width: 343, height: 200, side: 'right' }));
    expect(coverTextTone('green')).toBe('paper');
    expect(coverTextTone('sand')).toBe('ink');
  });

  it('validates covers: icons on a colour, photos we ship, uploads by file', () => {
    expect(CircleCoverInput.parse({ kind: 'icon', icon: 'camel', color: 'rose' })).toEqual({ kind: 'icon', icon: 'camel', color: 'rose' });
    expect(CircleCoverInput.parse('alula')).toEqual({ kind: 'photo', id: 'alula' });
    expect(CircleCoverInput.parse({ kind: 'photo', id: 'baku-old-city' })).toEqual({ kind: 'photo', id: 'baku-old-city' });
    expect(CircleCoverInput.parse({ kind: 'upload', fileId: '00000000-0000-4000-8000-000000000001', status: 'approved' })).toEqual({ kind: 'upload', fileId: '00000000-0000-4000-8000-000000000001' });
    expect(() => CircleCoverInput.parse({ kind: 'icon', icon: 'kaaba', color: 'green' })).toThrow();
    expect(() => CircleCoverInput.parse({ kind: 'icon', icon: 'plane', color: 'purple' })).toThrow();
    expect(() => CircleCoverInput.parse({ kind: 'photo', id: 'makkah-clock-tower' })).toThrow();
    expect(() => CircleCoverInput.parse({ kind: 'upload', fileId: 'not-an-id' })).toThrow();
    expect(() => CircleCoverInput.parse({ kind: 'upload', url: 'https://evil.example/x.jpg' })).toThrow();
    expect(CreateCircleRequest.parse({ name: 'Family' }).cover).toBeNull();
    expect(CreateCircleRequest.parse({ name: 'Family', cover: 'riyadh' }).cover).toEqual({ kind: 'photo', id: 'riyadh' });
    expect(UpdateCircleRequest.parse({ cover: { kind: 'icon', icon: 'cake', color: 'gold' } }).cover).toEqual({ kind: 'icon', icon: 'cake', color: 'gold' });
  });

  it('reads stored covers leniently: old keys are photos, junk is plain green', () => {
    expect(readCover('istanbul')).toEqual({ kind: 'photo', id: 'istanbul' });
    expect(readCover(null)).toBeNull();
    expect(readCover('nowhere')).toBeNull();
    expect(readCover({ kind: 'upload', fileId: '00000000-0000-4000-8000-000000000001', status: 'pending' })).toEqual({ kind: 'upload', fileId: '00000000-0000-4000-8000-000000000001', status: 'pending', url: null });
    expect(CircleCover.safeParse({ kind: 'upload', fileId: '00000000-0000-4000-8000-000000000001', status: 'maybe' }).success).toBe(false);
  });
});
