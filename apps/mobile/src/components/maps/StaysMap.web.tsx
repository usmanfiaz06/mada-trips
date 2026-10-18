import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatSar } from '@mada/shared';
import { T } from '@/components/Text';
import { getLocale, t } from '@/lib/i18n';
import { colors } from '@/theme';
import { DrawnMap } from './DrawnMap';
import { PILL_H, boundsOf, groupPins, lowestOf, type MapPoint, type StaysMapProps } from './types';

/*
 * The stays map on the web: MapLibre GL JS with OpenFreeMap tiles (OpenStreetMap data, no key), loaded from a CDN the
 * first time a map is opened so the app's bundle doesn't carry it. Arabic labels use the right-to-left text plugin.
 * If the library or the tiles can't load, the drawn map shows the same pins.
 */
const VERSION = '4.7.1';
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
type ML = {
  Map: new (o: Record<string, unknown>) => MLMap; Marker: new (o: { element: HTMLElement; anchor?: string; offset?: [number, number] }) => MLMarker;
  setRTLTextPlugin: (url: string, lazy: boolean) => Promise<void> | void; getRTLTextPluginStatus?: () => string; AttributionControl: new (o: Record<string, unknown>) => unknown;
};
type MLMap = {
  on: (e: string, f: () => void) => void; fitBounds: (b: [[number, number], [number, number]], o: Record<string, unknown>) => void; remove: () => void; addControl: (c: unknown, pos?: string) => void; resize: () => void;
  project: (p: [number, number]) => { x: number; y: number }; getZoom: () => number; easeTo: (o: Record<string, unknown>) => void; panBy: (o: [number, number], opts?: Record<string, unknown>) => void;
  cameraForBounds?: (b: [[number, number], [number, number]], o: Record<string, unknown>) => { center: unknown; zoom: number } | undefined;
};
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

/** A pin: the price in a pill. A group: how many and the lowest price, in a darker pill. */
function pinEl(label: string, kind: 'hotel' | 'on' | 'mark' | 'group', onClick?: () => void, testId?: string, a11y?: string): HTMLElement {
  const el = document.createElement(onClick ? 'button' : 'div');
  el.textContent = kind === 'mark' ? `★ ${label}` : label;
  if (testId) el.setAttribute('data-testid', testId);
  if (onClick) {
    el.setAttribute('type', 'button');
    el.setAttribute('aria-label', a11y ?? label);
    if (kind !== 'group') el.setAttribute('aria-pressed', kind === 'on' ? 'true' : 'false');
    el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  }
  // The chosen place: filled green with a gold ring. A group: a plain pill with a green ring, so it reads as "more here".
  Object.assign(el.style, {
    font: `${kind === 'group' ? 700 : 600} 11px Inter, system-ui, sans-serif`, padding: '3px 7px', borderRadius: '99px', whiteSpace: 'nowrap', cursor: onClick ? 'pointer' : 'default',
    border: kind === 'on' ? `2px solid ${colors.gold}` : kind === 'group' ? `1.5px solid ${colors.green}` : '1px solid rgba(30,53,45,0.12)', boxShadow: '0 4px 12px -6px rgba(15,26,22,0.45)',
    background: kind === 'on' ? colors.green : kind === 'mark' ? colors.goldWash : kind === 'group' ? colors.mist : colors.paper, color: kind === 'on' ? colors.mist : colors.green,
    zIndex: kind === 'on' ? '1000' : kind === 'mark' ? '900' : kind === 'group' ? '800' : '1', direction: getLocale() === 'ar' ? 'rtl' : 'ltr',
  } as Partial<CSSStyleDeclaration>);
  return el;
}

/** MapLibre writes its generic "On the map" over a marker's label when it is added: the pin's own name goes back on. */
function label(mk: MLMarker, el: HTMLElement, name: string | null): MLMarker {
  if (name) el.setAttribute('aria-label', name); else el.removeAttribute('aria-label');
  return mk;
}

export function StaysMap(props: StaysMapProps) {
  const { points, marks = [], onPick, onMapPress, height, fill, coverBottom = 0, single, testID } = props;
  const box = useRef<View>(null);
  const map = useRef<MLMap | null>(null);
  const pins = useRef<MLMarker[]>([]);
  const [lib, setLib] = useState<ML | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(0);
  const pick = useRef(onPick);
  const tapMap = useRef(onMapPress);
  useEffect(() => { pick.current = onPick; tapMap.current = onMapPress; });

  useEffect(() => {
    let alive = true;
    maplibre().then((m) => { if (alive) setLib(m); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  // The map itself, once: framed on the points.
  useEffect(() => {
    const el = box.current as unknown as HTMLElement | null;
    if (!lib || !el || map.current) return;
    let watch: ResizeObserver | null = null;
    try {
      if (getLocale() === 'ar' && lib.getRTLTextPluginStatus?.() === 'unavailable') {
        try { void Promise.resolve(lib.setRTLTextPlugin('https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js', true)).catch(() => { /* Arabic labels show unjoined; the pins are ours */ }); } catch { /* same */ }
      }
      const all = [...points, ...marks];
      const b = all.length ? boundsOf(all) : null;
      const one = all.length === 1 ? all[0]! : null;
      const m = new lib.Map({
        container: el, style: STYLE, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, interactive: !single,
        // The map's own controls speak the reader's language too (the data's credit stays as its owners write it).
        locale: { 'AttributionControl.ToggleAttribution': t('map.credits'), 'Marker.Title': t('map.marker'), 'NavigationControl.ZoomIn': t('map.zoomIn'), 'NavigationControl.ZoomOut': t('map.zoomOut') },
        ...(one ? { center: [one.lng, one.lat], zoom: 14 } : b ? { bounds: [[b.west, b.south], [b.east, b.north]], fitBoundsOptions: { padding: 40, maxZoom: single ? 15 : 14 } } : {}),
      });
      m.on('error', () => { /* a tile that didn't load: the rest of the map stays */ });
      m.on('load', () => {
        // The credit stays one tap away (the ⓘ), and in a line under the map; it doesn't cover the pins.
        el.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
        if (!one && b) m.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: 40, maxZoom: single ? 15 : 14, duration: 0 });
        setZoomed((z) => z + 1);
      });
      // Which pins sit on each other depends on the zoom only (the map doesn't rotate): regroup when it settles.
      m.on('zoomend', () => setZoomed((z) => z + 1));
      m.on('click', () => tapMap.current?.());
      if (typeof ResizeObserver !== 'undefined') { watch = new ResizeObserver(() => { m.resize(); setZoomed((z) => z + 1); }); watch.observe(el); }
      map.current = m;
    } catch { queueMicrotask(() => setFailed(true)); }
    return () => { watch?.disconnect(); map.current?.remove(); map.current = null; };
  }, [lib]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every price stays reachable: where pills would sit on each other at this zoom they become one group pill
  // ("5 · from SAR 1,903") that zooms in to split; with room, each shows its own price. Landmarks and the chosen
  // place are always on top, and the chosen place is never grouped.
  useEffect(() => {
    const m = map.current;
    if (!lib || !m) return;
    pins.current.forEach((p) => p.remove());
    const groups = single ? points.map((p) => ({ id: p.id, members: [p], lat: p.lat, lng: p.lng, stack: false, dy: 0 })) : groupPins(points, (p) => m.project([p.lng, p.lat]));
    const n = points.length;
    const order = new Map(points.map((p, i) => [p.id, i]));
    const one = (p: MapPoint, offset?: [number, number]) => {
      const el = pinEl(p.label, p.selected ? 'on' : 'hotel', single ? undefined : () => pick.current?.(p.id), `map-pin-${p.id}`, p.a11y);
      if (!p.selected) el.style.zIndex = String(n - (order.get(p.id) ?? 0));
      return label(new lib.Marker({ element: el, ...(offset ? { offset } : {}) }).setLngLat([p.lng, p.lat]).addTo(m), el, single ? null : p.a11y ?? p.label);
    };
    pins.current = [
      ...marks.map((k) => new lib.Marker({ element: pinEl(k.name, 'mark') }).setLngLat([k.lng, k.lat]).addTo(m)),
      ...groups.flatMap((g) => {
        if (g.members.length === 1) return [one(g.members[0]!, g.dy ? [0, g.dy] : undefined)];
        // The same spot (one building): one above the other, every price its own pill.
        if (g.stack) return g.members.map((p, i) => one(p, [0, (i - (g.members.length - 1) / 2) * (PILL_H + 4)]));
        const low = lowestOf(g.members);
        const price = low.price != null ? formatSar(low.price) : low.label;
        const el = pinEl(t('stays.map.group', { count: g.members.length, price }), 'group', () => {
          const lats = g.members.map((p) => p.lat); const lngs = g.members.map((p) => p.lng);
          const bounds: [[number, number], [number, number]] = [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
          const cam = m.cameraForBounds?.(bounds, { padding: 60 });
          const zoom = Math.min(18, Math.max(cam?.zoom ?? 0, m.getZoom() + 1.5));
          m.easeTo({ center: cam?.center ?? [g.lng, g.lat], zoom, duration: 450 });
        }, `map-group-${g.members.length}`, t('stays.map.groupA11y', { count: g.members.length, price }));
        return [label(new lib.Marker({ element: el, ...(g.dy ? { offset: [0, g.dy] as [number, number] } : {}) }).setLngLat([g.lng, g.lat]).addTo(m), el, t('stays.map.groupA11y', { count: g.members.length, price }))];
      }),
    ];
  }, [lib, points, marks, single, zoomed]);

  // The chosen place stays in sight above the card that covers the bottom of the map.
  const chosen = points.find((p) => p.selected);
  useEffect(() => {
    const m = map.current;
    const el = box.current as unknown as HTMLElement | null;
    if (!m || !el || !chosen || !coverBottom) return;
    const h = el.clientHeight; const w = el.clientWidth;
    const at = m.project([chosen.lng, chosen.lat]);
    const room = h - coverBottom;
    if (at.y > room - 24 || at.y < 24 || at.x < 24 || at.x > w - 24) m.panBy([at.x - w / 2, at.y - room / 2], { duration: 350 });
  }, [chosen?.id, coverBottom]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <View style={[{ gap: 4 }, fill ? { flex: 1 } : null]}>
      <View ref={box} style={[s.box, fill ? { flex: 1 } : { height }]} testID={testID} accessibilityLabel={t('stays.map.a11y')} />
      <T v="tiny">{t('map.attribution')}</T>
    </View>
  );
}

const s = StyleSheet.create({ box: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#e6eee6' } });
