import type { ComponentProps } from 'react';
import { later } from './Later';
import type { SheetPanel } from './SheetPanel';

/*
 * On the web a sheet (with Reanimated and the gesture library it slides and drags with) is fetched the first time one
 * opens, not with the screen under it (docs/app/PERF.md). The root layout preloads it once the first screen is up, so
 * it opens at once, offline too.
 */
const Panel = later(() => import('./SheetPanel').then((m) => m.SheetPanel));

export function Sheet(props: ComponentProps<typeof SheetPanel>) {
  return <Panel when={props.visible} {...props} />;
}

export const preloadSheet = () => Panel.preload();
