import { useState } from 'react';
import { Platform, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { checkUpload } from '@mada/shared';
import { ApiError } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { useAccount, walletApi, walletKeys, type PickedFile } from '@/lib/wallet';
import { fmtDate } from '@/lib/wallet-model';
import { colors } from '@/theme';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { T } from '../Text';
import { UserAvatar } from './ui';

/**
 * Your photo (Account.jsx PhotoSheet): take one or choose one, then move and zoom it in a square (the system's crop
 * on a phone), JPEG or PNG up to 10 MB. Faisal and your circles see it; it's never on a booking.
 */
export function PhotoSheet({ visible, onClose, initial }: { visible: boolean; onClose: () => void; initial: string }) {
  const qc = useQueryClient();
  const account = useAccount();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const photo = account.data?.photo;

  const use = async (fromCamera: boolean) => {
    setProblem(null);
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.86 };
    if (fromCamera && Platform.OS !== 'web') { const p = await ImagePicker.requestCameraPermissionsAsync().catch(() => ({ granted: true })); if (!p.granted) { setProblem(t('passport.camera.deniedBody')); return; } }
    const r = fromCamera ? await ImagePicker.launchCameraAsync({ ...opts, cameraType: ImagePicker.CameraType.front }) : await ImagePicker.launchImageLibraryAsync(opts);
    const a = r.canceled ? null : r.assets[0];
    if (!a) return;
    const name = a.fileName ?? a.file?.name ?? 'photo.jpg';
    const f: PickedFile = { uri: a.uri, name, type: a.mimeType ?? a.file?.type ?? 'image/jpeg', size: a.fileSize ?? a.file?.size ?? 0, file: a.file ?? null };
    const bad = checkUpload(f, { photosOnly: true });
    if (bad) { setProblem(bad === 'wallet.upload.tooBig' ? t('account.photo.tooBig') : t('account.photo.notPhoto')); buzz('soft'); return; }
    setBusy(true);
    try {
      const { account: acc } = await walletApi.setPhoto(f);
      qc.setQueryData(walletKeys.account, acc);
      buzz('success'); toast(t('account.photo.updated')); onClose();
    } catch (e) { setProblem(e instanceof ApiError ? e.message : t('error.internal')); } finally { setBusy(false); }
  };
  const remove = async () => {
    try { const { account: acc } = await walletApi.removePhoto(); qc.setQueryData(walletKeys.account, acc); buzz('tap'); toast(t('account.photo.removed')); onClose(); } catch { toast(t('error.internal')); }
  };

  return (
    <Sheet visible={visible} onClose={onClose} label={t('account.photo.title')}>
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <UserAvatar size={64} initial={initial} hasPhoto={!!photo} photoKey={photo?.updatedAt} />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="h2">{t('account.photo.title')}</T>
          <T v="small">{photo ? t('account.photo.added', { date: fmtDate(photo.updatedAt) }) : t('account.photo.body')}</T>
        </View>
      </View>
      <Button label={t('account.photo.take')} icon={<Icon name="scan" color={colors.gold} />} busy={busy} onPress={() => use(true)} testID="photo-take" />
      <Button variant="secondary" style={{ backgroundColor: colors.mist }} label={t('account.photo.choose')} onPress={() => use(false)} testID="photo-choose" />
      {problem ? <T v="small" color={colors.badInk} style={{ textAlign: 'center' }} accessibilityRole="alert">{problem}</T> : null}
      {photo ? <Button variant="ghost" color={colors.badInk} label={t('account.photo.remove')} onPress={remove} testID="photo-remove" /> : null}
      <T v="tiny" style={{ textAlign: 'center' }}>{t('account.photo.rules')}</T>
    </Sheet>
  );
}
