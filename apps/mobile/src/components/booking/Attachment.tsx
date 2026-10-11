import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { ThreadAttachment } from '@mada/shared';
import { fileSize, fileUrl, openFile } from '@/lib/beta';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { colors, ff } from '@/theme';
import { Icon } from '../Icon';
import { T } from '../Text';

/**
 * A photo or PDF in a conversation (the desk sends e-tickets, visas, vouchers). Opens through the short-lived signed
 * link the server gave with the message: a photo shows inline, a PDF opens in the system's viewer.
 */
export function AttachmentChip({ file, mine }: { file: Pick<ThreadAttachment, 'name' | 'mime' | 'size' | 'url'>; mine?: boolean }) {
  const [broken, setBroken] = useState(false);
  const url = fileUrl(file.url);
  const photo = file.mime.startsWith('image/') && !!url && !broken;
  const open = async () => {
    buzz('tap');
    if (!(await openFile(file.url))) toast(t('beta.file.gone'));
  };
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${t('beta.file.open')} ${file.name}`} onPress={open} style={styles.wrap} testID="attachment">
      {photo ? <Image source={{ uri: url! }} style={styles.photo} resizeMode="cover" onError={() => setBroken(true)} accessibilityIgnoresInvertColors /> : null}
      <View style={[styles.row, mine ? styles.rowMine : null]}>
        <View style={styles.icon}><Icon name={file.mime === 'application/pdf' ? 'doc' : 'scan'} size={18} color={colors.green} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T v="small" numberOfLines={1} color={mine ? colors.mist : colors.green} style={{ fontFamily: ff.ui600 }}>{file.name}</T>
          <T v="tiny" color={mine ? colors.onDark2 : undefined}>{file.mime === 'application/pdf' ? t('beta.file.pdf', { size: fileSize(file.size) }) : t('beta.file.photo', { size: fileSize(file.size) })}</T>
        </View>
        <T v="small" color={mine ? colors.mist : colors.goldInk} style={{ fontFamily: ff.ui600 }}>{t('beta.file.open')}</T>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, alignSelf: 'stretch', minWidth: 220 },
  photo: { width: '100%', height: 150, borderRadius: 12, backgroundColor: colors.mist },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, backgroundColor: colors.mist },
  rowMine: { backgroundColor: 'rgba(255,255,255,0.12)' },
  icon: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
});
