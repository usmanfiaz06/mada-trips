import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { dayLabel, localizeDigits, type ThingRef } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { ApiError } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { getLocale, isRTL, t } from '@/lib/i18n';
import { durationLine, openLine, priceLine, SUPPLIER_NAME, thingId, thingsApi, thingTitle, useIdeaMutations, useTripIdeas, type Thing } from '@/lib/things';
import { toast } from '@/lib/toast';
import { usePresence } from '@/lib/wallet';
import { colors, ff, font } from '@/theme';
import { MiniMap, ThingPhoto } from './parts';

/* The detail sheet for one thing (photo with its credit, hours, the map, Add to my plan) and Book with Mada. */

export type ThingsContext = {
  placeId: string;
  city: string;
  tripId: string | null;
  /** The trip's days, for "which day". */
  days: string[];
  /** The day being looked at, if one is. */
  day: string | null;
  ages: number[];
  near: { lat: number; lon: number; label: 'hotel' | 'you' | 'centre' } | null;
};

const refOf = (x: Thing): ThingRef => ({ kind: x.kind, id: thingId(x) });
const open = (url: string) => { buzz('tap'); void Linking.openURL(url); };

function Fact({ icon, children }: { icon: Parameters<typeof Icon>[0]['name']; children: React.ReactNode }) {
  return <View style={st.fact}><Icon name={icon} size={16} color={colors.goldInk} /><View style={{ flex: 1 }}>{children}</View></View>;
}

export function ThingSheet({ x, ctx, onClose, onBook }: { x: Thing | null; ctx: ThingsContext; onClose: () => void; onBook: (x: Thing) => void }) {
  const ideas = useTripIdeas(ctx.tripId);
  const { add, remove } = useIdeaMutations(ctx.tripId);
  const [picking, setPicking] = useState(false);
  if (!x) return null;
  const ar = isRTL();
  const title = thingTitle(x, ar);
  const planned = (ideas.data ?? []).find((i) => i.ref.id === thingId(x)) ?? null;
  const credit = x.kind === 'activity' ? (x.a.image ? x.a.attributions.find((a) => a.source === 'wikimedia') : null) : x.kind === 'experience' ? (x.e.image ? { text: x.e.image.credit, url: null } : null) : x.w.image?.credit ? { text: x.w.image.credit, url: null } : null;
  const addTo = (day: string | null) => add.mutate({ ref: refOf(x), placeId: ctx.placeId, day }, {
    onSuccess: (r) => { buzz('success'); setPicking(false); toast(r.idea.day ? t('things.addedPlan', { day: dayLabel(r.idea.day, { today: r.idea.day }) }) : t('things.addedPlanAny')); },
    onError: (e) => toast(e.message),
  });
  return (
    <Sheet visible={!!x} onClose={onClose} label={title}>
      <ScrollView style={{ maxHeight: 640 }} contentContainerStyle={{ gap: 12 }} testID="thing-sheet">
        <ThingPhoto x={x} style={{ height: 190, borderRadius: 20 }} />
        {credit ? (
          <Pressable disabled={!credit.url} onPress={() => credit.url && open(credit.url)} accessibilityRole={credit.url ? 'link' : 'text'}>
            <T v="tiny" numberOfLines={2}>{x.kind === 'activity' ? credit.text : t('things.photoBy', { credit: credit.text })}</T>
          </Pressable>
        ) : null}
        <View style={{ gap: 4 }}>
          <T v="eyebrow" color={colors.goldInk}>{x.kind === 'activity' ? t(`things.kind.${x.a.kind}`) : x.kind === 'experience' ? t('things.via', { supplier: SUPPLIER_NAME[x.e.supplier] }) : x.w.source === 'desk' ? t('things.event.fromDesk') : 'Ticketmaster'}</T>
          <T v="h2">{title}</T>
          {x.kind === 'activity' && ar && x.a.nameAr && x.a.name !== x.a.nameAr ? <T v="small">{x.a.name}</T> : null}
        </View>

        {x.kind === 'activity' ? (
          <>
            {(ar && x.a.summaryAr) || x.a.summary ? <T v="body" color={colors.green}>{(ar && x.a.summaryAr) || x.a.summary}</T> : null}
            <View style={st.facts}>
              <Fact icon="bell">
                <T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{openLine(x.a) || t('things.hours')}</T>
                {x.a.hours ? <T v="tiny" style={{ writingDirection: 'ltr' }}>{x.a.hours}</T> : null}
                {x.a.hours ? <T v="tiny">{t('things.hoursNote')}</T> : null}
              </Fact>
              {x.a.distanceKm !== null ? <Fact icon="pin"><T v="small" color={colors.green}>{t(ctx.near?.label === 'hotel' ? 'things.kmFromHotel' : 'things.kmAway', { km: localizeDigits(String(x.a.distanceKm)) })}</T></Fact> : null}
              {x.a.family || x.a.indoor || x.a.free ? <Fact icon="star"><T v="small" color={colors.green}>{[x.a.family ? t('things.familyTag') : null, x.a.indoor ? t('things.indoor') : null, x.a.free ? t('things.free') : null].filter(Boolean).join(' · ')}</T></Fact> : null}
            </View>
            <MiniMap lat={x.a.lat} lon={x.a.lon} name={x.a.name} from={ctx.near?.label === 'hotel' ? ctx.near : null} />
            {x.a.wikipedia ? <Pressable onPress={() => open(x.a.wikipedia!)} accessibilityRole="link"><T v="small" style={st.link}>{t('things.readMore')}</T></Pressable> : null}
            <T v="tiny">{x.a.attributions.filter((a) => a.source !== 'wikimedia').map((a) => a.text).join(' · ')}</T>
          </>
        ) : x.kind === 'experience' ? (
          <>
            {x.e.summary ? <T v="body" color={colors.green}>{x.e.summary}</T> : null}
            <View style={st.facts}>
              <Fact icon="card"><T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{priceLine(x.e)} <T v="tiny">{t('things.perPerson')}</T></T></Fact>
              {x.e.durationMin ? <Fact icon="bell"><T v="small" color={colors.green}>{durationLine(x.e.durationMin)}</T></Fact> : null}
              {x.e.rating ? <Fact icon="star"><T v="small" color={colors.green}>{t('things.rating', { rating: localizeDigits(x.e.rating.toFixed(1)), count: localizeDigits(String(x.e.reviews ?? 0)) })}</T></Fact> : null}
              {x.e.minAge ? <Fact icon="user"><T v="small" color={colors.green}>{t('things.minAge', { age: x.e.minAge })}</T></Fact> : null}
              {x.e.freeCancel ? <Fact icon="check"><T v="small" color={colors.green}>{t('things.freeCancel')}</T></Fact> : null}
            </View>
          </>
        ) : (
          <>
            {x.w.body ? <T v="body" color={colors.green}>{x.w.body}</T> : null}
            <View style={st.facts}>
              <Fact icon="bell"><T v="small" color={colors.green}>{x.w.startsOn === x.w.endsOn ? dayLabel(x.w.startsOn, { today: x.w.startsOn }) : t('things.event.dates', { from: dayLabel(x.w.startsOn, { today: x.w.startsOn }), to: dayLabel(x.w.endsOn, { today: x.w.endsOn }) })}</T></Fact>
              {x.w.time || x.w.venue ? <Fact icon="pin"><T v="small" color={colors.green}>{[x.w.time ? localizeDigits(x.w.time) : null, x.w.venue].filter(Boolean).join(' · ')}</T></Fact> : null}
            </View>
            {x.w.link ? <Pressable onPress={() => open(x.w.link!)} accessibilityRole="link"><T v="small" style={st.link}>{t('things.event.source')}</T></Pressable> : null}
          </>
        )}

        {ctx.tripId ? (
          planned ? (
            <View style={st.planned} testID="thing-planned">
              <Icon name="check" size={18} color={colors.ok} />
              <T v="small" color={colors.green} style={{ flex: 1 }}>{planned.day ? t('things.addedPlan', { day: dayLabel(planned.day, { today: planned.day }) }) : t('things.addedPlanAny')}</T>
              <Pressable onPress={() => remove.mutate(planned.id)} accessibilityRole="button"><T v="tiny" style={st.link}>{t('things.removePlan')}</T></Pressable>
            </View>
          ) : picking ? (
            <View style={{ gap: 8 }}>
              <T v="eyebrow">{t('things.pickDay')}</T>
              <View style={st.chips}>
                {ctx.days.map((d) => <Chip key={d} label={dayLabel(d, { today: d })} onPress={() => addTo(d)} />)}
                <Chip label={t('things.day.any')} onPress={() => addTo(null)} />
              </View>
            </View>
          ) : (
            <Button testID="thing-add-plan" variant="secondary" label={t('things.addPlan')} busy={add.isPending} onPress={() => (ctx.day ? addTo(ctx.day) : setPicking(true))} />
          )
        ) : null}
        <Button testID="thing-book" label={t('things.bookWith')} onPress={() => onBook(x)} />
        <T v="tiny" style={{ textAlign: 'center' }}>{t('things.bookNote')}</T>
      </ScrollView>
    </Sheet>
  );
}

/** Book with Mada: when, how many, their words. Makes a desk request and opens its chat. */
export function BookSheet({ x, ctx, onClose }: { x: Thing | null; ctx: ThingsContext; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const presence = usePresence();
  const today = new Date().toISOString().slice(0, 10);
  const days = ctx.days.length ? ctx.days : Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d.toISOString().slice(0, 10); });
  const [day, setDay] = useState<string | null>(ctx.day);
  const [n, setN] = useState(Math.max(2, ctx.ages.length + 1));
  const [text, setText] = useState<string | null>(null);
  const [clientId] = useState(() => `thing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const book = useMutation({
    mutationFn: (message: string) => thingsApi.book({ ref: refOf(x!), placeId: ctx.placeId, ...(day ? { day } : {}), travellers: n, ages: ctx.ages.slice(0, Math.max(0, n - 1)), ...(ctx.tripId ? { tripId: ctx.tripId } : {}), message, clientId }),
    onSuccess: (r) => {
      buzz('success');
      void qc.invalidateQueries({ queryKey: ['booking'] });
      void qc.invalidateQueries({ queryKey: ['trips'] });
      toast(t('things.bookSheet.sent'));
      onClose();
      router.push(`/ask/request/${r.request.id}`);
    },
  });
  if (!x) return null;
  const title = thingTitle(x, isRTL());
  const kids = ctx.ages.slice(0, Math.max(0, n - 1));
  const adults = Math.max(1, n - kids.length);
  const who = kids.length ? t('things.request.whoKids', { adults, ages: kids.join(getLocale() === 'ar' ? '، ' : ', ') }) : t(adults === 1 ? 'things.request.whoOne' : 'things.request.who', { n: adults });
  const when = day ? dayLabel(day, { today }) : t('things.request.dayOpen');
  const generated = t('things.request.message', { name: title, city: ctx.city, who, when });
  const message = text ?? generated;
  const agent = presence.data?.agent?.name ?? null;
  const offline = book.error instanceof ApiError && book.error.code === 'OFFLINE';
  return (
    <Sheet visible={!!x} onClose={onClose} label={t('things.bookSheet.title', { name: title })}>
      <ScrollView style={{ maxHeight: 640 }} contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled" testID="book-sheet">
        <T v="h2">{t('things.bookSheet.title', { name: title })}</T>
        <T v="eyebrow">{t('things.bookSheet.when')}</T>
        <View style={st.chips}>
          {days.slice(0, 10).map((d) => <Chip key={d} label={dayLabel(d, { today })} on={day === d} onPress={() => { setDay(d); setText(null); }} />)}
          <Chip label={t('things.day.any')} on={day === null} onPress={() => { setDay(null); setText(null); }} />
        </View>
        <T v="eyebrow">{t('things.bookSheet.who')}</T>
        <View style={st.chips}>
          {[1, 2, 3, 4, 5, 6].map((k) => <Chip key={k} label={k === 6 ? '6+' : localizeDigits(String(k))} on={n === k} onPress={() => { setN(k); setText(null); }} />)}
        </View>
        {kids.length ? <T v="small">{t('things.bookSheet.kids', { ages: kids.join(getLocale() === 'ar' ? '، ' : ', ') })}</T> : null}
        <View style={{ gap: 6 }}>
          <T v="small" style={{ fontFamily: ff.ui600 }}>{t('things.bookSheet.message')}</T>
          <TextInput value={message} onChangeText={setText} multiline maxLength={600} accessibilityLabel={t('things.bookSheet.message')} testID="book-message" style={[st.input, font('body', colors.green)]} />
        </View>
        <T v="tiny">{agent ? t('things.bookSheet.byHand', { agent }) : t('things.bookSheet.byHandAway')}</T>
        {offline ? <T v="small" color={colors.badInk}>{t('things.offline')}</T> : book.error ? <T v="small" color={colors.badInk}>{book.error.message}</T> : null}
        <Button testID="book-send" label={t('things.bookSheet.send')} busy={book.isPending} disabled={!message.trim()} haptic="success" onPress={() => book.mutate(message.trim())} />
      </ScrollView>
    </Sheet>
  );
}

const st = StyleSheet.create({
  facts: { gap: 10, padding: 14, borderRadius: 18, backgroundColor: colors.mist },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  link: { color: colors.goldInk, fontFamily: ff.ui600 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  planned: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, backgroundColor: '#e8f1ea' },
  input: { minHeight: 84, borderRadius: 16, padding: 14, fontSize: 17, backgroundColor: colors.paper, borderWidth: 1.5, borderColor: colors.line, textAlignVertical: 'top' },
});
