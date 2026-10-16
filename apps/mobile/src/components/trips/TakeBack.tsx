import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { ApiError, request } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { colors } from '@/theme';
import { SmallButton } from './ui';

/*
 * "Take back" on something you sent (owner audit, item 31): a request, a change, an "ask anyway" refund, while the desk
 * hasn't got it yet. One confirm, then it's marked withdrawn on the server (never deleted) and the desk sees it.
 */
export function TakeBack({ kind, id, testID }: { kind: 'request' | 'refund'; id: string; testID?: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await request({ method: 'POST', path: `/${kind === 'request' ? 'requests' : 'refunds'}/${id}/withdraw` }, z.object({}).passthrough());
      buzz('success'); toast(t('tb.done')); setOpen(false);
      await qc.invalidateQueries({ queryKey: ['trips'] });
    } catch (e) { toast(e instanceof ApiError ? e.message : t('error.internal')); } finally { setBusy(false); }
  };
  return (
    <>
      <SmallButton tone="ghost" icon="back" label={t('tb.takeBack')} onPress={() => { buzz('tap'); setOpen(true); }} testID={testID ?? 'take-back'} />
      <Sheet visible={open} onClose={() => setOpen(false)} label={t('tb.title')}>
        <T v="h2">{t('tb.title')}</T>
        <T v="body">{kind === 'refund' ? t('tb.refundBody') : t('tb.body')}</T>
        <Button label={t('tb.yes')} variant="secondary" color={colors.badInk} busy={busy} onPress={() => void go()} testID="take-back-yes" />
        <Button label={t('tb.keep')} onPress={() => setOpen(false)} />
      </Sheet>
    </>
  );
}
