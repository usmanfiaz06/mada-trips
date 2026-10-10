import { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import Svg, { Rect } from 'react-native-svg';
import { Company, type InvoiceDoc } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { dl } from '@/components/trips/money';
import { Box, Grow, H3, Num, Row, Small, Spread, TextLink, Tiny, TripScreen } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { newKey, tripsApi, useInvoice, useTrip, useTripMutation } from '@/lib/trips';
import { colors, ff } from '@/theme';

const fmt2 = (h: number) => (Math.abs(h) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A stand-in drawing of the ZATCA QR, stable per invoice (the payload itself is on the document). */
function QrMark({ seed, size = 92 }: { seed: string; size?: number }) {
  const N = 25;
  let h = 2166136261;
  for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000; };
  const finder = (x: number, y: number) => (x < 7 && y < 7) || (x >= N - 7 && y < 7) || (x < 7 && y >= N - 7);
  const cells: [number, number][] = [];
  for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) if (!finder(x, y) && rnd() > 0.52) cells.push([x, y]);
  const F = ({ x, y }: { x: number; y: number }) => <><Rect x={x} y={y} width={7} height={7} fill={colors.green} /><Rect x={x + 1} y={y + 1} width={5} height={5} fill="#fff" /><Rect x={x + 2} y={y + 2} width={3} height={3} fill={colors.green} /></>;
  return (
    <Svg width={size} height={size} viewBox={`-1 -1 ${N + 2} ${N + 2}`} accessibilityLabel={t('inv.qr')} style={{ backgroundColor: '#fff', borderRadius: 8 }}>
      {cells.map(([x, y]) => <Rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={colors.green} />)}
      <F x={0} y={0} /><F x={N - 7} y={0} /><F x={0} y={N - 7} />
    </Svg>
  );
}

/** Field problems in the traveller's words (the server checks the same rules). */
function companyErrors(c: { name: string; vat: string; cr: string; address: string }) {
  const vat = c.vat.replace(/\D/g, '');
  const cr = c.cr.replace(/\D/g, '');
  return {
    name: c.name.trim().length < 2 ? t('inv.co.errName') : null,
    vat: !vat ? t('inv.co.errVat') : vat.length !== 15 ? t('inv.co.errVatLen', { n: vat.length }) : !/^3\d{13}3$/.test(vat) ? t('inv.co.errVat3') : null,
    cr: !cr ? t('inv.co.errCr') : cr.length !== 10 ? t('inv.co.errCrLen', { n: cr.length }) : null,
    address: c.address.trim().length < 10 ? t('inv.co.errAddr') : null,
  };
}

function CompanySheet({ open, onClose, invoiceId, current, onSaved }: { open: boolean; onClose: () => void; invoiceId: string; current: InvoiceDoc['company']; onSaved: (id: string) => void }) {
  const [c, setC] = useState({ name: current?.name ?? '', vat: current?.vat ?? '', cr: current?.cr ?? '', address: current?.address ?? '' });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const save = useTripMutation((company: Company) => tripsApi.company(invoiceId, company));
  const errs = companyErrors(c);
  const ok = !Object.values(errs).some(Boolean);
  const field = (k: keyof typeof c, label: string, o: { digits?: number; ph: string }) => (
    <View style={{ gap: 6 }}>
      <T style={styles.label}>{label}</T>
      <TextInput testID={`co-${k}`} value={c[k]} placeholder={o.ph} placeholderTextColor={colors.muted} keyboardType={o.digits ? 'number-pad' : 'default'} onBlur={() => setTouched({ ...touched, [k]: true })}
        onChangeText={(v) => setC({ ...c, [k]: o.digits ? v.replace(/\D/g, '').slice(0, o.digits) : v })} style={[styles.input, touched[k] && errs[k] ? { borderColor: colors.bad } : null]} />
      {touched[k] && errs[k] ? <T v="small" color={colors.bad} accessibilityRole="alert">{errs[k]}</T> : null}
    </View>
  );
  return (
    <Sheet visible={open} onClose={onClose} label={t('inv.co.title')}>
      <T v="h2">{t('inv.co.title')}</T>
      <Small style={{ marginTop: -8 }}>{t('inv.co.body')}</Small>
      {field('name', t('inv.co.name'), { ph: t('inv.co.namePh') })}
      {field('vat', t('inv.co.vat'), { digits: 15, ph: '3XXXXXXXXXXXXX3' })}
      {field('cr', t('inv.co.cr'), { digits: 10, ph: t('inv.co.crPh') })}
      {field('address', t('inv.co.address'), { ph: t('inv.co.addressPh') })}
      <Button testID="co-save" label={t('inv.co.save')} busy={save.isPending} onPress={() => {
        setTouched({ name: true, vat: true, cr: true, address: true });
        if (!ok) return;
        save.mutate({ name: c.name.trim(), vat: c.vat, cr: c.cr, address: c.address.trim() }, { onSuccess: (r) => { buzz('success'); toast(t('inv.co.saved')); onSaved(r.invoice.id); onClose(); }, onError: (e) => toast(e.message) });
      }} />
    </Sheet>
  );
}

/** The VAT invoice for one payment: simplified, a company's full tax invoice (draft, then issued), or the credit note. */
export default function InvoiceScreen() {
  const { id, invoiceId } = useLocalSearchParams<{ id: string; invoiceId: string }>();
  const router = useRouter();
  const trip = useTrip(id).data?.trip;
  const [shownId, setShownId] = useState(invoiceId);
  const q = useInvoice(shownId);
  const base = useInvoice(invoiceId);
  const [sheet, setSheet] = useState(false);
  const issue = useTripMutation((iid: string) => tripsApi.issue(iid));
  const ask = useTripMutation(() => tripsApi.ask(id, { area: 'other', kind: 'reissue', clientKey: newKey() }));
  const doc = q.data?.invoice;
  const related = base.data?.invoice.related ?? [];
  const credit = related.find((r) => r.kind === 'credit_note');
  const tax = related.find((r) => r.kind === 'tax');
  const simplified = related.find((r) => r.kind === 'simplified');
  if (!doc) return <TripScreen title={t('inv.title')}>{q.isError ? <Box tone="well"><H3>{t('inv.gone')}</H3><Small>{t('inv.goneBody')}</Small></Box> : null}</TripScreen>;
  const isCredit = doc.kind === 'credit_note';
  const draft = doc.status === 'draft';
  const share = async () => {
    buzz('tap');
    try {
      const Print = await import('expo-print');
      if (Platform.OS === 'web') { await Print.printAsync({ html: q.data!.html }); return; }
      const { uri } = await Print.printToFileAsync({ html: q.data!.html });
      const Sharing = await import('expo-sharing');
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: doc.number });
      else toast(t('inv.saved'));
    } catch { toast(t('inv.cantShare')); }
  };
  const total = doc.total.amount;
  const sign = isCredit ? '−' : '';
  return (
    <TripScreen title={isCredit ? t('inv.kind.credit_note') : doc.kind === 'tax' ? t('inv.kind.tax') : t('inv.title')}
      act={draft ? (<>
        <Button testID="issue" label={t('inv.issue')} busy={issue.isPending} onPress={() => issue.mutate(doc.id, { onSuccess: () => { buzz('success'); toast(t('inv.issued')); } })} />
        <Button label={t('inv.editCo')} variant="secondary" onPress={() => setSheet(true)} />
      </>) : <Button testID="share-pdf" label={t('inv.share')} icon={<Icon name="doc" color={colors.mist} size={20} />} onPress={() => void share()} />}>
      {credit || tax ? (
        <Row gap={8} style={{ flexWrap: 'wrap' }}>
          {simplified ? <Chip label={t('inv.tab.invoice')} on={shownId === simplified.id} onPress={() => setShownId(simplified.id)} /> : null}
          {tax ? <Chip label={t('inv.tab.tax')} on={shownId === tax.id} onPress={() => setShownId(tax.id)} /> : null}
          {credit ? <Chip label={t('inv.tab.credit')} on={shownId === credit.id} onPress={() => setShownId(credit.id)} /> : null}
        </Row>
      ) : null}
      {draft ? (
        <Box tone="warn" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <Icon name="doc" size={20} /><Grow><H3 size={15}>{t('inv.draft.title')}</H3><Small>{t('inv.draft.body', { agent: trip?.agent.name ?? 'Faisal' })}</Small></Grow>
        </Box>
      ) : null}
      <View style={[styles.paper, draft ? styles.paperDraft : null]} testID="invoice-paper" accessibilityLabel={t(`inv.kind.${doc.kind}`)}>
        <Spread align="flex-start">
          <View style={{ gap: 2, flex: 1 }}>
            <T style={{ fontFamily: ff.display, fontSize: 26, lineHeight: 28, color: draft ? colors.goldInk : colors.green }}>{t(`inv.kind.${doc.kind}`)}{draft ? ` · ${t('inv.draft')}` : ''}</T>
            <T style={{ fontSize: 14, color: colors.ink2, writingDirection: 'rtl' }}>{t(`inv.kindAr.${doc.kind}`)}</T>
          </View>
          <QrMark seed={doc.number} />
        </Spread>
        <View style={styles.grid}>
          <Cell k={t('inv.f.seller')} v={doc.seller.name} sub={doc.seller.legal} />
          <Cell k={t('inv.f.vat')} v={doc.seller.vat} num />
          <Cell k={isCredit ? t('inv.f.cnNo') : t('inv.f.no')} v={draft ? t('inv.f.onIssue') : doc.number} num />
          <Cell k={t('inv.f.date')} v={`${dl(doc.issuedAt)} ${doc.issuedAt.slice(11, 16)}`} />
          {doc.company ? (<>
            <Cell k={t('inv.f.buyer')} v={doc.company.name} sub={doc.company.address} />
            <Cell k={t('inv.f.buyerVat')} v={doc.company.vat} sub={`CR ${doc.company.cr}`} num />
            <Cell k={t('inv.f.traveller')} v={doc.customer} />
          </>) : <Cell k={t('inv.f.customer')} v={doc.customer} />}
          <Cell k={isCredit ? t('inv.f.against') : t('inv.f.paidWith')} v={(isCredit ? doc.againstNumber : doc.paidWith) ?? ''} />
        </View>
        <View style={styles.lines}>
          {doc.lines.map((l, i) => (
            <Row key={`${l.text}-${i}`} align="flex-start" gap={12} style={[{ paddingVertical: 8 }, i ? { borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: colors.line } : null]}>
              <Grow gap={1}><Small color={colors.green}>{l.text}</Small><Tiny>{t('inv.vatRate', { rate: l.vatRateBps / 100 })}{l.note ? ` · ${l.note}` : ''}</Tiny></Grow>
              <Num size={13}>{l.gross < 0 ? '−' : sign}{fmt2(l.gross)}</Num>
            </Row>
          ))}
        </View>
        <View style={{ gap: 6 }}>
          <Spread><Small>{t('inv.beforeVat')}</Small><Num size={13} weight={500}>{sign}{fmt2(total - doc.vat.amount)}</Num></Spread>
          <Spread><Small>{t('inv.vat15')}</Small><Num size={13} weight={500}>{sign}{fmt2(doc.vat.amount)}</Num></Spread>
          <Spread><H3>{t('inv.total')}</H3><Num size={16}>{`${sign}SAR ${fmt2(total)}`}</Num></Spread>
        </View>
        <Tiny>{doc.seller.cr} · {doc.seller.address}. {t('inv.foot')}</Tiny>
      </View>
      {credit && shownId !== credit.id ? <TextLink testID="see-credit" label={t('inv.seeCredit')} onPress={() => setShownId(credit.id)} /> : null}
      {!isCredit && !doc.company && !tax ? (
        <Box tone="well" onPress={() => setSheet(true)} style={{ flexDirection: 'row', alignItems: 'center' }} testID="company-open">
          <Icon name="card" /><Grow gap={0}><H3 size={15}>{t('inv.co.title')}</H3><Tiny>{t('inv.co.row')}</Tiny></Grow><Icon name="chevron" />
        </Box>
      ) : null}
      {doc.kind === 'tax' && !draft ? (
        <Box tone="well" gap={6}>
          <Row><Icon name="lock" size={16} /><Small color={colors.green} style={{ fontFamily: ff.ui600, flex: 1 }}>{t('inv.issuedTo', { name: doc.company?.name ?? '', day: dl(doc.issuedAt) })}</Small></Row>
          <Small>{t('inv.cantEdit', { agent: trip?.agent.name ?? 'Faisal' })}</Small>
          <Button label={t('inv.askReissue')} variant="secondary" size="small" block={false} busy={ask.isPending} onPress={() => ask.mutate(undefined, { onSuccess: () => { buzz('success'); toast(t('inv.reissueSent')); router.push('/trips?tab=requests' as Href); } })} />
        </Box>
      ) : null}
      <CompanySheet open={sheet} onClose={() => setSheet(false)} invoiceId={tax?.id ?? invoiceId} current={doc.company ?? trip?.company ?? null} onSaved={(nid) => setShownId(nid)} />
    </TripScreen>
  );
}

function Cell({ k, v, sub, num }: { k: string; v: string; sub?: string; num?: boolean }) {
  return (
    <View style={styles.cell}>
      <T style={styles.cellK}>{k}</T>
      <T style={{ fontSize: 13, lineHeight: 17, color: colors.green, fontFamily: num ? ff.ui600 : ff.ui400 }}>{v}</T>
      {sub ? <Tiny>{sub}</Tiny> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  paper: { backgroundColor: '#fff', borderRadius: 20, padding: 18, gap: 14, borderWidth: 1, borderColor: 'rgba(30,53,45,0.06)' },
  paperDraft: { borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(125,93,39,0.45)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10, columnGap: 14 },
  cell: { width: '46%', gap: 1 },
  cellK: { fontSize: 11, lineHeight: 14, fontFamily: ff.ui600, letterSpacing: 0.44, textTransform: 'uppercase', color: colors.ink3 },
  lines: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, paddingVertical: 4 },
  label: { fontFamily: ff.ui600, fontSize: 13, lineHeight: 17, color: colors.ink2 },
  input: { height: 52, borderRadius: 16, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.mist, paddingHorizontal: 16, fontSize: 16, fontFamily: ff.ui500, color: colors.green },
});
