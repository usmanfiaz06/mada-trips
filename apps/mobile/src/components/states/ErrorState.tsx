import { router, type Href } from 'expo-router';
import { describeError, type Described } from '@/lib/net/describe';
import { reportingOn } from '@/lib/net/report';
import { talkToMada } from '@/lib/net/talk';
import { t } from '@/lib/i18n';
import { Button } from '../Button';
import { ArtFrayed, ArtMissing, ArtNoSignal, ArtRouteGap, ArtSign, ArtUpdate, ArtWaiting } from './art';
import { StateView } from './StateView';

/**
 * A whole screen (or section) that couldn't load, for any reason: pass the error (or a Described) and it picks the
 * words, the drawing and the one action. Offline, timeouts, a busy or broken server, a supplier not answering, a
 * newer server, something removed. "Reference …" is shown for problems on our side, so Faisal can find the request.
 */
export function ErrorState({ error, problem, onRetry, variant = 'full', supplierName, booking, gutter, testID }: {
  gutter?: number; error?: unknown; problem?: Described | null; onRetry?: () => void; variant?: 'full' | 'card'; supplierName?: string; booking?: boolean; testID?: string;
}) {
  const d = problem ?? describeError(error, { supplierName, booking });
  const art = {
    offline: <ArtNoSignal />, timeout: <ArtWaiting />, busy: <ArtWaiting />, maintenance: <ArtSign />, update: <ArtUpdate />,
    gone: <ArtMissing />, forbidden: <ArtMissing />, supplier: <ArtRouteGap />, contract: <ArtUpdate />,
  }[d.kind as string] ?? <ArtRouteGap />;

  const retry = onRetry ? <Button label={t('common.tryAgain')} onPress={onRetry} testID="state-retry" /> : null;
  const talk = <Button variant="ghost" label={t('action.talk')} onPress={() => talkToMada()} testID="state-talk" />;
  const talkFirst = <Button label={t('action.talk')} onPress={() => talkToMada()} testID="state-talk" />;
  const home = <Button label={t('gone.home')} onPress={() => router.replace('/today' as Href)} testID="state-home" />;

  let primary = null;
  let secondary = null;
  if (d.primary === 'home') { primary = home; secondary = talk; }
  else if (d.primary === 'talk') { primary = talkFirst; secondary = onRetry ? <Button variant="ghost" label={t('common.tryAgain')} onPress={onRetry} testID="state-retry" /> : null; }
  else if (d.kind === 'offline') primary = null; // it comes back by itself; the banner says so
  else if (d.primary === 'retry' || d.primary === 'wait') { primary = retry; secondary = d.kind === 'server' || d.kind === 'timeout' ? talk : null; }

  return (
    <StateView variant={variant} gutter={gutter} art={art} title={d.title} body={d.kind === 'offline' ? `${d.body} ${t('net.offline.retryOnline')}` : d.body}
      primary={primary} secondary={secondary} note={d.reference ? t('problem.ref', { ref: d.reference }) : null} testID={testID ?? `state-${d.kind}`} />
  );
}

/** Offline, for a screen that needs the network (search, a new booking). */
export function OfflineState({ variant = 'full', body }: { variant?: 'full' | 'card'; body?: string }) {
  return <StateView variant={variant} art={<ArtNoSignal />} title={t('net.offline.title')} body={body ?? `${t('net.offline.body')} ${t('net.offline.retryOnline')}`} testID="state-offline" />;
}

/** The app crashed or a screen threw: the frayed cable. Used by the ErrorBoundary. */
export function CrashState({ onRestart, reference }: { onRestart: () => void; reference?: string | null }) {
  return (
    <StateView art={<ArtFrayed />} title={t('crash.title')} body={t('crash.body')}
      primary={<Button label={t('crash.restart')} onPress={onRestart} testID="crash-restart" />}
      secondary={<Button variant="ghost" label={t('action.talk')} onPress={() => talkToMada()} testID="crash-talk" />}
      note={reportingOn() ? `${t('crash.note')}${reference ? ` ${t('problem.ref', { ref: reference })}` : ''}` : null} testID="state-crash" />
  );
}

/** Something that was there isn't any more (a deep link to a cancelled trip, an expired invite). */
export function GoneState({ invite, variant = 'full' }: { invite?: boolean; variant?: 'full' | 'card' }) {
  return (
    <StateView variant={variant} art={<ArtMissing />} title={invite ? t('gone.inviteTitle') : t('gone.title')} body={invite ? t('gone.inviteBody') : t('gone.body')}
      primary={<Button label={invite ? t('gone.home') : t('gone.trips')} onPress={() => router.replace((invite ? '/today' : '/trips') as Href)} testID="state-home" />}
      secondary={invite ? <Button variant="ghost" label={t('action.talk')} onPress={() => talkToMada()} testID="state-talk" /> : <Button variant="ghost" label={t('gone.home')} onPress={() => router.replace('/today' as Href)} testID="state-today" />} testID="state-gone" />
  );
}
