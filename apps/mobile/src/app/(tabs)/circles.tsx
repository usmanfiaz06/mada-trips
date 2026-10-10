import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { HOME_CITY, type Post } from '@mada/shared';
import { CirclesHome } from '@/components/circles/CirclesHome';
import { Discover } from '@/components/circles/Discover';
import { useSaveToggle } from '@/components/circles/hooks';
import { PostDetail, PostSheet } from '@/components/circles/sheets';
import { RoundButton, TabsText } from '@/components/circles/ui';
import { Icon } from '@/components/Icon';
import { Scroll, Screen, useTopInset } from '@/components/Layout';
import { useDiscover, useFriends } from '@/lib/circles';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { colors } from '@/theme';

/** Circles (prototype Circles.jsx): Discover, and your circles, friends, saves and passport. Discover first. */
export default function Circles() {
  const router = useRouter();
  const top = useTopInset();
  const params = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<'discover' | 'circles'>(params.view === 'circles' ? 'circles' : 'discover');
  const [posting, setPosting] = useState<string | null>(null);
  const [open, setOpen] = useState<Post | null>(null);
  const friends = useFriends();
  const requests = friends.data?.requests.length ?? 0;
  const d = useDiscover(null);
  const tripCity = d.data?.tripDates ? d.data.city : null;
  const postCities = [...new Set([...(tripCity ? [tripCity] : []), posting ?? HOME_CITY, HOME_CITY, 'Istanbul'])].slice(0, 3);
  const { togglePost } = useSaveToggle();

  return (
    <Screen>
      <Scroll top={top + 14}>
        <View style={styles.header}>
          <TabsText label={t('circles.a11y.views')} value={view} onChange={setView} tabs={[['discover', t('circles.tab.discover')], ['circles', t('circles.tab.circles')]]} />
          {view === 'discover'
            ? <RoundButton dark a11y={t('circles.a11y.postTip')} icon={<Icon name="plus" color={colors.mist} />} onPress={() => setPosting(d.data?.city ?? HOME_CITY)} testID="post-tip" />
            : (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <RoundButton a11y={requests ? t('circles.a11y.peopleRequests', { count: requests }) : t('circles.a11y.people')} badge={requests > 0} icon={<Icon name="circles" />} onPress={() => router.push('/people')} testID="people" />
                <RoundButton dark a11y={t('circles.a11y.new')} icon={<Icon name="plus" color={colors.mist} />} onPress={() => router.push('/circle/new')} testID="new-circle" />
              </View>
            )}
        </View>
        {view === 'discover'
          ? <Discover onPost={(c) => setPosting(c)} onOpen={setOpen} />
          : <CirclesHome onDiscover={() => setView('discover')} onOpenPost={setOpen} />}
      </Scroll>
      <PostSheet visible={!!posting} onClose={() => setPosting(null)} cities={postCities} initialCity={posting ?? HOME_CITY}
        onPosted={(audience) => { setPosting(null); setView('discover'); toast(audience === 'friends' ? t('circles.postTip.postedFriends') : t('circles.postTip.postedEveryone')); }} />
      <PostDetail post={open} onClose={() => setOpen(null)} onSave={(p) => { togglePost(p); setOpen({ ...p, saved: !p.saved }); }} />
    </Screen>
  );
}

const styles = StyleSheet.create({ header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' } });
