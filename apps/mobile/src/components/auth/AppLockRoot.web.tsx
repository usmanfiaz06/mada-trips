import { later } from '../Later';

/** The web has no Face ID or fingerprint to lock with: the lock's file waits until someone is signed in. */
export const AppLockRoot = later(() => import('./AppLock').then((m) => m.AppLock));
