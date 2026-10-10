import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Button } from '@/components/Button';
import { Scroll, Screen, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { ErrorState, GoneState } from '@/components/states/ErrorState';
import { InlineError } from '@/components/states/InlineError';
import { OutboxList } from '@/components/states/OutboxList';
import { PermissionDenied } from '@/components/states/PermissionDenied';
import { QueryState } from '@/components/states/QueryState';
import { SafeImage } from '@/components/states/SafeImage';
import { SkeletonCard } from '@/components/states/Skeleton';
import { SlowState } from '@/components/states/SlowState';
import { StaleBadge } from '@/components/states/StaleBadge';
import { SupplierDown } from '@/components/states/SupplierDown';
import { API_MODE, SHOW_DEMO_HINTS } from '@/lib/config';
import { t } from '@/lib/i18n';
import { clockOffset } from '@/lib/net/clock';
import { describeError } from '@/lib/net/describe';
import { useApiQuery } from '@/lib/net/hooks';
import { enqueue } from '@/lib/net/outbox';
import { ApiError, api } from '@/lib/api';
import { colors, font } from '@/theme';

/*
 * Design review and e2e only (mock mode or demo hints): every state from components/states on one page, and a live
 * probe (GET /people through useApiQuery) that the e2e breaks with Playwright's network emulation. Not reachable from
 * the app's navigation; in a store build it answers like any missing page.
 *   /states            the gallery
 *   /states?view=live  the live probe, full screen, with a text field that must survive a re-sign-in
 */

function Crash(): never { throw new Error('States gallery: a screen that throws while drawing'); }

function Live() {
  const q = useApiQuery({ queryKey: ['states', 'probe'], queryFn: async () => (await api.people()).people, staleTime: 0 });
  const [draft, setDraft] = useState('');
  const offset = Math.round(clockOffset() / 60_000);
  return (
    <Scroll top={4}>
      <TextInput value={draft} onChangeText={setDraft} placeholder={t('ask.placeholder')} testID="states-draft"
        style={[font('body', colors.green), { backgroundColor: colors.paper, borderRadius: 18, paddingHorizontal: 16, height: 52 }]} />
      {q.updatedAt ? <StaleBadge updatedAt={q.updatedAt} stale={q.stale} /> : null}
      <QueryState query={q} skeleton={<View style={{ gap: 12 }}><SkeletonCard photo /><SkeletonCard /></View>}>
        {(people) => (
          <View style={{ gap: 10 }} testID="states-data">
            {people.map((p) => (
              <View key={p.id} style={{ backgroundColor: colors.paper, borderRadius: 18, padding: 16 }}>
                <T v="h3">{p.firstName || 'Omar'}</T>
                <T v="small">{p.relation}</T>
              </View>
            ))}
          </View>
        )}
      </QueryState>
      {offset ? <T v="tiny" testID="states-clock">{`Server clock offset ${offset > 0 ? '+' : ''}${offset} min`}</T> : null}
    </Scroll>
  );
}

function Gallery() {
  const [broken, setBroken] = useState(false);
  const [twelveMinAgo] = useState(() => Date.now() - 12 * 60_000);
  if (broken) Crash();
  return (
    <Scroll top={4}>
      <T v="eyebrow">Waiting</T>
      <SkeletonCard photo />
      <SlowState onCancel={() => {}} />
      <T v="eyebrow">A section that didn’t load</T>
      <InlineError problem={describeError(new ApiError('INTERNAL', '', 500))} onRetry={() => {}} />
      <InlineError problem={describeError(new ApiError('OFFLINE', '', 0))} />
      <StaleBadge updatedAt={twelveMinAgo} />
      <T v="eyebrow">Suppliers</T>
      <SupplierDown supplier="Saudia" booking />
      <SupplierDown supplier="Saudia" />
      <T v="eyebrow">Outbox</T>
      <Button variant="secondary" label="Queue a note" testID="states-queue" onPress={() => enqueue({ kind: 'demo', label: 'Add Sara to the household', method: 'POST', path: '/people', body: { givenNames: 'Sara', surname: 'Alharbi', relation: 'child' } })} />
      <OutboxList />
      <T v="eyebrow">Photos</T>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <SafeImage source={{ uri: '/no-such-photo.jpg' }} name="Istanbul" radius={18} style={{ width: 110, height: 110 }} testID="img-failed" />
        <SafeImage source={{ uri: '/slow-photo.jpg' }} name="Abha Mountains" radius={18} style={{ width: 110, height: 110 }} testID="img-slow" />
      </View>
      <T v="eyebrow">Permissions</T>
      <PermissionDenied kind="camera" onSkip={() => {}} skipLabel="Type it in" />
      <PermissionDenied kind="notifications" onSkip={() => {}} />
      <T v="eyebrow">Whole screens</T>
      <ErrorState variant="card" error={new ApiError('INTERNAL', '', 500, { requestId: 'm1x2y3z4' })} onRetry={() => {}} />
      <ErrorState variant="card" error={new ApiError('BAD_RESPONSE', '', 200)} onRetry={() => {}} />
      <GoneState variant="card" invite />
      <Button variant="ghost" label="Break this screen" testID="states-crash" onPress={() => setBroken(true)} />
    </Scroll>
  );
}

export default function States() {
  const { view } = useLocalSearchParams<{ view?: string }>();
  if (API_MODE !== 'mock' && !SHOW_DEMO_HINTS) return <Screen><GoneState /></Screen>;
  return (
    <Screen>
      <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/today' as Href))} title={view === 'live' ? 'Household' : 'States'} />
      {view === 'live' ? <Live /> : <Gallery />}
    </Screen>
  );
}
