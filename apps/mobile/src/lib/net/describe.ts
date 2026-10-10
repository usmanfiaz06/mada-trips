import { errorKind, type ErrorKind } from '@mada/shared';
import { ApiError } from '../api';
import { t } from '../i18n';

/*
 * From any failure to the words on screen (COPY.md §5.6): what happened, what still works, the one thing to do.
 * Screens never show raw server text for these kinds; they show this. Field problems (VALIDATION) and business answers
 * (a declined card) are the screen's own business and come back as kind 'input' with the server's message.
 */

export type NextStep = 'retry' | 'talk' | 'update' | 'signin' | 'home' | 'wait' | null;

export type Described = {
  kind: ErrorKind;
  title: string;
  body: string;
  primary: NextStep;
  /** Seconds to wait, for busy and maintenance. */
  retryAfter?: number;
  /** "Reference m1x2…": the request id, so Faisal can find it. */
  reference?: string;
  /** For SUPPLIER_DOWN: the supplier's on-screen name. */
  supplier?: string;
};

export function describeError(e: unknown, opts: { supplierName?: string; agent?: string; booking?: boolean } = {}): Described {
  const err = e instanceof ApiError ? e : null;
  const kind: ErrorKind = err ? err.kind : (e as { name?: string })?.name === 'AbortError' ? 'cancelled' : errorKind('INTERNAL', 500);
  const reference = err?.requestId;
  switch (kind) {
    case 'offline':
      return { kind, title: t('net.offline.title'), body: t('net.offline.body'), primary: 'retry' };
    case 'timeout':
      return { kind, title: t('timeout.title'), body: t('timeout.body'), primary: 'retry', reference };
    case 'busy': {
      const seconds = err?.retryAfter ?? 5;
      return { kind, title: t('busy.title'), body: t('busy.body', { seconds }), primary: 'wait', retryAfter: seconds };
    }
    case 'maintenance':
      return { kind, title: t('maintenance.title'), body: err?.message || t('maintenance.body'), primary: 'home', retryAfter: err?.retryAfter };
    case 'update':
      return { kind, title: t('update.title'), body: t('update.body'), primary: 'update' };
    case 'auth':
      return { kind, title: t('session.expired.title'), body: t('session.expired.body'), primary: 'signin' };
    case 'supplier': {
      const label = typeof err?.details?.label === 'string' ? err.details.label : opts.supplierName ?? t('supplierDown.generic');
      return {
        kind, supplier: label, primary: opts.booking ? null : 'talk', reference,
        title: t('supplierDown.title', { supplier: label }),
        body: opts.booking ? t('supplierDown.bodyBooking', { agent: opts.agent ?? t('common.agentName') }) : t('supplierDown.body'),
      };
    }
    case 'gone':
      return { kind, title: t('gone.title'), body: t('gone.body'), primary: 'home' };
    case 'forbidden':
      return { kind, title: t('gone.title'), body: t('error.forbidden'), primary: 'home' };
    case 'contract':
      return { kind, title: t('problem.partial.title'), body: t('problem.partial.body'), primary: 'retry', reference };
    case 'storage':
      return { kind, title: t('storage.full.title'), body: t('storage.full.body'), primary: null };
    case 'cancelled':
      return { kind, title: t('problem.inline'), body: '', primary: 'retry' };
    case 'input':
      return { kind, title: err?.message ?? t('error.validation'), body: '', primary: null, reference };
    default:
      return { kind: 'server', title: t('problem.title'), body: t('problem.body'), primary: 'retry', reference };
  }
}
