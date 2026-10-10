import type { Post, PostSnapshot } from '@mada/shared';
import { circlesApi, ck, useAct, useSaved } from '@/lib/circles';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';

/** Save and unsave tips and plans, with the prototype's toasts. A saved tip is a copy that stays even if the post goes. */
export function useSaveToggle() {
  const saved = useSaved();
  const list = saved.data?.saved ?? [];
  const save = useAct(circlesApi.save, () => [['circles', 'saved'], ['circles', 'posts']]);
  const unsave = useAct(circlesApi.unsave, () => [['circles', 'saved'], ['circles', 'posts']]);
  const find = (kind: 'post' | 'plan', id: string) => list.find((s) => s.kind === kind && s.refId === id);
  return {
    isSaved: (kind: 'post' | 'plan', id: string) => !!find(kind, id),
    togglePost(p: Pick<Post, 'id' | 'city'> | PostSnapshot) {
      buzz('select');
      const s = find('post', p.id);
      if (s) unsave.mutate(s.id, { onSuccess: () => toast(t('circles.saveToast.removed')) });
      else save.mutate({ kind: 'post', refId: p.id }, { onSuccess: () => toast(t('circles.saveToast.post', { city: p.city })) });
    },
    togglePlan(id: string) {
      buzz('select');
      const s = find('plan', id);
      if (s) unsave.mutate(s.id, { onSuccess: () => toast(t('circles.saveToast.removed')) });
      else save.mutate({ kind: 'plan', refId: id }, { onSuccess: () => toast(t('circles.saveToast.plan')) });
    },
  };
}
export { ck };
