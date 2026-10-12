import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { T } from '@/components/Text';
import { getLocale, t } from '@/lib/i18n';
import { colors } from '@/theme';
import { DrawnMap } from './DrawnMap';
import { boundsOf, type StaysMapProps } from './types';

/*
 * The stays map on the web: MapLibre GL JS with OpenFreeMap tiles (OpenStreetMap data, no key), loaded from a CDN the
 * first time a map is opened so the app's bundle doesn't carry it. Arabic labels use the right-to-left text plugin.
 * If the library or the tiles can't load, the drawn map shows the same pins.
 */
const VERSION = '4.7.1';
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
type ML = {
  Map: new (o: Record<string, unknown>) => MLMap; Marker: new (o: { element: HTMLElement; anchor?: string }) => MLMarker;
  setRTLTextPlugin: (url: string, lazy: boolean) => Promise<void> | void; getRTLTextPluginStatus?: () => string; AttributionControl: new (o: Record<string, unknown>) => unknown;
};
type MLMap = { on: (e: string, f: () => void) => void; fitBounds: (b: [[number, number], [number, number]], o: Record<string, unknown>) => void; remove: () => void; addControl: (c: unknown, pos?: string) => void; resize: () => void };
type MLMarker = { setLngLat: (p: [number, number]) => MLMarker; addTo: (m: MLMap) => MLMarker; remove: () => void };

let loading: Promise<ML> | null = null;
function maplibre(): Promise<ML> {
  const w = window as unknown as { maplibregl?: ML };
  if (w.maplibregl) return Promise.resolve(w.maplibregl);
  if (loading) return loading;
  loading = new Promise<ML>((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = `https://unpkg.com/maplibre-gl@${VERSION}/dist/maplibre-gl.css`;
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = `https://unpkg.com/maplibre-gl@${VERSION}/dist/maplibre-gl.js`;
    js.async = true;
    const timer = setTimeout(() => reject(new Error('map timeout')), 10_000);
    js.onload = () => { clearTimeout(timer); if (w.maplibregl) resolve(w.maplibregl); else reject(new Error('no maplibre')); };
    js.onerror = () => { clearTimeout(timer); reject(new Error('map blocked')); };
    document.head.appendChild(js);
  }).catch((e) => { loading = null; throw e; });
  return loading;
}

function pinEl(label: string, kind: 'hotel' | 'on' | 'mark', onClick?: () => void, testId?: string): HTMLElement {
  const el = document.createElement(onClick ? 'button' : 'div');
  el.textContent = kind === 'mark' ? `★ ${label}` : label;
  if (testId) el.setAttribute('data-testid', testId);
  if (onClick) { el.setAttribute('aria-label', label); el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); }); }
  Object.assign(el.style, {
    font: '600 12px Inter, system-ui, sans-serif', padding: '4px 8px', borderRadius: '99px', whiteSpace: 'nowrap', cursor: onClick ? 'pointer' : 'default',
    border: `1px solid ${kind === 'on' ? colors.green : 'rgba(30,53,45,0.12)'}`, boxShadow: '0 4px 12px -6px rgba(15,26,22,0.45)',
    background: kind === 'on' ? colors.green : kind === 'mark' ? colors.goldWash : colors.paper, color: kind === 'on' ? colors.mist : colors.green,
    zIndex: kind === 'on' ? '3' : kind === 'mark' ? '2' : '1', direction: getLocale() === 'ar' ? 'rtl' : 'ltr',
  } as Partial<CSSStyleDeclaration>);
  return el;
}

export function StaysMap(props: StaysMapProps) {
  const { points, marks = [], onPick, height, single, testID } = props;
  const box = useRef<View>(null);
  const map = useRef<MLMap | null>(null);
  const pins = useRef<MLMarker[]>([]);
  const [lib, setLib] = useState<ML | null>(null);
  const [failed, setFailed] = useState(false);
  const pick = useRef(onPick);
  useEffect(() => { pick.current = onPick; });

  useEffect(() => {
    let alive = true;
    maplibre().then((m) => { if (alive) setLib(m); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  // The map itself, once: framed on the points.
  useEffect(() => {
    const el = box.current as unknown as HTMLElement | null;
    if (!lib || !el || map.current) return;
    try {
      if (getLocale() === 'ar' && lib.getRTLTextPluginStatus?.() === 'unavailable') {
        try { void Promise.resolve(lib.setRTLTextPlugin('https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js', true)).catch(() => { /* Arabic labels show unjoined; the pins are ours */ }); } catch { /* same */ }
      }
      const all = [...points, ...marks];
      const b = all.length ? boundsOf(all) : null;
      const one = all.length === 1 ? all[0]! : null;
      const m = new lib.Map({
        container: el, style: STYLE, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, interactive: !single,
        ...(one ? { center: [one.lng, one.lat], zoom: 14 } : b ? { bounds: [[b.west, b.south], [b.east, b.north]], fitBoundsOptions: { padding: 40, maxZoom: single ? 15 : 14 } } : {}),
      });
      m.on('error', () => { /* a tile that didn't load: the rest of the map stays */ });
      m.on('load', () => {
        // The credit stays one tap away (the ⓘ), and in a line under the map; it doesn't cover the pins.
        el.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
        if (!one && b) m.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: 40, maxZoom: single ? 15 : 14, duration: 0 });
      });
      map.current = m;
    } catch { queueMicrotask(() => setFailed(true)); }
    return () => { map.current?.remove(); map.current = null; };
  }, [lib]); // eslint-disable-line react-hooks/exhaustive-deps

  // The pins follow the list (sort, filters, wishes) and the selection.
  useEffect(() => {
    const m = map.current;
    if (!lib || !m) return;
    pins.current.forEach((p) => p.remove());
    pins.current = [
      ...marks.map((k) => new lib.Marker({ element: pinEl(k.name, 'mark') }).setLngLat([k.lng, k.lat]).addTo(m)),
      ...points.map((p) => new lib.Marker({ element: pinEl(p.label, p.selected ? 'on' : 'hotel', single ? undefined : () => pick.current?.(p.id), `map-pin-${p.id}`) }).setLngLat([p.lng, p.lat]).addTo(m)),
    ];
  }, [lib, points, marks, single]);

  // Refit when the set of places changes (a wish filtered the list), not when only the selection moves.
  const key = points.map((p) => p.id).join() + marks.map((k) => k.id).join();
  useEffect(() => {
    const m = map.current;
    const all = [...points, ...marks];
    if (!m || all.length < 2) return;
    const b = boundsOf(all);
    m.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: 40, maxZoom: single ? 15 : 14, duration: 400 });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return <DrawnMap {...props} />;
  return (
    <View style={{ gap: 4 }}>
      <View ref={box} style={[s.box, { height }]} testID={testID} accessibilityLabel={t('stays.map.a11y')} />
      <T v="tiny">{t('map.attribution')}</T>
    </View>
  );
}

const s = StyleSheet.create({ box: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#e6eee6' } });
