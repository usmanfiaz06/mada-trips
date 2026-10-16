import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { Person } from '@mada/shared';
import { ApiError } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { keepPassportCopy, loadCopy, openCopyPdf, usePassportCopy } from '@/lib/passport-copy';
import { chooseFile } from '@/lib/pick';
import { toast } from '@/lib/toast';
import { useRefreshHousehold, walletApi } from '@/lib/wallet';
import { fmtDate, useOnOpen } from '@/lib/wallet-model';
import { colors } from '@/theme';
import { Button } from '../Button';
import { Card } from '../Card';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { T } from '../Text';
import { ZoomImage } from '../wallet/ZoomImage';

/*
 * The passport copy in the Wallet and on a household page: whether one is kept, and a sheet to see it, replace it
 * (with the line that says who can see it, before anything is sent) or delete it (the file goes for good).
 */

export function PassportCopyRow({ person }: { person: Person }) {
  const doc = usePassportCopy(person.id);
  const [open, setOpen] = useState(false);
  if (!person.passport && !doc) return null;
  return (
    <>
      <View testID="copy-row"><Card onPress={() => setOpen(true)} accessibilityLabel={t('pp.copy.title')} style={styles.row}>
        <Icon name={doc ? 'lock' : 'doc'} />
        <View style={{ flex: 1 }}>
          <T v="h3" style={{ fontSize: 15 }}>{t('pp.copy.title')}</T>
          <T v="tiny" testID="copy-row-sub">{doc ? t('pp.copy.rowSub', { date: fmtDate(doc.createdAt, true) }) : t('pp.copy.noneSub')}</T>
        </View>
        <Icon name="chevron" />
      </Card></View>
      <PassportCopySheet person={person} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function PassportCopySheet({ person, visible, onClose }: { person: Person; visible: boolean; onClose: () => void }) {
  const doc = usePassportCopy(person.id);
  const refresh = useRefreshHousehold();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pdf = doc?.file?.mime === 'application/pdf';
  useOnOpen(visible, () => setConfirmDelete(false));
  // The image is fetched only while the sheet is open, kept in memory, and dropped as soon as it closes.
  const image = useQuery({ queryKey: ['wallet', 'passport-copy', doc?.id ?? ''], enabled: visible && !!doc && !pdf, gcTime: 0, staleTime: 0, retry: 1, queryFn: () => loadCopy(doc!) });
  const uri = visible ? image.data ?? null : null;
  const failed = image.isError;

  const replace = async () => {
    const f = await chooseFile();
    if (!f) return;
    setBusy(true);
    try {
      await keepPassportCopy(person.id, f, { source: 'upload', expiry: person.passport?.expiry, fields: doc?.fields, replaces: doc?.id });
      await refresh();
      buzz('success'); toast(t('pp.copy.saved'));
    } catch (e) { toast(e instanceof ApiError ? e.message : t('error.internal')); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      await walletApi.deleteDocument(doc.id);
      await refresh();
      buzz('tap'); toast(t('pp.copy.deleted')); onClose();
    } catch (e) { toast(e instanceof ApiError ? e.message : t('error.internal')); } finally { setBusy(false); }
  };

  return (
    <Sheet visible={visible} onClose={onClose} label={t('pp.copy.title')}>
      <View testID="copy-sheet" style={{ gap: 12 }}>
        <T v="h2">{t('pp.copy.title')}</T>
        {confirmDelete ? (
          <>
            <T v="h3">{t('pp.copy.deleteTitle')}</T>
            <T v="body">{t('pp.copy.deleteBody')}</T>
            <Button variant="secondary" style={{ backgroundColor: colors.mist }} color={colors.badInk} label={t('pp.copy.deleteYes')} busy={busy} onPress={remove} testID="copy-delete-yes" />
            <Button label={t('pp.copy.keepIt')} onPress={() => setConfirmDelete(false)} />
          </>
        ) : (
          <>
            {doc ? (
              pdf ? (
                <View testID="copy-pdf"><Card variant="well" onPress={() => { openCopyPdf(doc).catch(() => toast(t('pp.copy.cantOpen'))); }} accessibilityLabel={t('pp.copy.openPdf')} style={styles.row}>
                  <Icon name="doc" /><View style={{ flex: 1 }}><T v="h3" style={{ fontSize: 15 }}>{t('pp.copy.pdf')}</T><T v="tiny">{t('pp.copy.openPdf')}</T></View><Icon name="chevron" />
                </Card></View>
              ) : (
                uri ? <View testID="copy-image"><ZoomImage uri={uri} label={t('pp.copy.title')} height={220} /></View> : (
                  <View style={styles.frame}>
                    {failed ? <T v="small" style={{ textAlign: 'center', padding: 16 }}>{t('pp.copy.cantOpen')}</T> : <ActivityIndicator color={colors.green} />}
                  </View>
                )
              )
            ) : null}
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Icon name="lock" size={16} color={colors.ink2} />
              <T v="small" style={{ flex: 1 }} testID="copy-consent">{t('pp.copy.consent')}</T>
            </View>
            <Button label={doc ? t('pp.copy.replace') : t('pp.copy.add')} icon={<Icon name="doc" color={colors.gold} />} busy={busy && !confirmDelete} onPress={replace} testID={doc ? 'copy-replace' : 'copy-add'} />
            {doc && doc.removable ? <Button variant="ghost" color={colors.badInk} label={t('pp.copy.delete')} onPress={() => setConfirmDelete(true)} testID="copy-delete" /> : null}
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  frame: { height: 220, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' },
});
