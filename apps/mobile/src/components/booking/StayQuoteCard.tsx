import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { dayLabel, formatSar, nameIn, rangeLabel, type ChatCard, type StayQuoteOption } from '@mada/shared';
import { Button } from '@/components/Button';
import { Pill } from '@/components/Pill';
import { T } from '@/components/Text';
import { usePayDraft } from '@/lib/booking';
import { buzz } from '@/lib/haptics';
import { getLocale, t, tn } from '@/lib/i18n';
import { kvReadJson, kvWriteJson } from '@/lib/net/kv';
import { requireAccount } from '@/lib/signin-ask';
import { colors } from '@/theme';
import { Frame, Line, s } from './PeopleFrame';

/*
 * Rooms the team at Mada priced by hand for a stay request (the desk's "Add hotel quote"), in the same chat the request
 * came from: up to three hotels, each with its dates and nights, room and board, guests, the all-in price and the
 * cancellation line, and Book (the pay sheet with that room; nothing is charged from the chat). Not now folds it to one
 * line, kept on this phone; the request stays in Trips → Requests. A price that has ended says so instead of Book.
 */

type StayQuoteChatCard = Extract<ChatCard, { type: 'stay_quote' }>;
const LATER_KEY = 'mada.stayQuote.later.v1';
let later: Set<string> | null = null;
const laterSet = async () => (later ??= new Set(((await kvReadJson<string[]>(LATER_KEY)) ?? []).slice(-50)));

/** "Free cancellation until Thu 19 Nov, 18:00 hotel time", or "Non-refundable". */
export function cancelText(o: Pick<StayQuoteOption, 'freeCancelUntil'>, locale = getLocale()): string {
  if (!o.freeCancelUntil) return t('stay.nonRefundable');
  return t('chat.stayQuote.freeUntil', { date: dayLabel(o.freeCancelUntil.slice(0, 10), { locale }), time: `⁦${o.freeCancelUntil.slice(11, 16)}⁩` });
}

export function StayQuoteCard({ card }: { card: StayQuoteChatCard }) {
  const router = useRouter();
  const locale = getLocale();
  const [parked, setParked] = useState(false);
  // When the card was opened: a price that ended by then says so instead of Book (the pay sheet checks again anyway).
  const [now] = useState(() => Date.now());
  useEffect(() => { void laterSet().then((x) => { if (x.has(card.quoteId)) setParked(true); }); }, [card.quoteId]);
  const park = async () => {
    buzz('tap');
    setParked(true);
    const x = await laterSet();
    x.add(card.quoteId);
    await kvWriteJson(LATER_KEY, [...x]);
  };
  const book = (o: StayQuoteOption) => {
    buzz('tap');
    if (!requireAccount('book')) return;
    usePayDraft.getState().set({ draft: { kind: 'quote', requestId: card.requestId, optionId: o.id }, title: o.hotel });
    router.push('/pay');
  };
  const ended = !!card.expiresAt && Date.parse(card.expiresAt) <= now;
  if (parked) return <View testID="chat-stay-quote-parked"><Line icon="stay" text={t('chat.stayQuote.parked')} /></View>;
  const many = card.options.length > 1;
  return (
    <View style={{ gap: 8 }} testID="chat-stay-quote">
      {card.options.map((o, i) => (
        <Frame key={o.id} icon="stay" title={o.hotel} sub={[many ? t('chat.stayQuote.option', { n: String(i + 1) }) : null, nameIn(o.city, locale)].filter(Boolean).join(' · ')}
          pill={<View testID={`chat-stay-quote-total-${o.id}`}><Pill label={formatSar(o.total)} variant="gold" style={{ marginTop: 2, alignSelf: 'flex-start' }} /></View>} testID={`chat-stay-quote-${o.id}`}>
          <View style={{ gap: 8 }}>
            <Line icon="calendar" text={`${rangeLabel(o.checkIn, o.checkOut, locale)} · ${tn('chat.stayQuote.nights', o.nights)}`} />
            <Line icon="doc" text={`${o.room} · ${t(`stay.board.${o.board}`)}`} />
            <Line icon="user" text={tn('chat.stayQuote.guests', o.guests)} />
            <Line icon={o.freeCancelUntil ? 'check' : 'lock'} text={cancelText(o, locale)} testID={`chat-stay-quote-cancel-${o.id}`} />
            {o.note ? <T v="small" color={colors.ink2}>{o.note}</T> : null}
          </View>
          {ended ? <Line icon="bell" text={t('chat.stayQuote.ended')} testID="chat-stay-quote-ended" /> : (
            <View style={s.buttons}>
              <Button size="small" block={false} label={t('chat.stayQuote.book')} onPress={() => book(o)} style={{ height: 44, flexGrow: 1 }} testID={`chat-stay-quote-book-${o.id}`} />
              {!many ? <Button size="small" block={false} variant="secondary" label={t('chat.stayQuote.later')} onPress={() => void park()} style={{ height: 44, flexGrow: 1, backgroundColor: colors.mist }} testID="chat-stay-quote-later" /> : null}
            </View>
          )}
        </Frame>
      ))}
      {many && !ended ? <Button size="small" variant="secondary" label={t('chat.stayQuote.later')} onPress={() => void park()} style={{ height: 44, backgroundColor: colors.mist }} testID="chat-stay-quote-later" /> : null}
    </View>
  );
}
