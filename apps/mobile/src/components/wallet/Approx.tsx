import { approxIn, fxDateLabel } from '@mada/shared';
import { T } from '@/components/Text';
import { t } from '@/lib/i18n';
import { useDisplayCurrency } from '@/lib/wallet';
import { colors } from '@/theme';

/*
 * "≈ AED 2,304 (rate of 16 Oct)": the chosen display currency beside a SAR amount (Account › Prices shown in). Only ever
 * a guide: SAR is what is charged, and the sheet says so in words. Nothing when the display currency is SAR.
 */
export function Approx({ amount, color = colors.ink3, size = 12, testID, short }: { amount: number; color?: string; size?: number; testID?: string; short?: boolean }) {
  const { currency, fx } = useDisplayCurrency();
  const a = approxIn(amount, currency, fx);
  if (!a || !fx) return null;
  return <T v="tiny" color={color} style={{ fontSize: size, fontVariant: ['tabular-nums'] }} testID={testID}>{short ? a : t('fx.approx', { amount: a, date: fxDateLabel(fx) })}</T>;
}

/** "Rates from 16 Oct · Exchange Rate API" for a screen's foot. Null for SAR. */
export function RatesFoot() {
  const { currency, fx } = useDisplayCurrency();
  if (!fx || currency === 'SAR') return null;
  return <T v="tiny">{t('fx.ratesFrom', { date: fxDateLabel(fx), source: fx.source === 'fallback' ? t('fx.fallback') : t('fx.live') })}</T>;
}
