import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { checkUpload, dmyToIso, formatSar, walletLine, type CardBrand, type DocumentKind, type Person, type WalletDocument } from '@mada/shared';
import { ApiError } from '@/lib/api';
import { API_MODE } from '@/lib/config';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { chooseFile, takePhoto } from '@/lib/pick';
import { toast } from '@/lib/toast';
import { useCards, useCredit, walletApi, walletKeys, type PickedFile } from '@/lib/wallet';
import { demo } from '@/lib/wallet-demo';
import { loadCopy, openCopyPdf } from '@/lib/passport-copy';
import { fmtDate, fullNameOf, useOnOpen } from '@/lib/wallet-model';
import { colors, ff, textEnd } from '@/theme';
import { Button } from '../Button';
import { PermissionDenied } from '../states';
import { Card } from '../Card';
import { EmptyState } from '../EmptyState';
import { Field } from '../Field';
import { Icon, type IconName } from '../Icon';
import { PayMark } from '../PayMark';
import { Sheet } from '../Sheet';
import { T } from '../Text';
import { ArtReceipt } from './Arts';
import { Spinner } from './ui';
import { ZoomImage } from './ZoomImage';
import { HAS_APPLE_PAY } from '@/lib/device';

/* The Wallet's sheets (prototype Wallet.jsx): add a document, upload it, a document's actions, a boarding pass,
   the Mada Wallet, and cards. */

/** A tappable well card with an icon, a title and a line under it. */
export function WellRow({ icon, title, sub, onPress, testID, danger }: { icon?: IconName; title: string; sub?: string; onPress: () => void; testID?: string; danger?: boolean }) {
  return (
    <Card variant="well" onPress={onPress} accessibilityLabel={title} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {icon ? <Icon name={icon} /> : null}
      <View style={{ flex: 1, gap: 0 }} testID={testID}>
        <T v="h3" style={{ fontSize: 15 }} color={danger ? colors.badInk : colors.green}>{title}</T>
        {sub ? <T v="tiny">{sub}</T> : null}
      </View>
    </Card>
  );
}

/* ───────────── add a document ───────────── */

export type AddKind = 'passport' | 'visa' | 'id' | 'insurance' | 'other';
const ADD: [AddKind, Parameters<typeof t>[0]][] = [['passport', 'docs.kind.passport'], ['visa', 'docs.kind.visa'], ['id', 'docs.kind.id'], ['insurance', 'docs.kind.insurance'], ['other', 'docs.kind.other']];

export function AddDocSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (k: AddKind) => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} label={t('wallet.add')}>
      <T v="h2" accessibilityRole="header">{t('docs.add.title')}</T>
      {ADD.map(([k, key]) => <WellRow key={k} title={t(key)} onPress={() => onPick(k)} testID={`add-${k}`} />)}
    </Sheet>
  );
}

const KIND: Record<Exclude<AddKind, 'passport'>, DocumentKind> = { visa: 'visa', id: 'national_id', insurance: 'insurance', other: 'other' };

/**
 * Upload a visa, ID, insurance or anything else (FLOWS.md §8c): scan with the camera or pick a photo or PDF, check
 * the type and size, then show back what we have before saving it, encrypted. Passports go through the passport
 * reader instead (/passport).
 */
export function UploadSheet({ visible, kind, person, replaces, onClose, onSaved }: {
  visible: boolean; kind: Exclude<AddKind, 'passport'>; person: Person; replaces?: WalletDocument | null; onClose: () => void; onSaved: () => void;
}) {
  const [stage, setStage] = useState<'choose' | 'reading' | 'failed' | 'found' | 'saving'>('choose');
  const [file, setFile] = useState<PickedFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [until, setUntil] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const [denied, setDenied] = useState(false);
  useOnOpen(visible, () => { setStage('choose'); setFile(null); setProblem(null); setUntil(''); setDenied(false); });

  const what = kind === 'other' ? t('docs.upload.aDocument') : t(ADD.find(([k]) => k === kind)![1]).toLowerCase();
  const title = t('docs.upload.for', { what, name: person.firstName || t('household.youPlain') });

  const read = (f: PickedFile | null | 'denied') => {
    setProblem(null);
    setDenied(false);
    if (!f) return;
    if (f === 'denied') { setDenied(true); return; }
    const bad = checkUpload(f);
    if (bad) { setProblem(t(bad)); buzz('soft'); return; }
    setFile(f);
    setStage('reading');
    timer.current = setTimeout(() => {
      if (demo('scanFails')) { setStage('failed'); buzz('soft'); } else { setStage('found'); buzz('success'); }
    }, 1600);
  };
  const untilIso = until.trim() ? dmyToIso(until.trim()) : null;
  const badUntil = !!until.trim() && !untilIso;

  const save = async () => {
    if (!file || badUntil) return;
    setStage('saving');
    try {
      await walletApi.addDocument({ personId: person.id, kind: KIND[kind], source: 'upload', ...(untilIso ? { validUntil: untilIso } : {}), ...(replaces ? { replaces: replaces.id } : {}), fields: { [t('docs.field.document')]: t(ADD.find(([k]) => k === kind)![1]), [t('docs.field.name')]: fullNameOf(person) || person.firstName } }, file);
      buzz('success');
      toast(t('docs.upload.saved'));
      onSaved();
    } catch (e) {
      setStage('found');
      setProblem(e instanceof ApiError ? e.message : t('error.internal'));
    }
  };

  const rows: [string, string][] = [
    [t('docs.field.document'), t(ADD.find(([k]) => k === kind)![1])],
    [t('docs.field.name'), fullNameOf(person) || person.firstName || t('household.youPlain')],
    [t('docs.field.type'), file?.type === 'application/pdf' ? t('docs.field.pdf') : t('docs.field.photo')],
  ];

  return (
    <Sheet visible={visible} onClose={onClose} label={title}>
      <T v="h2" accessibilityRole="header">{title}</T>
      {stage === 'choose' ? (
        <>
          <WellRow icon="scan" title={t('docs.upload.scan')} sub={t('docs.upload.scanSub')} onPress={async () => read(await takePhoto())} testID="upload-scan" />
          <WellRow icon="doc" title={t('docs.upload.file')} sub={t('docs.upload.fileSub')} onPress={async () => read(await chooseFile())} testID="upload-file" />
          {problem ? <T v="small" color={colors.badInk} accessibilityRole="alert" testID="upload-problem">{problem}</T> : null}
          {denied ? <PermissionDenied kind="camera" onSkip={async () => read(await chooseFile())} /> : null}
        </>
      ) : null}
      {stage === 'reading' ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Spinner /><T v="small">{file ? t('docs.upload.reading', { name: file.name }) : t('docs.upload.readingPage')}</T></View> : null}
      {stage === 'failed' ? (
        <>
          <T v="h3">{t('docs.upload.failed')}</T>
          <T v="small">{t('docs.upload.failedBody')}</T>
          <Button label={t('common.tryAgain')} onPress={() => setStage('choose')} />
        </>
      ) : null}
      {stage === 'found' || stage === 'saving' ? (
        <>
          <T v="small">{t('docs.upload.found')}</T>
          <Card variant="well" style={{ gap: 6 }}>
            {rows.map(([k, v]) => (
              <View key={k} style={styles.spread}><T v="small">{k}</T><T v="small" color={colors.green} style={{ fontFamily: ff.ui600, flexShrink: 1, textAlign: textEnd() }}>{v}</T></View>
            ))}
          </Card>
          <Field label={t('docs.field.validUntil')} value={until} onChangeText={setUntil} placeholder="11/06/2028" keyboardType="numbers-and-punctuation" error={badUntil ? t('passport.field.badDate') : null}
            hint={<T v="tiny">{t('docs.field.validUntilHint')}</T>} testID="upload-until" />
          {problem ? <T v="small" color={colors.badInk} accessibilityRole="alert">{problem}</T> : null}
          <Button label={t('docs.upload.save')} busy={stage === 'saving'} disabled={badUntil} onPress={save} testID="upload-save" />
          <Button variant="ghost" label={t('docs.upload.wrong')} onPress={() => { setFile(null); setStage('choose'); }} />
        </>
      ) : null}
    </Sheet>
  );
}

/* ───────────── one document ───────────── */

export function DocSheet({ doc, ask, onClose, onAdd, onReplace, tripId, onChanged }: {
  doc: WalletDocument | null; ask?: { title: string; sub: string } | null; onClose: () => void; onAdd: () => void; onReplace: (d: WalletDocument) => void; tripId?: string | null; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(false);
  const { height } = useWindowDimensions();
  const visible = !!doc || !!ask;
  const title = doc?.title ?? ask?.title ?? '';
  const sub = doc?.detail ?? ask?.sub ?? '';
  // The stored file (national ID, visa, insurance…): an image is fetched with the session only while the sheet is open
  // and kept in memory; a PDF opens in the phone's own viewer. Same route as the passport copy (/documents/:id/file).
  const pdf = doc?.file?.mime === 'application/pdf';
  const image = useQuery({ queryKey: ['wallet', 'doc-file', doc?.id ?? ''], enabled: visible && !!doc?.file && !pdf, gcTime: 0, staleTime: 0, retry: 1, queryFn: () => loadCopy(doc!) });
  const uri = visible && doc?.file && !pdf ? image.data ?? null : null;
  useOnOpen(visible, () => setZoom(false));
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); toast(done); onChanged(); onClose(); } catch (e) { toast(e instanceof ApiError ? e.message : t('error.internal')); } finally { setBusy(false); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} label={title}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name={doc?.kind === 'visa' || /visa/i.test(title) ? 'visa' : 'doc'} />
        <View style={{ flex: 1 }}><T v="h2">{title}</T><T v="tiny">{sub}</T></View>
      </View>
      {ask ? <Button label={t('wallet.docs.addIt')} onPress={() => { onClose(); onAdd(); }} testID="doc-add-it" /> : null}
      {doc ? (
        <>
          {doc.file && !pdf ? (
            zoom ? (
              <View style={{ gap: 8 }}>
                {uri ? <ZoomImage uri={uri} label={title} height={Math.min(520, height * 0.55)} testID="doc-zoom" /> : null}
                <T v="tiny" style={{ textAlign: 'center' }}>{t('wallet.docs.zoomHint')}</T>
                <Button variant="secondary" label={t('common.back')} onPress={() => setZoom(false)} style={{ backgroundColor: colors.mist }} testID="doc-zoom-back" />
              </View>
            ) : (
              <Pressable accessibilityRole="imagebutton" accessibilityLabel={t('wallet.docs.view')} disabled={!uri} onPress={() => { buzz('tap'); setZoom(true); }} style={styles.docFrame} testID="doc-image">
                {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityIgnoresInvertColors />
                  : image.isError ? <T v="small" style={{ textAlign: 'center', padding: 16 }}>{t('pp.copy.cantOpen')}</T>
                    : <ActivityIndicator color={colors.green} />}
                {uri ? <View style={styles.docHint}><Icon name="scan" size={14} color={colors.paper} /><T v="caption" color={colors.paper}>{t('wallet.docs.view')}</T></View> : null}
              </Pressable>
            )
          ) : doc.file && pdf ? (
            <WellRow icon="doc" title={t('pp.copy.pdf')} sub={t('pp.copy.openPdf')} onPress={() => { openCopyPdf(doc).catch(() => toast(t('pp.copy.cantOpen'))); }} testID="doc-pdf" />
          ) : <T v="tiny" testID="doc-no-file">{t('wallet.docs.noFile')}</T>}
          {zoom ? null : (<>
          {doc.sharedUntil ? <T v="small" color={colors.ok}>{t('wallet.docs.sharedUntil', { date: fmtDate(doc.sharedUntil, true) })}</T> : null}
          <WellRow title={t('wallet.docs.replace')} sub={t('wallet.docs.replaceBody')} onPress={() => { onClose(); onReplace(doc); }} testID="doc-replace" />
          {doc.sharedUntil
            ? <WellRow title={t('wallet.docs.stopSharing')} onPress={() => run(() => walletApi.unshareDocument(doc.id), t('wallet.docs.stopped'))} testID="doc-unshare" />
            : <WellRow title={t('wallet.docs.share')} sub={t('wallet.docs.shareBody')} onPress={() => run(() => walletApi.shareDocument(doc.id, tripId ?? undefined), t('wallet.docs.shared'))} testID="doc-share" />}
          {doc.removable
            ? <Button variant="ghost" color={colors.badInk} label={t('wallet.docs.delete')} busy={busy} onPress={() => run(() => walletApi.deleteDocument(doc.id), t('wallet.docs.deleted'))} testID="doc-delete" />
            : <T v="tiny">{t('wallet.docs.setup')}</T>}
          </>)}
        </>
      ) : null}
    </Sheet>
  );
}

/* ───────────── Mada Wallet ───────────── */

/** One movement, the way the Wallet says it: "Refund · Garden hotel, Istanbul", "Used · Istanbul, 9–15 Mar". */
export const walletLineText = (e: { kind: string; note: string | null }) => {
  const l = walletLine(e.kind, e.note);
  const what = t(`money.credit.${l.what}`);
  return l.detail ? t('money.credit.line', { what, detail: l.detail }) : what;
};

/** The same line split for a two-line row: the place on top, "Refund" under it (with the date). */
export const walletLineHead = (e: { kind: string; note: string | null }) => {
  const l = walletLine(e.kind, e.note);
  const what = t(`money.credit.${l.what}`);
  return l.detail ? { title: l.detail, sub: what } : { title: what, sub: '' };
};

/** The Mada Wallet: the balance and every movement. For bookings only: nothing here moves it to a card. */
export function CreditSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const credit = useCredit();
  const { refetch } = credit;
  useEffect(() => { if (visible) refetch(); }, [visible, refetch]);
  const bal = credit.data?.balance.amount ?? 0;
  return (
    <Sheet visible={visible} onClose={onClose} label={t('money.credit')}>
      <T v="h2" accessibilityRole="header">{t('money.credit.title', { amount: formatSar(bal) })}</T>
      <T v="small">{t('money.credit.body')}</T>
      {(credit.data?.entries ?? []).length === 0 ? (
        <EmptyState compact art={<ArtReceipt width={100} height={75} />} title={t('money.credit.emptyTitle')} body={t('money.credit.emptyBody')} />
      ) : credit.data!.entries.map((e) => (
        <View key={e.id} style={styles.spread} testID="credit-line">
          <View style={{ flex: 1 }}><T v="body" color={colors.green} style={{ fontSize: 15 }}>{walletLineText(e)}</T><T v="tiny">{fmtDate(e.createdAt)}</T></View>
          <T style={{ fontFamily: ff.ui600, fontSize: 15, color: e.amount > 0 ? colors.ok : colors.green, fontVariant: ['tabular-nums'] }}>{formatSar(e.amount, { sign: true })}</T>
        </View>
      ))}
    </Sheet>
  );
}

/* ───────────── cards ───────────── */

const MADA_BINS = ['440647', '440795', '446404', '457865', '588845', '588846', '588848', '588850', '604906', '968201', '968202', '968203', '968204', '968205', '968206', '968207', '968208', '968209', '968210', '968211'];
export function cardBrand(d: string): CardBrand | null {
  if (MADA_BINS.some((b) => d.startsWith(b))) return 'mada';
  if (/^4/.test(d)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'mastercard';
  return null;
}
export function luhn(d: string) {
  let sum = 0;
  for (let i = 0; i < d.length; i += 1) { let x = Number(d[d.length - 1 - i]); if (i % 2 === 1) { x *= 2; if (x > 9) x -= 9; } sum += x; }
  return d.length >= 13 && sum % 10 === 0;
}

/** The payment provider's SDK turns a card into a token on the phone. In mock mode, a mock token. */
async function tokenise(_digits: string): Promise<string> {
  if (API_MODE === 'mock') return `tok_mock_${Math.random().toString(36).slice(2, 12)}`;
  throw new ApiError('NOT_CONFIGURED', t('error.notConfigured'), 501);
}

/** "Pay with": saved cards, Apple Pay, and adding a card (prototype Pay.jsx CardsSheet). */
export function CardsSheet({ visible, onClose, onPicked }: { visible: boolean; onClose: () => void; onPicked?: (label: string, changed: boolean) => void }) {
  const qc = useQueryClient();
  const cards = useCards();
  const credit = useCredit();
  const [adding, setAdding] = useState(false);
  const [num, setNum] = useState('');
  const [exp, setExp] = useState('');
  const [cvv, setCvv] = useState('');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState<{ num?: boolean; exp?: boolean }>({});
  const [busy, setBusy] = useState(false);
  useOnOpen(visible, () => { setAdding(false); setNum(''); setExp(''); setCvv(''); setName(''); setTouched({}); });
  const digits = num.replace(/\D/g, '');
  const brand = cardBrand(digits);
  const amex = /^3[47]/.test(digits);
  const numOk = !!brand && digits.length === 16 && luhn(digits);
  const [mm, yy] = exp.split('/').map(Number) as [number, number];
  const d = new Date(); const cy = d.getFullYear() % 100; const cm = d.getMonth() + 1;
  const expOk = /^\d{2}\/\d{2}$/.test(exp) && mm >= 1 && mm <= 12 && (yy > cy || (yy === cy && mm >= cm));
  const ok = numOk && expOk && /^\d{3}$/.test(cvv) && name.trim().length >= 3;
  const numErr = amex ? t('cards.problem.amex') : digits.length >= 16 && !luhn(digits) ? t('cards.problem.luhn') : digits.length > 0 && digits.length < 16 && touched.num ? t('cards.problem.short') : digits.length >= 6 && !brand ? t('cards.problem.brand') : null;
  const expErr = touched.exp && exp && !expOk ? (/^\d{2}\/\d{2}$/.test(exp) ? t('cards.problem.expired') : t('cards.problem.format')) : null;
  const current = cards.data?.defaultId ?? 'applepay';
  const bal = credit.data?.balance.amount ?? 0;

  const pick = async (id: string) => {
    buzz('select');
    const changed = id !== current;
    try {
      if (changed) qc.setQueryData(walletKeys.cards, await walletApi.setDefaultCard(id));
      onPicked?.(id === 'applepay' ? t('cards.applePay') : cards.data?.cards.find((c) => c.id === id)?.label ?? '', changed);
      onClose();
    } catch (e) { toast(e instanceof ApiError ? e.message : t('error.internal')); }
  };
  const add = async () => {
    if (!ok || !brand) return;
    setBusy(true);
    try {
      const token = await tokenise(digits);
      const r = await walletApi.addCard({ token, brand, last4: digits.slice(-4), exp, makeDefault: true });
      qc.setQueryData(walletKeys.cards, r);
      buzz('success');
      onPicked?.(r.cards[r.cards.length - 1]!.label, true);
      onClose();
    } catch (e) { toast(e instanceof ApiError ? e.message : t('error.internal')); } finally { setBusy(false); }
  };

  return (
    <Sheet visible={visible} onClose={onClose} label={t('cards.title')}>
      <T v="h2" accessibilityRole="header">{t('cards.title')}</T>
      {bal > 0 ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><PayMark brand="credit" size={22} /><T v="small" color={colors.green}>{t('cards.creditNote', { amount: formatSar(bal) })}</T></View> : null}
      {(cards.data?.cards ?? []).map((c) => (
        <Card key={c.id} variant="well" selected={c.id === current} onPress={() => pick(c.id)} accessibilityLabel={c.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <PayMark brand={c.brand} size={30} />
          <View style={{ flex: 1 }}><T v="h3" style={{ fontSize: 15 }}>{c.label}</T><T v="tiny">{t('cards.expires', { exp: c.exp })}</T></View>
          {c.id === current ? <Icon name="check" color={colors.ok} width={2.4} /> : null}
        </Card>
      ))}
      {HAS_APPLE_PAY ? <Card variant="well" selected={current === 'applepay'} onPress={() => pick('applepay')} accessibilityLabel={t('cards.applePay')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <PayMark brand="applepay" size={30} /><T v="h3" style={{ fontSize: 15, flex: 1 }}>{t('cards.applePay')}</T>{current === 'applepay' ? <Icon name="check" color={colors.ok} width={2.4} /> : null}
      </Card> : null}
      {adding ? (
        <View style={{ gap: 12 }}>
          <Field label={t('cards.number')} value={num} keyboardType="number-pad" autoComplete="cc-number" placeholder="4000 0000 0000 0000" error={numErr} onBlur={() => setTouched({ ...touched, num: true })}
            onChangeText={(v) => setNum(v.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 '))} testID="card-number" />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Field label={t('cards.expiry')} value={exp} keyboardType="number-pad" placeholder="MM/YY" error={expErr} onBlur={() => setTouched({ ...touched, exp: true })}
              onChangeText={(v) => { const x = v.replace(/\D/g, '').slice(0, 4); setExp(x.length > 2 ? `${x.slice(0, 2)}/${x.slice(2)}` : x); }} testID="card-exp" /></View>
            <View style={{ flex: 1 }}><Field label={t('cards.cvv')} value={cvv} keyboardType="number-pad" placeholder={t('cards.cvvHint')} onChangeText={(v) => setCvv(v.replace(/\D/g, '').slice(0, 3))} secureTextEntry testID="card-cvv" /></View>
          </View>
          <Field label={t('cards.name')} value={name} onChangeText={setName} autoCapitalize="characters" placeholder="OMAR ALHARBI" testID="card-name" />
          <T v="tiny">{t('cards.note')}{API_MODE === 'mock' ? ` ${t('cards.test')}` : ''}</T>
          <Button label={t('cards.use')} disabled={!ok} busy={busy} onPress={add} testID="card-use" />
        </View>
      ) : <Button variant="secondary" style={well} icon={<Icon name="plus" />} label={t('cards.add')} onPress={() => setAdding(true)} testID="card-add" />}
    </Sheet>
  );
}

/** Copy the passport number: only the masked one lives on the phone (the full one is with Mada, encrypted). */
export async function copyMasked(masked: string) {
  try { await Clipboard.setStringAsync(masked); } catch { /* the toast still shows it */ }
  toast(t('wallet.copyNumber.masked', { number: masked }));
}

/** Secondary buttons on a sheet sit on mist, not paper (prototype .sheet .btn.secondary). */
const well = { backgroundColor: colors.mist };

const styles = StyleSheet.create({
  docFrame: { height: 200, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' },
  docHint: { position: 'absolute', bottom: 10, end: 10, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(15,26,22,0.72)' },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
});
