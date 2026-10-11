import { Linking, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { THINGS_ATTRIBUTIONS } from '@mada/shared';
import { Screen, Scroll, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { colors, ff, shadow } from '@/theme';

/** Where Things to do comes from, with each source's licence and a link (ODbL, CC0, CC BY-SA, CC BY 4.0, Ticketmaster's terms). */
const ROWS: [Parameters<typeof t>[0], { url: string; licenceUrl: string | null } | null][] = [
  ['things.source.osm', { url: THINGS_ATTRIBUTIONS.osm.url, licenceUrl: THINGS_ATTRIBUTIONS.osm.licenceUrl }],
  ['things.source.wikidata', { url: THINGS_ATTRIBUTIONS.wikidata.url, licenceUrl: THINGS_ATTRIBUTIONS.wikidata.licenceUrl }],
  ['things.source.wikipedia', { url: 'https://wikimedia.org/api/rest_v1/', licenceUrl: null }],
  ['things.source.wikivoyage', { url: THINGS_ATTRIBUTIONS.wikivoyage.url, licenceUrl: THINGS_ATTRIBUTIONS.wikivoyage.licenceUrl }],
  ['things.source.openmeteo', { url: THINGS_ATTRIBUTIONS.openmeteo.url, licenceUrl: THINGS_ATTRIBUTIONS.openmeteo.licenceUrl }],
  ['things.source.ticketmaster', { url: THINGS_ATTRIBUTIONS.ticketmaster.url, licenceUrl: THINGS_ATTRIBUTIONS.ticketmaster.licenceUrl }],
  ['things.source.geonames', { url: 'https://www.geonames.org/', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' }],
  ['things.source.partners', null],
  ['things.source.desk', null],
];

export default function ThingsSources() {
  const router = useRouter();
  const open = (url: string) => { buzz('tap'); void Linking.openURL(url); };
  return (
    <Screen>
      <TopBar onBack={() => router.back()} title={t('things.sources')} />
      <Scroll top={8} bottomPad={60} contentStyle={{ gap: 12 }}>
        <T v="h2">{t('things.sourcesTitle')}</T>
        <T v="body" color={colors.green}>{t('things.sourcesBody')}</T>
        <View style={{ gap: 10 }} testID="things-source-list">
          {ROWS.map(([key, link]) => (
            <View key={key} style={[{ padding: 14, borderRadius: 18, backgroundColor: colors.paper, gap: 6 }, shadow('card')]}>
              <T v="small" color={colors.green}>{t(key)}</T>
              {link ? (
                <View style={{ flexDirection: 'row', gap: 16 }}>
                  <Pressable onPress={() => open(link.url)} accessibilityRole="link"><T v="tiny" style={{ color: colors.goldInk, fontFamily: ff.ui600 }} numberOfLines={1}>{link.url.replace(/^https:\/\//, '').replace(/\/$/, '')}</T></Pressable>
                  {link.licenceUrl ? <Pressable onPress={() => open(link.licenceUrl!)} accessibilityRole="link"><T v="tiny" style={{ color: colors.goldInk, fontFamily: ff.ui600 }}>{t('things.sourcesLink')}</T></Pressable> : null}
                </View>
              ) : null}
            </View>
          ))}
        </View>
      </Scroll>
    </Screen>
  );
}
