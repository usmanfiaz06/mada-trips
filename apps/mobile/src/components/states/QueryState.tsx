import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { ApiQueryResult } from '@/lib/net/hooks';
import { ErrorState } from './ErrorState';
import { InlineError } from './InlineError';
import { SkeletonList } from './Skeleton';
import { SlowState } from './SlowState';
import { StaleBadge } from './StaleBadge';

/**
 * Every state of a useApiQuery in one place:
 *   loading → your skeleton (or three cards); slow → the skeleton with "Still working…" and Stop waiting;
 *   offline / error with nothing to show → ErrorState (full) or InlineError (section);
 *   data → children(data), with the Stale badge when it's the saved copy and `badge` is on.
 *
 *   <QueryState query={trips} skeleton={<SkeletonList photo />}>{(data) => <TripList trips={data} />}</QueryState>
 */
export function QueryState<T>({ query, children, skeleton, section, badge, supplierName }: {
  query: ApiQueryResult<T>;
  children: (data: T) => ReactNode;
  skeleton?: ReactNode;
  /** A part of a screen: InlineError instead of a full ErrorState. */
  section?: boolean;
  /** Show "Updated 12 min ago" above the content when it's the saved copy. */
  badge?: boolean;
  supplierName?: string;
}) {
  switch (query.view) {
    case 'loading':
      return <>{skeleton ?? <SkeletonList />}</>;
    case 'slow':
      return <View style={{ gap: 12 }}><SlowState onCancel={query.cancel} />{skeleton ?? <SkeletonList />}</View>;
    case 'offline':
    case 'error':
      return section
        ? <InlineError problem={query.problem} onRetry={query.retry} />
        : <ErrorState variant="card" problem={query.problem} onRetry={query.retry} supplierName={supplierName} />;
    default:
      return (
        <>
          {badge && query.stale ? <StaleBadge updatedAt={query.updatedAt} stale /> : null}
          {children(query.data as T)}
        </>
      );
  }
}
