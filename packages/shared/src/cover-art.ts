/*
 * Circle covers drawn by hand: about thirty small travel drawings in Mada's illustration style (the empty-state art:
 * ink green outlines, gold, paper, a few soft accents), each on one of six background colours with a quiet pattern.
 *
 * Plain data and a string builder, so every surface draws the same picture: the app (react-native-svg SvgXml), the
 * prototype (inline <svg>), the invite page (inline <svg>) and its og:image (next/og, as an SVG data URI).
 * Each drawing sits in a 64×64 box. Religious symbols stay out on purpose (no Kaaba, no minarets, no domes).
 */

export const COVER_ICONS = [
  'plane', 'suitcase', 'passport', 'palm', 'camel', 'tent', 'dallah', 'dates', 'beach', 'wave', 'mountain', 'snow',
  'ferris', 'balloon', 'ship', 'train', 'car', 'pin', 'compass', 'camera', 'icecream', 'football', 'castle', 'sun',
  'moon', 'lantern', 'family', 'kids', 'gift', 'cake', 'heart',
] as const;
export type CoverIcon = (typeof COVER_ICONS)[number];

export const COVER_COLORS = ['green', 'sand', 'gold', 'sky', 'rose', 'sage'] as const;
export type CoverColor = (typeof COVER_COLORS)[number];

/** Each background: its colour, its pattern's colour, and whether words on it are paper (light) or ink (dark). */
export const COVER_COLOR_INFO: Record<CoverColor, { bg: string; dot: string; ring: string; text: 'paper' | 'ink' }> = {
  green: { bg: '#1e352d', dot: 'rgba(255,253,249,0.10)', ring: 'rgba(217,183,122,0.22)', text: 'paper' },
  sand: { bg: '#efe4cf', dot: 'rgba(30,53,45,0.08)', ring: 'rgba(185,143,74,0.22)', text: 'ink' },
  gold: { bg: '#e2c48d', dot: 'rgba(30,53,45,0.09)', ring: 'rgba(255,253,249,0.38)', text: 'ink' },
  sky: { bg: '#cfe2e4', dot: 'rgba(30,53,45,0.08)', ring: 'rgba(255,253,249,0.5)', text: 'ink' },
  rose: { bg: '#f3d6ca', dot: 'rgba(30,53,45,0.08)', ring: 'rgba(255,253,249,0.5)', text: 'ink' },
  sage: { bg: '#d4e1cd', dot: 'rgba(30,53,45,0.08)', ring: 'rgba(255,253,249,0.5)', text: 'ink' },
};

/**
 * The photos a circle can wear: the three the app always had, and a few from the photo library (docs/app/photos,
 * Unsplash Licence; credit kept with each). Places only, no people's faces, no sacred sites.
 */
export const COVER_PHOTOS = {
  istanbul: { city: 'Istanbul', credit: null, url: null, focal: '50% 50%' },
  alula: { city: 'AlUla', credit: null, url: null, focal: '50% 50%' },
  riyadh: { city: 'Riyadh', credit: null, url: null, focal: '50% 50%' },
  'dubai-skyline': { city: 'Dubai', credit: 'Pratiksha Singh / Unsplash', url: 'https://unsplash.com/photos/BS__o6_njiQ', focal: '50% 50%' },
  'desert-camp': { city: 'Desert camp', credit: 'Tommaso Ubezio / Unsplash', url: 'https://unsplash.com/photos/EElsYQmh8ZU', focal: '50% 60%' },
  'maldives-overwater': { city: 'Maldives', credit: 'Matheen Faiz / Unsplash', url: 'https://unsplash.com/photos/iwZqmickJxA', focal: '50% 50%' },
  'jeddah-al-balad': { city: 'Jeddah', credit: 'Jeremiah Del Mar / Unsplash', url: 'https://unsplash.com/photos/6GDl1D5JZQs', focal: '50% 40%' },
  'abha-mountains': { city: 'Abha', credit: 'Mustafa Ahmed / Unsplash', url: 'https://unsplash.com/photos/MWQxR33Pbck', focal: '50% 50%' },
  'baku-old-city': { city: 'Baku', credit: 'Azar Kazimli / Unsplash', url: 'https://unsplash.com/photos/AOWi0OXBUQo', focal: '45% 55%' },
} as const;
export type CoverPhoto = keyof typeof COVER_PHOTOS;
export const COVER_PHOTO_IDS = Object.keys(COVER_PHOTOS) as [CoverPhoto, ...CoverPhoto[]];

/* ───────────── the drawings ───────────── */

const INK = '#1e352d';
const GOLD = '#d9b77a';
const GOLDD = '#b98f4a';
const BROWN = '#7d5d27';
const PAPER = '#fffdf9';
const CREAM = '#fff7e6';
const LINE = '#e3d6bf';
const SKY = '#9fc6cc';
const SEA = '#5f939d';
const ROSE = '#eba895';
const RED = '#cf6a55';
const SAGE = '#9fbd93';

/** One stroke of a drawing: a path, its fill, its outline and width, and an optional transform. */
type Mark = { d: string; fill?: string; stroke?: string; w?: number; t?: string; cap?: boolean };
const m = (d: string, fill = 'none', stroke: string | undefined = INK, w = 2, t?: string): Mark => ({ d, fill, stroke, w, t });
const line = (d: string, stroke = INK, w = 2): Mark => ({ d, fill: 'none', stroke, w, cap: true });
const circ = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const ell = (cx: number, cy: number, rx: number, ry: number) => `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
const rr = (x: number, y: number, w: number, h: number, r: number) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const polar = (cx: number, cy: number, r: number, deg: number) => [r2(cx + r * Math.sin((deg * Math.PI) / 180)), r2(cy - r * Math.cos((deg * Math.PI) / 180))] as const;
const rays = (cx: number, cy: number, r1: number, r2_: number, n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => { const a = offset + (360 / n) * i; const [x1, y1] = polar(cx, cy, r1, a); const [x2, y2] = polar(cx, cy, r2_, a); return `M${x1} ${y1}L${x2} ${y2}`; }).join('');
const poly = (cx: number, cy: number, r: number, n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => { const [x, y] = polar(cx, cy, r, offset + (360 / n) * i); return `${i ? 'L' : 'M'}${x} ${y}`; }).join('') + 'Z';
const sparkle = (cx: number, cy: number, s: number) => `M${cx} ${cy - s}Q${cx + s * 0.18} ${cy - s * 0.18} ${cx + s} ${cy}Q${cx + s * 0.18} ${cy + s * 0.18} ${cx} ${cy + s}Q${cx - s * 0.18} ${cy + s * 0.18} ${cx - s} ${cy}Q${cx - s * 0.18} ${cy - s * 0.18} ${cx} ${cy - s}Z`;

const snowflake = (): Mark[] => {
  const arms: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = i * 60;
    const [x1, y1] = polar(32, 32, 5, a); const [x2, y2] = polar(32, 32, 24, a);
    arms.push(`M${x1} ${y1}L${x2} ${y2}`);
    for (const [at, len] of [[13, 6], [19, 4.5]] as const) {
      const [bx, by] = polar(32, 32, at, a);
      const [lx, ly] = polar(bx, by, len, a - 45); const [rx, ry] = polar(bx, by, len, a + 45);
      arms.push(`M${lx} ${ly}L${bx} ${by}L${rx} ${ry}`);
    }
  }
  return [line(arms.join(''), INK, 2.4), m(poly(32, 32, 5, 6), GOLD, INK, 1.6)];
};

const ferris = (): Mark[] => {
  const cabins = Array.from({ length: 8 }, (_, i) => { const [x, y] = polar(32, 27, 20, i * 45); return m(circ(x, y, 3.6), [GOLD, ROSE, SKY, SAGE][i % 4], INK, 1.6); });
  return [
    line('M32 27L20 57M32 27L44 57M14 57H50', INK, 2.4),
    m(circ(32, 27, 20), 'none', INK, 2.2), m(circ(32, 27, 13), 'none', LINE, 1.4),
    line(rays(32, 27, 4, 20, 8), INK, 1.4),
    m(circ(32, 27, 4), GOLD, INK, 1.8),
    ...cabins,
  ];
};

const football = (): Mark[] => {
  const spokes: string[] = [];
  const patches: Mark[] = [];
  for (let i = 0; i < 5; i++) {
    const a = i * 72;
    const [x1, y1] = polar(32, 32, 7, a); const [x2, y2] = polar(32, 32, 15, a);
    spokes.push(`M${x1} ${y1}L${x2} ${y2}`);
    const [px, py] = polar(32, 32, 19.5, a + 36);
    patches.push(m(poly(px, py, 4.2, 5, a + 36 + 180), INK, INK, 1.2));
  }
  return [m(circ(32, 32, 23), PAPER, INK, 2.2), line(spokes.join(''), INK, 1.6), ...patches, m(poly(32, 32, 7.5, 5), INK, INK, 1.4), m(circ(32, 32, 23), 'none', INK, 2.2)];
};

const DRAWINGS: Record<CoverIcon, Mark[]> = {
  plane: [
    m('M36 28l18 10v5l-18-5z', GOLD, INK, 2, 'rotate(45 32 32)'),
    m('M28 28l-18 10v5l18-5z', GOLD, INK, 2, 'rotate(45 32 32)'),
    m('M28 16c0-4 1.5-8 4-8s4 4 4 8v32l6 5v4l-10-3-10 3v-4l6-5z', PAPER, INK, 2, 'rotate(45 32 32)'),
    { d: 'M30.5 15.5h3', fill: 'none', stroke: GOLDD, w: 2, cap: true, t: 'rotate(45 32 32)' },
  ],
  suitcase: [
    m('M24 22v-5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v5', 'none', INK, 2.4),
    m(rr(8, 22, 48, 32, 5), GOLD, INK, 2.2),
    line('M19 22v32M45 22v32', INK, 2.2),
    m(circ(32, 38, 5), PAPER, INK, 1.6),
    line('M30 38h4', GOLDD, 1.6),
    line('M14 56v2M50 56v2', INK, 2.4),
  ],
  passport: [
    m(rr(28, 10, 26, 40, 3), PAPER, INK, 1.8, 'rotate(12 41 30)'),
    line('M33 20h14M33 26h10', LINE, 1.6),
    m(rr(12, 10, 30, 44, 4), INK, INK, 2),
    m(circ(27, 28, 7.5), 'none', GOLD, 1.6),
    m(ell(27, 28, 3.4, 7.5), 'none', GOLD, 1.2),
    line('M19.5 28h15', GOLD, 1.2),
    line('M20 43h14M22 47h10', GOLD, 1.6),
  ],
  palm: [
    line('M10 57h44', INK, 2.4),
    m('M27.5 57c1.5-12 1-23-2-33h5c3 10 3.5 21 3 33z', GOLD, INK, 1.8),
    line('M27 30h5M27.5 37h5.5M28 44h5.5M28 51h5.5', GOLDD, 1.2),
    m('M29 22c-6-8-16-8-22-2 8-2 15 0 22 2z', SAGE, INK, 1.8),
    m('M29 22c6-9 17-9 25-2-9-2-17 0-25 2z', SAGE, INK, 1.8),
    m('M29 22c-2-8-8-13-15-13 5 3 10 8 15 13z', SAGE, INK, 1.8),
    m('M29 22c3-8 10-12 17-11-6 2-12 6-17 11z', SAGE, INK, 1.8),
    m('M29 22c-8 1-14 7-16 14 4-6 10-11 16-14z', SAGE, INK, 1.8),
    m('M29 22c8 0 15 6 17 13-5-6-11-10-17-13z', SAGE, INK, 1.8),
    m(circ(26.5, 24.5, 2.6), BROWN, INK, 1.4), m(circ(31.5, 25.5, 2.6), BROWN, INK, 1.4),
  ],
  camel: [
    line('M6 56h52', INK, 2.4),
    line('M19 38v17M25 38v17M38 38v17M44 36v19', INK, 3),
    line('M12 34c-3 2-3 6-2 9', INK, 1.8),
    m('M12 36C12 28 16 25 20 24 22 16 32 14 35 22c2 4 5 4 7 0l4-10c1-3 5-3 7-1l3 2c1 1 0 3-2 3h-2l-3 10c-1 7-4 11-10 12H18c-3 0-6-1-6-2z', GOLD, INK, 2),
    m('M23 23c3-5 9-5 11 0l-1 5h-9z', ROSE, INK, 1.6),
    line('M23 28h10', RED, 1.4),
    m(circ(51.5, 13, 0.9), INK, INK, 1),
  ],
  tent: [
    line('M4 50h56', INK, 2.4),
    line('M20 24v-6M44 24v-6', INK, 2.2),
    m('M6 50C10 38 16 29 20 24c6 4 18 4 24 0 4 5 10 14 14 26z', INK, INK, 2),
    line('M13 38c10 2.5 28 2.5 38 0M10 44c12 2.5 32 2.5 44 0', GOLD, 2),
    m('M27 50c0-8 2-12 5-15 3 3 5 7 5 15z', GOLD, INK, 1.8),
    line('M42 57c5-3 11-3 16 0M6 57c4-2 8-2 12 0', GOLDD, 1.6),
    m(sparkle(50, 12, 4), GOLD, GOLDD, 1),
  ],
  dallah: [
    m('M24 43C16 40 12 32 8 22l4-1c3 8 8 13 14 15', GOLD, INK, 2),
    m('M38 27c12 0 12 16 4 17', 'none', INK, 2.6),
    m('M20 52c0-8 4-12 7-14-1-5-1-8-2-14h14c-1 6-1 9-2 14 3 2 7 6 7 14z', GOLD, INK, 2),
    m('M25 24c1-6 13-6 14 0z', GOLD, INK, 2),
    line('M32 18v-4', INK, 2),
    m(circ(32, 11.5, 2.4), GOLD, INK, 1.6),
    line('M22 46h20M26.5 31h11', GOLDD, 1.6),
    line('M17 52h30', INK, 2.4),
  ],
  dates: [
    m(ell(22, 31, 6, 4), BROWN, INK, 1.6, 'rotate(-20 22 31)'),
    m(ell(42, 31, 6, 4), BROWN, INK, 1.6, 'rotate(20 42 31)'),
    m(ell(27, 25, 6, 4), BROWN, INK, 1.6, 'rotate(-10 27 25)'),
    m(ell(37, 25, 6, 4), BROWN, INK, 1.6, 'rotate(10 37 25)'),
    m(ell(32, 31, 6, 4), BROWN, INK, 1.6),
    line('M29 23.5c2-1 4-1 5 0M39 29.5c2-1 3 0 4 1', GOLD, 1.2),
    m('M8 34h48c0 11-11 20-24 20S8 45 8 34z', PAPER, INK, 2),
    line('M13 40h38', LINE, 1.6),
  ],
  beach: [
    m('M4 58c8-9 48-9 56 0z', GOLD, INK, 2),
    line('M31 27l5 28', INK, 2.4),
    m('M8 30C10 16 20 9 32 9s22 7 24 21c-4-3-8-3-12 0-4-3-8-3-12 0-4-3-8-3-12 0-4-3-8-3-12 0z', ROSE, INK, 2),
    m('M20 30C21 18 26 11 32 9c-2 7-1 14 0 21-4-3-8-3-12 0z', PAPER, INK, 1.6),
    m('M44 30C43 18 38 11 32 9c2 7 1 14 0 21 4-3 8-3 12 0z', PAPER, INK, 1.6),
    m(circ(48, 49, 4.2), SKY, INK, 1.6),
    line('M44 49h8', PAPER, 1.4),
  ],
  wave: [
    m('M6 48C8 30 20 16 36 16c10 0 17 6 17 14 0 6-6 9-10 6-3-2-1-7 3-6-2-5-8-7-12-5-9 4-9 17-1 23z', SKY, INK, 2),
    line('M17 40c1-8 6-15 13-18', PAPER, 2),
    m('M4 46c8-4 14 4 22 0s14-4 22 0 9 4 12 0v12H4z', SEA, INK, 2),
    line('M12 52c4-2 6 1 10 0M36 53c4-2 6 1 10 0', PAPER, 1.6),
    m(circ(50, 12, 2), PAPER, INK, 1.2),
  ],
  mountain: [
    m(circ(15, 15, 5), GOLD, GOLDD, 1.6),
    m('M4 52l18-30 8 10 10-16 20 36z', SAGE, INK, 2),
    m('M40 16l-5.6 9.4 3.6-2 3 3 3-3 2.6 2.6z', PAPER, INK, 1.6),
    m('M22 22l-4.4 7.4 3-1.4 2.6 2 2.2-2.2z', PAPER, INK, 1.4),
    line('M2 56h60', INK, 2.4),
    line('M30 40l4 4M44 36l3 5', INK, 1.4),
  ],
  snow: snowflake(),
  ferris: ferris(),
  balloon: [
    m('M32 6c14 0 22 10 22 20 0 10-10 16-16 20H26c-6-4-16-10-16-20S18 6 32 6z', ROSE, INK, 2),
    m('M32 6c-8 8-8 30-4 40h8c4-10 4-32-4-40z', PAPER, INK, 1.6),
    line('M13 30c12 3 26 3 38 0', RED, 1.6),
    line('M28 46l-1.5 6M36 46l1.5 6', INK, 1.6),
    m(rr(25, 52, 14, 7, 2), GOLD, INK, 1.8),
    line('M25 55.5h14', GOLDD, 1.2),
    m(sparkle(53, 50, 3.4), GOLD, GOLDD, 1),
  ],
  ship: [
    m(rr(37, 11, 8, 13, 1.5), GOLD, INK, 1.8),
    line('M37 15h8', INK, 2),
    m(rr(21, 22, 22, 9, 2), PAPER, INK, 1.8),
    m(rr(14, 30, 36, 11, 2), PAPER, INK, 1.8),
    line('M20 35.5h4M28 35.5h4M36 35.5h4M44 35.5h2', SEA, 2.2),
    m('M6 40h52l-6 13H12z', INK, INK, 2),
    m(circ(20, 46, 1.8), PAPER, PAPER, 1), m(circ(28, 46, 1.8), PAPER, PAPER, 1), m(circ(36, 46, 1.8), PAPER, PAPER, 1),
    line('M4 58c5-3 9 3 14 0s9-3 14 0 9 3 14 0 9-3 14 0', SEA, 2.2),
  ],
  train: [
    line('M14 60l7-9M50 60l-7-9M17 56h30', INK, 2.2),
    m(rr(16, 8, 32, 42, 9), GOLD, INK, 2.2),
    m(rr(21, 14, 22, 14, 3), PAPER, INK, 1.8),
    line('M32 14v14', LINE, 1.4),
    line('M16 34h32', INK, 2),
    m(circ(23, 41, 3), CREAM, INK, 1.6), m(circ(41, 41, 3), CREAM, INK, 1.6),
    line('M28 8.5v-3h8v3', INK, 1.8),
  ],
  car: [
    m(rr(25, 11, 18, 5, 1.5), ROSE, INK, 1.6),
    line('M28 16v2M40 16v2', INK, 1.6),
    m('M6 44v-9c0-3 2-4 5-5l8-2 6-8c1-1 3-2 5-2h12c2 0 4 1 5 3l5 8c4 1 6 3 6 6v9z', SKY, INK, 2),
    m('M27 22h8v7H22z', PAPER, INK, 1.6),
    m('M38 22h6l4 7H38z', PAPER, INK, 1.6),
    line('M6 37h6M52 37h6', GOLD, 2.4),
    m(circ(18, 45, 6), INK, INK, 2), m(circ(18, 45, 2.4), PAPER, PAPER, 1),
    m(circ(46, 45, 6), INK, INK, 2), m(circ(46, 45, 2.4), PAPER, PAPER, 1),
  ],
  pin: [
    { d: ell(32, 57, 11, 2.8), fill: LINE, stroke: undefined, w: 0 },
    m('M32 57C24 45 13 36 13 24 13 13 21 6 32 6s19 7 19 18c0 12-11 21-19 33z', ROSE, INK, 2.2),
    m(circ(32, 24, 7.5), PAPER, INK, 1.8),
    m(circ(32, 24, 2.6), GOLD, GOLDD, 1),
  ],
  compass: [
    m(circ(32, 32, 24), PAPER, INK, 2.2),
    m(circ(32, 32, 19), 'none', LINE, 1.4),
    line(rays(32, 32, 20.5, 23, 12), INK, 1.4),
    m('M32 12l5 20-5 20-5-20z', PAPER, INK, 1.6, 'rotate(35 32 32)'),
    m('M32 12l5 20H27z', GOLD, BROWN, 1.4, 'rotate(35 32 32)'),
    m(circ(32, 32, 3.2), INK, INK, 1),
  ],
  camera: [
    m('M21 21l4-7h14l4 7', INK, INK, 2),
    m(rr(7, 20, 50, 34, 7), INK, INK, 2),
    m(rr(7, 30, 50, 6, 0), GOLD, undefined, 0),
    m(circ(32, 37, 12), PAPER, INK, 2),
    m(circ(32, 37, 7), SKY, INK, 1.6),
    { d: circ(29.5, 34.5, 1.9), fill: PAPER, stroke: undefined, w: 0 },
    m(rr(45, 24, 7, 4, 1.2), GOLD, GOLD, 1),
  ],
  icecream: [
    m('M21 31l11 27 11-27z', GOLD, INK, 2),
    line('M24 37h16M26.5 43h11M29 49h6', GOLDD, 1.4),
    m('M19 31c-2-8 4-14 13-14s15 6 13 14c-4-2-8 2-13 0-5 2-9-2-13 0z', PAPER, INK, 2),
    m(circ(32, 15, 7.5), ROSE, INK, 2),
    m(circ(35, 6.8, 2.6), RED, INK, 1.4),
    line('M28 13l1.5 1M34 17l1.5-1M30 18.5h1.5M24 26l1.5 1M38 25l1.6-.6', RED, 1.6),
  ],
  football: football(),
  castle: [
    m('M14 57V30h36v27z', PAPER, INK, 2),
    m('M9 57V25h11v32z', PAPER, INK, 2),
    m('M44 57V25h11v32z', PAPER, INK, 2),
    m('M8 25l6.5-12L21 25z', ROSE, INK, 2),
    m('M43 25l6.5-12L56 25z', ROSE, INK, 2),
    m(rr(25, 20, 14, 14, 0), PAPER, INK, 2),
    m('M23 20l9-12 9 12z', GOLD, INK, 2),
    m('M32 8V3l5 1.6L32 6', RED, INK, 1.4),
    m('M27 57v-9c0-5 10-5 10 0v9z', INK, INK, 1.8),
    m('M30 28c0-2.5 4-2.5 4 0v3h-4zM12.5 36c0-2 4-2 4 0v3h-4zM47.5 36c0-2 4-2 4 0v3h-4z', INK, INK, 1),
    line('M14 30v-3h4v3M22 30v-3h0M42 30v-3h4v3', INK, 1.6),
  ],
  sun: [
    line(rays(32, 32, 17, 25, 12), GOLDD, 2.6),
    m(circ(32, 32, 12.5), GOLD, INK, 2),
    line('M27.5 34.5c2.4 2.6 6.6 2.6 9 0', INK, 1.8),
    m(circ(28, 29.5, 1.3), INK, INK, 0.8), m(circ(36, 29.5, 1.3), INK, INK, 0.8),
  ],
  moon: [
    m('M38 9C25 11 17 22 17 34c0 12 10 21 22 21 6 0 11-2 15-6-17 2-27-9-27-22 0-8 4-14 11-18z', GOLD, INK, 2),
    m(sparkle(47, 20, 7), PAPER, INK, 1.6),
    m(sparkle(46, 38, 4), GOLD, GOLDD, 1.2),
    m(sparkle(55, 30, 2.6), PAPER, INK, 1.2),
  ],
  lantern: [
    { d: circ(32, 37, 23), fill: 'rgba(243,215,156,0.45)', stroke: undefined, w: 0 },
    line('M32 4v9', BROWN, 1.6),
    m('M29 6a3 3 0 0 1 6 0', 'none', BROWN, 1.6),
    m('M26 13h12l3 6H23z', INK, INK, 1.8),
    m('M23 19h18c2 11 2 22 0 33H23c-2-11-2-22 0-33z', CREAM, INK, 2),
    line('M28 19c-1 11-1 22 0 33M36 19c1 11 1 22 0 33', '#e3c58d', 1.2),
    m('M32 29c5 5.5 6 10 0 14.5-6-4.5-5-9 0-14.5z', GOLD, GOLDD, 1.2),
    m('M22 52h20l-3 6H25z', INK, INK, 1.8),
  ],
  family: [
    m('M9 57V41c0-8 4.5-12 11-12s11 4 11 12v16', SAGE, INK, 2),
    m('M33 57V41c0-8 4.5-12 11-12s11 4 11 12v16', ROSE, INK, 2),
    m(circ(20, 19, 6.5), CREAM, INK, 2),
    m(circ(44, 19, 6.5), CREAM, INK, 2),
    m('M37.5 17c2-5 11-5 13 0-4-1.5-9-1.5-13 0z', INK, INK, 1.4),
    m('M24 57v-8c0-5 3.5-8 8-8s8 3 8 8v8', GOLD, INK, 2),
    m(circ(32, 34, 5), CREAM, INK, 1.8),
    line('M4 57h56', INK, 2.4),
  ],
  kids: [
    line('M47 28c-1 4-4 6-8 7', INK, 1.4),
    m(ell(47, 16, 8, 10), ROSE, INK, 2),
    m('M47 26l-2.4 3h4.8z', ROSE, INK, 1.4),
    line('M43 11c1-2 3-3 5-3', PAPER, 1.8),
    line('M33 42l7-7', INK, 2.4),
    m('M17 57V47c0-7 3.5-11 9-11s9 4 9 11v10', SKY, INK, 2),
    m(circ(26, 27, 7), CREAM, INK, 2),
    m('M19.5 25c1-6 12-6 13 0-3-2-10-2-13 0z', BROWN, INK, 1.4),
    line('M23.5 30c1.4 1.2 3.6 1.2 5 0', INK, 1.4),
    m(sparkle(12, 18, 3.6), GOLD, GOLDD, 1),
    line('M8 57h48', INK, 2.4),
  ],
  gift: [
    m(rr(12, 28, 40, 27, 2.5), ROSE, INK, 2),
    m(rr(9, 20, 46, 9, 2.5), ROSE, INK, 2),
    m('M28 20h8v35h-8z', GOLD, INK, 1.8),
    m('M32 20c-6-10-16-8-12-2 2 3 8 2 12 2z', GOLD, INK, 1.8),
    m('M32 20c6-10 16-8 12-2-2 3-8 2-12 2z', GOLD, INK, 1.8),
    m(sparkle(52, 12, 4), GOLD, GOLDD, 1),
  ],
  cake: [
    m(rr(23.5, 15, 3.5, 11, 1.2), SKY, INK, 1.4),
    m(rr(30.25, 13, 3.5, 13, 1.2), GOLD, INK, 1.4),
    m(rr(37, 15, 3.5, 11, 1.2), SAGE, INK, 1.4),
    m('M25.25 14c2-2 2-4 0-6-2 2-2 4 0 6zM32 12c2-2 2-4 0-6-2 2-2 4 0 6zM38.75 14c2-2 2-4 0-6-2 2-2 4 0 6z', GOLD, GOLDD, 1),
    m(rr(18, 26, 28, 13, 3), ROSE, INK, 2),
    m(rr(11, 38, 42, 16, 3), PAPER, INK, 2),
    m('M11 42c3.5 0 3.5 4 7 4s3.5-4 7-4 3.5 4 7 4 3.5-4 7-4 3.5 4 7 4 3.5-4 7-4', 'none', ROSE, 2.4),
    line('M7 55h50', INK, 2.4),
  ],
  heart: [
    m('M32 54C18 44 8 36 8 24c0-8 6-14 13-14 5 0 9 3 11 7 2-4 6-7 11-7 7 0 13 6 13 14 0 12-10 20-24 30z', RED, INK, 2.2),
    line('M15.5 23c0-4 3-7 7-7', PAPER, 2.4),
    m(sparkle(52, 50, 4), GOLD, GOLDD, 1),
  ],
};

const markSvg = (k: Mark) =>
  `<path d="${k.d}" fill="${k.fill ?? 'none'}"${k.stroke && k.w ? ` stroke="${k.stroke}" stroke-width="${k.w}" stroke-linejoin="round"${k.cap ? ' stroke-linecap="round"' : ''}` : ''}${k.t ? ` transform="${k.t}"` : ''}/>`;

/** One drawing's marks, in a 64×64 box (no <svg> around them). */
export function coverIconMarks(icon: CoverIcon): string {
  return (DRAWINGS[icon] ?? DRAWINGS.heart).map(markSvg).join('');
}

/** One drawing on its own, transparent behind, as an SVG document. */
export function coverIconSvg(icon: CoverIcon, size = 64): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${coverIconMarks(icon)}</svg>`;
}

const dots = (w: number, h: number, gap: number, r: number) => {
  const out: string[] = [];
  for (let row = 0, y = gap / 2; y < h + gap; row++, y += gap * 0.866) {
    for (let x = (row % 2 ? gap / 2 : 0) + gap / 4; x < w + gap; x += gap) out.push(`M${r2(x - r)} ${r2(y)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`);
  }
  return out.join('');
};

export type CoverArtOptions = {
  width: number;
  height: number;
  /** banner: a wide cover with the drawing to one side (headers, previews, tiles, the invite page).
   *  badge: a small square with the drawing in the middle (list rows, avatars, the picker).
   *  poster: a tall screen with the drawing in the upper part (the invite page).
   *  header: a wide band under a top bar (a circle's chat). */
  layout?: 'banner' | 'badge' | 'poster' | 'header';
  /** Which side the drawing sits on in a banner: the end of the line (right in English, left in Arabic). */
  side?: 'left' | 'right';
  /** Draw the dotted pattern (on by default). */
  pattern?: boolean;
  /** Fill whatever box holds it (width and height 100%, cropped to cover) instead of a fixed size. */
  fill?: boolean;
};

/**
 * A whole cover: the colour, a quiet pattern of dots, soft rings, and the drawing on a paper disc. Banners keep the
 * bottom-start corner calm for the circle's name, like a photo cover.
 */
export function coverArtSvg(cover: { icon: CoverIcon; color: CoverColor }, o: CoverArtOptions): string {
  const W = Math.max(8, Math.round(o.width));
  const H = Math.max(8, Math.round(o.height));
  const c = COVER_COLOR_INFO[cover.color] ?? COVER_COLOR_INFO.green;
  const layout = o.layout ?? (W > H * 1.2 ? 'banner' : 'badge');
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="${c.bg}"/>`];
  let cx: number; let cy: number; let disc: number;
  if (layout === 'banner') {
    disc = Math.min(H * 0.3, W * 0.2);
    cx = o.side === 'left' ? disc * 1.3 + W * 0.04 : W - disc * 1.3 - W * 0.04;
    cy = H * 0.42;
  } else if (layout === 'header') {
    // Under a top bar whose end holds buttons: the drawing sits lower and a little in from the end.
    disc = Math.min(H * 0.24, W * 0.16);
    cx = o.side === 'left' ? disc * 1.25 + W * 0.16 : W - disc * 1.25 - W * 0.16;
    cy = H * 0.62;
  } else if (layout === 'poster') {
    disc = Math.min(W * 0.3, H * 0.2);
    cx = W / 2; cy = H * 0.3;
  } else {
    disc = Math.min(W, H) * 0.42;
    cx = W / 2; cy = H / 2;
  }
  if (o.pattern !== false && Math.min(W, H) >= 40) {
    const gap = Math.max(12, Math.round(Math.min(W, H) / 9));
    parts.push(`<path d="${dots(W, H, gap, Math.max(1, r2(gap / 11)))}" fill="${c.dot}"/>`);
  }
  if (layout !== 'badge' || Math.min(W, H) >= 80) {
    parts.push(`<path d="${circ(r2(cx), r2(cy), r2(disc * 1.42))}" fill="none" stroke="${c.ring}" stroke-width="${r2(Math.max(1, disc * 0.08))}"/>`);
    parts.push(`<path d="${circ(r2(cx), r2(cy), r2(disc * 1.9))}" fill="none" stroke="${c.ring}" stroke-width="${r2(Math.max(1, disc * 0.05))}"/>`);
  }
  parts.push(`<path d="${circ(r2(cx), r2(cy), r2(disc))}" fill="${PAPER}"${cover.color === 'green' ? '' : ` stroke="rgba(30,53,45,0.10)" stroke-width="${r2(Math.max(0.6, disc * 0.03))}"`}/>`);
  const s = (disc * 1.72) / 64;
  parts.push(`<g transform="translate(${r2(cx - 32 * s)} ${r2(cy - 32 * s)}) scale(${r2(s * 1000) / 1000})">${coverIconMarks(cover.icon)}</g>`);
  const fit = o.fill ? ` preserveAspectRatio="${layout === 'poster' ? 'xMidYMin' : 'xMidYMid'} slice"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" ${o.fill ? 'width="100%" height="100%"' : `width="${W}" height="${H}"`} viewBox="0 0 ${W} ${H}"${fit}>${parts.join('')}</svg>`;
}

/** Whether words laid on this cover read best in paper (light) or ink (dark). */
export const coverTextTone = (color: CoverColor): 'paper' | 'ink' => (COVER_COLOR_INFO[color] ?? COVER_COLOR_INFO.green).text;
