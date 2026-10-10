import { dayLabel, formatSar, type TripPayment } from '@mada/shared';
import type { PayBrand } from '@/components/PayMark';
import { t } from '@/lib/i18n';

export const brandOf = (p: Pick<TripPayment, 'method' | 'label'>): PayBrand =>
  p.method === 'tabby' || p.method === 'tamara' || p.method === 'credit' ? p.method : p.method === 'applepay' ? 'applepay' : /mada/i.test(p.label ?? '') ? 'mada' : /master/i.test(p.label ?? '') ? 'mastercard' : 'visa';
export const methodName = (p: TripPayment) => (p.method === 'tabby' ? t('pay.tabby4') : p.method === 'tamara' ? t('pay.tamara3') : p.label ?? p.method) + (p.creditUsed.amount ? ` ${t('pay.andCredit', { amount: formatSar(p.creditUsed.amount) })}` : '');
export const dl = (iso: string) => dayLabel(iso.slice(0, 10), { today: iso.slice(0, 10) });
