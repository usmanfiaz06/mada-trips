/*
 * Reusable states for when things go wrong (FLOWS.md §12). How to adopt them: README.md in this folder.
 */
export { Skeleton, SkeletonLines, SkeletonCard, SkeletonList } from './Skeleton';
export { InlineError } from './InlineError';
export { ErrorState, OfflineState, CrashState, GoneState } from './ErrorState';
export { SlowState } from './SlowState';
export { StaleBadge } from './StaleBadge';
export { SupplierDown } from './SupplierDown';
export { PermissionDenied, type PermissionKind } from './PermissionDenied';
export { QueryState } from './QueryState';
export { SafeImage, toneFor, initialsOf } from './SafeImage';
export { StateView } from './StateView';
export { ErrorBoundary } from './ErrorBoundary';
export { NetChrome } from './NetChrome';
export { SessionExpired } from './SessionExpired';
export { OutboxList, OutboxStatus } from './OutboxList';
export * from './art';
