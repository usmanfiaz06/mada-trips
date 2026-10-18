import type { GiveUp } from '@/lib/net/give-up';
import { ErrorState } from './ErrorState';

/**
 * A search that gave up, failed or needs a sign-in (lib/net/give-up.ts), as one honest card: what happened, Try again
 * (or Sign in), and Talk to Mada. Never an endless spinner.
 */
export function WaitTrouble({ wait, variant = 'card', testID }: { wait: GiveUp; variant?: 'card' | 'full'; testID?: string }) {
  return (
    <ErrorState variant={variant} problem={wait.problem} onRetry={wait.retry} onSignIn={wait.signIn} always
      testID={testID ?? (wait.view === 'timeout' ? 'wait-timeout' : wait.view === 'signin' ? 'wait-signin' : 'wait-error')} />
  );
}
