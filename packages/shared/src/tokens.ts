/**
 * Design tokens, taken from the prototype (docs/app/prototype-app/src/styles.css) and EXPERIENCE.md §9.
 * Plain numbers and strings so both React Native and the web (Ops, emails) can read them.
 */

export const colors = {
  /** Canvas. */
  sand: '#e9e2d8',
  /** Cards. */
  paper: '#fffdf9',
  /** Chips, inner wells. */
  mist: '#f6f2ec',
  /** Ink and focal surfaces. */
  green: '#1e352d',
  green2: '#2a4a40',
  green3: '#142720',
  /** The darkest green, behind video and the waiting screen. */
  night: '#0f1a16',
  /** Secondary text. */
  ink2: '#4d5c55',
  /** Tertiary text, still 4.5:1 on sand. */
  ink3: '#5f6b65',
  /** Body text on photos and glass. */
  inkSoft: '#3f4f48',
  /** The one accent: the thing to do now. Always a fill, never text on sand. */
  gold: '#d9b77a',
  goldDeep: '#b98f4a',
  /** Gold as text. */
  goldInk: '#7d5d27',
  goldWash: '#efe3c9',
  ok: '#2f7a4b',
  okBright: '#3f9a63',
  live: '#4fbf7a',
  /** Hairlines. */
  line: 'rgba(30, 53, 45, 0.1)',
  /** Sheet backdrop. */
  shade: 'rgba(15, 26, 22, 0.42)',
  stage: '#d6cdbf',
  /** Inline problems: calm, never red-alarm. */
  bad: '#a2402e',
  badInk: '#8a3524',
  warnWash: '#f3e6c9',
  grab: '#e3dcd1',
  /** Text on dark green. */
  onDark: '#f6f2ec',
  onDark2: '#c9c1b4',
  onDark3: '#b8b0a3',
  muted: '#8a9590',
  white: '#ffffff',
} as const;

export type ColorName = keyof typeof colors;

/** Corner radii in points. Cards 24, sheets 32, chips and the dock fully round. */
export const radii = {
  xs: 6,
  sm: 12,
  input: 16,
  notice: 20,
  card: 24,
  hero: 28,
  sheet: 32,
  pill: 999,
} as const;

/** Spacing scale in points. Screens use a 20-point gutter (24 on onboarding). */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 10,
  4: 12,
  5: 14,
  6: 16,
  7: 20,
  8: 24,
  9: 28,
  10: 32,
  12: 40,
  gutter: 20,
  gutterWide: 24,
} as const;

/** Heights that the layout depends on. */
export const sizes = {
  button: 56,
  buttonSmall: 40,
  chip: 40,
  pill: 26,
  input: 52,
  otp: 64,
  slider: 64,
  sliderKnob: 56,
  dockItem: 52,
  dockOrb: 60,
  iconButton: 44,
  avatar: 40,
  avatarSmall: 32,
  touchMin: 48,
} as const;

/** Font family names as registered by @expo-google-fonts (React Native needs one family per weight). */
export const fontFamilies = {
  display: 'InstrumentSerif_400Regular',
  ui400: 'InterTight_400Regular',
  ui500: 'InterTight_500Medium',
  ui600: 'InterTight_600SemiBold',
  ui700: 'InterTight_700Bold',
  mono: 'JetBrainsMono_400Regular',
} as const;

/** CSS stacks, for the web (Ops, emails, the prototype). */
export const fontStacks = {
  ui: "'Inter Tight', system-ui, -apple-system, 'Segoe UI', sans-serif",
  display: "'Instrument Serif', Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', ui-monospace, Menlo, monospace",
} as const;

export type TextStyleToken = {
  family: keyof typeof fontFamilies;
  size: number;
  lineHeight: number;
  /** Letter spacing in points (CSS em × size). */
  tracking: number;
  color?: ColorName;
  uppercase?: boolean;
  tabular?: boolean;
};

const em = (v: number, size: number) => Math.round(v * size * 100) / 100;

/**
 * Type scale. The prototype classes (display, h1, h2, h3, body, small, tiny, eyebrow) plus COPY.md §7.2.
 * Each screen uses at most three sizes and two weights, plus the hero number.
 */
export const typography = {
  hero: { family: 'ui600', size: 64, lineHeight: 64, tracking: em(-0.03, 64), tabular: true },
  /** Instrument Serif, for the moments that should be felt. One per screen. */
  displayXL: { family: 'display', size: 52, lineHeight: 53, tracking: em(-0.01, 52) },
  display: { family: 'display', size: 40, lineHeight: 42, tracking: em(-0.01, 40) },
  displaySmall: { family: 'display', size: 30, lineHeight: 32, tracking: em(-0.01, 30) },
  h1: { family: 'ui600', size: 30, lineHeight: 33, tracking: em(-0.02, 30) },
  title: { family: 'ui600', size: 24, lineHeight: 30, tracking: em(-0.01, 24) },
  h2: { family: 'ui600', size: 20, lineHeight: 25, tracking: em(-0.015, 20) },
  headline: { family: 'ui500', size: 19, lineHeight: 24, tracking: em(-0.005, 19) },
  h3: { family: 'ui600', size: 16, lineHeight: 21, tracking: 0 },
  body: { family: 'ui400', size: 16, lineHeight: 23, tracking: 0, color: 'ink2' },
  button: { family: 'ui600', size: 17, lineHeight: 22, tracking: 0 },
  callout: { family: 'ui400', size: 14, lineHeight: 20, tracking: 0 },
  small: { family: 'ui400', size: 13, lineHeight: 18, tracking: 0, color: 'ink2' },
  tiny: { family: 'ui400', size: 12, lineHeight: 16, tracking: 0, color: 'ink3' },
  caption: { family: 'ui500', size: 12, lineHeight: 16, tracking: em(0.01, 12) },
  eyebrow: { family: 'ui600', size: 12, lineHeight: 16, tracking: em(0.08, 12), color: 'ink3', uppercase: true },
  code: { family: 'ui600', size: 15, lineHeight: 20, tracking: em(0.06, 15), uppercase: true, tabular: true },
  mono: { family: 'mono', size: 10.5, lineHeight: 15, tracking: 0 },
} as const satisfies Record<string, TextStyleToken>;

export type TypeName = keyof typeof typography;

/** Shadows, as CSS-like parts both platforms can map. */
export const shadows = {
  card: { color: '#0f1a16', opacity: 0.18, radius: 20, offsetY: 12 },
  focal: { color: '#0f1a16', opacity: 0.35, radius: 26, offsetY: 18 },
  dock: { color: '#1e352d', opacity: 0.22, radius: 26, offsetY: 14 },
  knob: { color: '#000000', opacity: 0.35, radius: 10, offsetY: 6 },
} as const;

/** Motion (EXPERIENCE.md §4.5): interaction under 400 ms, the confirmation peak about 600 ms. */
export const motion = {
  tap: 100,
  quick: 200,
  standard: 300,
  sheet: 450,
  peak: 600,
  /** The sun breathes on a 10-second cycle when idle. */
  breathe: 10_000,
  /** cubic-bezier(.2, .8, .2, 1) */
  ease: [0.2, 0.8, 0.2, 1] as const,
  /** cubic-bezier(.2, .9, .25, 1.2): a small overshoot. */
  spring: [0.2, 0.9, 0.25, 1.2] as const,
} as const;

/**
 * The haptic vocabulary (EXPERIENCE.md §4.6). Each event always feels the same.
 * `web` is the prototype's navigator.vibrate pattern, kept for Android browsers.
 */
export const haptics = {
  tap: { kind: 'impact', style: 'light', web: 8 },
  select: { kind: 'selection', web: 10 },
  knock: { kind: 'impact', style: 'soft', web: 14 },
  success: { kind: 'notification', style: 'success', web: [0, 18, 90, 36] },
  warn: { kind: 'notification', style: 'warning', web: [0, 30, 70, 30] },
  thunk: { kind: 'impact', style: 'heavy', web: [0, 40] },
  soft: { kind: 'notification', style: 'error', web: [0, 12, 60, 12] },
  tick: { kind: 'impact', style: 'rigid', web: 6 },
} as const;

export type HapticName = keyof typeof haptics;
