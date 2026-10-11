import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { EmptyState } from '@/components/EmptyState';
import { T } from '@/components/Text';
import { ArtSuitcase } from '@/components/trips/Arts';
import { Box, H3, Photo, Rise, Row, Small, Tag, Tiny, TripScreen } from '@/components/trips/ui';
import { t } from '@/lib/i18n';
import { useHotelDetails } from '@/lib/transfers';
import { colors } from '@/theme';

/*
 * A Hotelbeds hotel's details from our content store (certification §5): category, every image in their order,
 * description, facilities (paid ones marked), address and phone. Content from HBX Group; never fetched live.
 */
export default function HotelScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const q = useHotelDetails(Number(code));
  const h = q.data?.hotel;
  if (!h) return <TripScreen title="">{q.isPending ? <View style={{ paddingTop: 40 }}><ActivityIndicator color={colors.green} /></View> : <EmptyState art={<ArtSuitcase />} title={t('error.notFound')} body="" />}</TripScreen>;
  return (
    <TripScreen title={h.name}>
      <Rise><T v="h1" accessibilityRole="header">{h.name}</T></Rise>
      <Rise step={1}><Row gap={8} style={{ flexWrap: 'wrap' }}>{h.category ? <Tag tone="gold" label={h.category} /> : null}<Tag label="HBX Group" /></Row></Rise>
      {h.images.length ? (
        <ScrollView testID="hotel-images" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {h.images.map((uri) => <Photo key={uri} uri={uri} style={{ width: 260, height: 170, borderRadius: 14 }} />)}
        </ScrollView>
      ) : null}
      {h.description ? <Small>{h.description}</Small> : null}
      <Box testID="hotel-facts" gap={6}>
        {h.address ? <><Tiny>{t('voucher.address')}</Tiny><Small color={colors.green}>{h.address}</Small></> : null}
        {h.phone ? <><Tiny>{t('voucher.phone')}</Tiny><Small color={colors.green}>{h.phone}</Small></> : null}
      </Box>
      {h.facilities.length ? (
        <Box testID="hotel-facilities"><H3 size={15}>{t('hotel.facilities')}</H3><Row gap={6} style={{ flexWrap: 'wrap' }}>{h.facilities.map((f) => <Tag key={f.name} label={f.paid ? `${f.name} · ${t('hotel.paid')}` : f.name} />)}</Row></Box>
      ) : null}
    </TripScreen>
  );
}
