import { AppLock } from './AppLock';

/** The lock over the whole app. A phone has it from the first frame, so a locked app never shows a trip first. */
export function AppLockRoot(_: { when: boolean }) {
  return <AppLock />;
}
