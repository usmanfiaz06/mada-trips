import type { GestureHandlerRootView } from 'react-native-gesture-handler';
// @ts-expect-error: the package's own web root view (a View and a context), without the rest of the package. The
// gestures themselves come with the screens that use them (docs/app/PERF.md).
import RootView from 'react-native-gesture-handler/lib/module/components/GestureHandlerRootView';

export const GestureRoot = RootView as typeof GestureHandlerRootView;
