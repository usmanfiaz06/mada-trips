/*
 * Crash and problem reporting (Sentry), behind EXPO_PUBLIC_SENTRY_DSN. With no DSN every call is a no-op, so
 * development, screenshots and the web preview send nothing anywhere.
 *
 * What we send: the error, the request id, the screen, the app version. Never names, phone numbers, passport
 * fields, tokens or message text: `scrub` removes anything that looks like them before an event leaves the phone.
 */

type SentryLike = {
  init: (o: Record<string, unknown>) => void;
  captureException: (e: unknown, ctx?: { tags?: Record<string, string>; extra?: Record<string, unknown> }) => string;
  addBreadcrumb: (b: { category?: string; message?: string; level?: string; data?: Record<string, unknown> }) => void;
  wrap?: <P>(c: P) => P;
};

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';
let sentry: SentryLike | null = null;

const SECRET = /(\+?9665\d{8}|\b5\d{8}\b|Bearer\s+\S+|"(?:accessToken|refreshToken|token|passport\w*|number|phone|email|name|givenNames|surname)"\s*:\s*"[^"]*")/gi;
export const scrub = (s: string) => s.replace(SECRET, '[kept on the phone]');

export function initReporting(release?: string) {
  if (!DSN || sentry) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const S = require('@sentry/react-native') as SentryLike;
    S.init({
      dsn: DSN,
      release,
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
      beforeSend(event: { message?: string; exception?: { values?: { value?: string }[] } }) {
        if (event.message) event.message = scrub(event.message);
        for (const v of event.exception?.values ?? []) if (v.value) v.value = scrub(v.value);
        return event;
      },
      beforeBreadcrumb(b: { message?: string; data?: unknown }) {
        if (b.message) b.message = scrub(b.message);
        if (b.data) b.data = JSON.parse(scrub(JSON.stringify(b.data)));
        return b;
      },
    });
    sentry = S;
  } catch {
    sentry = null; // the SDK isn't in this build: nothing to do
  }
}

export const reportingOn = () => !!sentry;

/** Report something that shouldn't happen. Returns the event id (for "Reference …"), or null when reporting is off. */
export function reportError(e: unknown, context: { where?: string; requestId?: string; extra?: Record<string, unknown> } = {}): string | null {
  if (__DEV__ && process.env.NODE_ENV !== 'test') console.warn('[report]', context.where ?? '', e);
  if (!sentry) return null;
  try {
    return sentry.captureException(e, { tags: { where: context.where ?? 'app', ...(context.requestId ? { requestId: context.requestId } : null) }, extra: context.extra });
  } catch { return null; }
}

export function breadcrumb(category: string, message: string, data?: Record<string, unknown>) {
  try { sentry?.addBreadcrumb({ category, message, level: 'info', data }); } catch { /* */ }
}
