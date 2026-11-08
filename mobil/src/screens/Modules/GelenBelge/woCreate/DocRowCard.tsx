// Belgeden terbiye iş emri — tek belge satırı: okuma izlenir, bitince form dolar (müşteri önerisi, parti adayı, metre +
// doğrulama, varsayılan gramaj). Toplu görünüm (`list`) kart + şeritler + madde listesi; tek form (`single`) şeritsiz, kartsız.
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import PickerModal, { type PickerOption } from '../../../../components/PickerModal';
import { SectionBand } from '../../../../components/form/SectionBand';
import { colors, radius, spacing, typography } from '../../../../theme';
import BatchFields from './DocRowBatchFields';
import { TERIM } from '../../../../lib/terim';
import { useReadResult } from '../useReadResult';
import { useApprovalDetail } from '../useApprovalCard';
import { usePermissions } from '../../../../hooks/usePermission';
import { fmtKursunMeters } from '../readResult';
import { batchPatch, meterChoices } from '../approvalGate';
import { detailFromSummary, pinRecent, rowIssueList, withSummaryFields } from './woFromDoc';
import type { DocRow, WoRowsState } from './useWoRows';
import { isDone } from './docRow';
import PartyRows, { useRowParties } from './PartyRows';
import RollRows from './RollRows';
import DocHeadBand, { type DocRowVariant } from './DocHeadBand';
import DocRowOwner from './DocRowOwner';
import { GramajField, MeterField, MeterSheet } from './DocRowMeasures';
import { bandTone, type IssueKey } from './woIssues';
import type { PartyPlanCtx } from './partyPlan';

export { GramajField } from './DocRowMeasures';

/** Alt çubuk hapından gelen "şu alanı aç" isteği; `seq` her basışta artar (aynı alana ikinci basış da açar). */
export interface DocRowOpenRequest {
  kind: 'owner' | 'meter';
  seq: number;
}

interface Props {
  row: DocRow;
  wo: WoRowsState;
  customers: PickerOption[];
  customersLoading: boolean;
  /** Belge masası çok partide gramajı parti başına kendi plan bölümünde çizer. */
  hideGramaj?: boolean;
  /** `list` (vars.): toplu görünüm/masa kartı; `single`: tek İE formunun sol sütunu. */
  variant?: DocRowVariant;
  /** Tek formda "Yeniden okut" (belgesiz taslakta "Belge ekle"). */
  onReread?: () => void;
  /** Belgesiz (elle) taslak: sayfa yokken okuma iletileri susar, düğme "Belge ekle". */
  manual?: boolean;
  /** "Taslağı iptal et" başarılı; verilmezse satır listeden kalkar. */
  onDraftCancelled?: () => void;
  openRequest?: DocRowOpenRequest | null;
  /** Tek formda "her parti ayrı": parti kartında gramaj + makine. */
  partyPlan?: PartyPlanCtx | null;
  /** Tek formda "Belgeyi önizle" (okutulan sayfalar tam ekran). */
  onPreview?: () => void;
}

type Picker = 'owner' | 'batch' | null;

const METER_BAND: { keys: IssueKey[]; warnKeys: IssueKey[]; done: boolean } = { keys: ['kursunMetresi', 'metreDogrula'], warnKeys: ['metreDogrula'], done: true };

export default function DocRowCard({ row, wo, customers, customersLoading, hideGramaj = false, variant = 'list', onReread, manual = false, onDraftCancelled, openRequest, partyPlan, onPreview }: Props) {
  const { read, detailFailed } = useRowRead(row, wo);
  const [picker, setPicker] = useState<Picker>(null);
  const [meterOpen, setMeterOpen] = useState(false);
  const owners = useMemo(() => pinRecent(customers, wo.recent), [customers, wo.recent]);
  useOpenRequest(openRequest, setPicker, setMeterOpen);

  const single = variant === 'single';
  const f = row.form;
  const done = row.result?.kind === 'OPENED' || row.result?.kind === 'DRAFT';
  const locked = done || wo.saving;
  // PER_PARTY kısmi başarı: belge onaylandı (künye kilitli), düşen partinin alanları + gramaj düzeltilebilir.
  const partyLocked = isDone(row) || wo.saving;
  const issueList = f && wo.mode !== 'SEPARATE' ? rowIssueList(f) : [];
  const meterText = f?.meters != null ? `${fmtKursunMeters(f.meters)} m` : null;
  const boxStyle = single ? styles.flat : [styles.box, row.result?.kind === 'OPENED' && styles.ok, row.result?.kind === 'FAILED' && styles.warn];

  return (
    <View style={boxStyle} testID={`belge-satir-${row.noteNo}`}>
      <DocHeadBand row={row} wo={wo} read={read} detailFailed={detailFailed} variant={variant} onReread={onReread} manual={manual} onDraftCancelled={onDraftCancelled} customers={customers} onPreview={onPreview} />
      {f && (
        <>
          <DocRowOwner row={row} wo={wo} read={read} customers={customers} locked={locked} single={single} onPick={() => setPicker('owner')} />
          {!single && <SectionBand title="Parti ve metre" icon="pound" tone={bandTone(issueList, METER_BAND)} testID={`belge-serit-parti-${row.noteNo}`} />}
          {f.multi ? <PartyRows row={row} wo={wo} locked={partyLocked} plan={partyPlan} /> : (
            <>
              <BatchFields row={row} wo={wo} locked={locked} onPick={() => setPicker('batch')} />
              <RollRows row={row} wo={wo} locked={locked} />
              {!f.rolls && <MeterField row={row} wo={wo} meterText={meterText} locked={locked} onEdit={() => setMeterOpen(true)} />}
            </>
          )}
          {!hideGramaj && <GramajField row={row} wo={wo} locked={partyLocked} />}
          {!single && !done && issueList.map((n) => <Text key={n.text} style={styles.note}>• {n.text}</Text>)}
        </>
      )}
      <RowResultView row={row} wo={wo} />
      <RowPickers row={row} wo={wo} picker={picker} setPicker={setPicker} owners={owners} customersLoading={customersLoading} />
      {meterOpen && row.detail && (
        <MeterSheet
          choices={meterChoices(row.detail)}
          current={meterText}
          onDismiss={() => setMeterOpen(false)}
          onSave={(m) => { setMeterOpen(false); wo.updateForm(row.noteId, { meters: m, metersReview: false }); }}
        />
      )}
    </View>
  );
}

/** Alt çubuktan gelen isteği seçiciye çevirir; ilk çizimdeki (eski) istek yeniden açılmaz. */
function useOpenRequest(req: DocRowOpenRequest | null | undefined, setPicker: (p: Picker) => void, setMeterOpen: (o: boolean) => void) {
  const seq = req?.seq ?? 0;
  const kind = req?.kind;
  const [seen, setSeen] = useState(seq);
  useEffect(() => {
    if (seq === seen) return;
    setSeen(seq);
    if (kind === 'owner') setPicker('owner');
    else if (kind === 'meter') setMeterOpen(true);
  }, [seq, seen, kind, setPicker, setMeterOpen]);
}

/**
 * Satırın okuma izlemi + form kaynağı. Okuma bitti (okunamadı / PDF / okuyucu yok dahil — sunucu yalnız süren okumayı
 * reddeder) → form dolar. Detay ucu `gelen-belge:read` ister; izin yoksa ya da düşerse form okuma özetinden kurulur.
 */
function useRowRead(row: DocRow, wo: WoRowsState) {
  const read = useReadResult(row.noteId, row.runKey);
  const readDone = read.watch?.phase === 'done';
  const summary = read.watch?.phase === 'done' ? read.watch.summary : null;
  const canReadDetail = usePermissions().has('gelen-belge:read');
  const detail = useApprovalDetail(row.noteId, readDone && canReadDetail);
  const detailFailed = canReadDetail && detail.isError;
  const { setDetail } = wo;
  useEffect(() => {
    if (detail.data) setDetail(row.noteId, withSummaryFields(detail.data, summary));
    else if (summary && (!canReadDetail || detailFailed)) setDetail(row.noteId, detailFromSummary(summary));
  }, [detail.data, summary, canReadDetail, detailFailed, row.noteId, setDetail]);
  useRowParties(row, wo, readDone && canReadDetail);
  return { read, readDone, detailFailed };
}

interface PickersProps {
  row: DocRow;
  wo: WoRowsState;
  picker: Picker;
  setPicker: (p: Picker) => void;
  owners: { pinned: PickerOption[]; rest: PickerOption[] };
  customersLoading: boolean;
}

function RowPickers({ row, wo, picker, setPicker, owners, customersLoading }: PickersProps) {
  const candidates = row.detail?.batchNoCandidates ?? [];
  return (
    <>
        <PickerModal
          visible={picker === 'owner'}
          title="Belgenin sahibi"
          options={owners.rest}
          pinnedOptions={owners.pinned}
          pinnedLabel="Son kullanılanlar"
          selectedValue={row.form?.ownerCustomerId ?? null}
          loading={customersLoading}
          onSelect={(id) => {
            setPicker(null);
            wo.updateForm(row.noteId, { ownerCustomerId: id, ownerSuggested: null });
          }}
          onDismiss={() => setPicker(null)}
          emptyText="Aktif müşteri yok."
        />
        <PickerModal
          visible={picker === 'batch'}
          title="Parti no"
          options={candidates.map((x, i) => ({ value: String(i), label: x.value, sublabel: x.label ?? x.key ?? undefined }))}
          selectedValue={String(candidates.findIndex((x) => x.value === row.form?.ourBatchNo))}
          disableSort
          onSelect={(i) => {
            setPicker(null);
            const c = candidates[Number(i)];
            if (c) {
              const p = batchPatch(c);
              wo.updateForm(row.noteId, { ourBatchNo: p.ourBatchNo ?? null, ourBatchNoKey: p.ourBatchNoKey ?? null });
            }
          }}
          onDismiss={() => setPicker(null)}
          emptyText="Belgede parti no adayı yok."
        />
    </>
  );
}

function RowResultView({ row, wo }: { row: DocRow; wo: WoRowsState }) {
  const r = row.result;
  if (!r) return null;
  if (r.kind === 'OPENED') {
    return (
      <View style={styles.result} testID={`belge-satir-sonuc-${row.noteNo}`}>
        <Text style={styles.resultTitle}>
          {r.workOrders.length > 1
            ? `${r.workOrders.length} ${TERIM.terbiyeIsEmri.tekilKucuk} açıldı: ${r.workOrders.map((w) => `${w.workOrderNo} · Parti ${w.batchNumber ?? '—'}`).join(', ')}`
            : `${TERIM.terbiyeIsEmri.tekil} açıldı: ${r.workOrderNo} · Parti ${r.batchNumber}`}
        </Text>
        {r.failed?.map((f) => <Text key={f.blockNo} style={[styles.note, styles.warnText]} testID={`belge-satir-dusen-${row.noteNo}-${f.blockNo}`}>{`${f.blockNo}. parti açılamadı — düzeltip yeniden kaydedin.`}</Text>)}
        {r.warnings?.map((w, i) => <Text key={`w${i}`} style={[styles.note, styles.warnText]} testID={`belge-satir-uyari-${row.noteNo}-${i}`}>{w}</Text>)}
        {r.print === 'PRINTED' && <Text style={styles.note}>Refakat kartı yazdırıldı.</Text>}
        {r.print !== 'PRINTED' && (
          <Button mode="outlined" icon="printer" onPress={() => wo.print(row.noteId, r.workOrderId)} contentStyle={styles.btn} testID={`belge-satir-yazdir-${row.noteNo}`}>
            {r.print === 'PRINT_FAILED' ? 'Refakat kartını yeniden yazdır' : 'Refakat kartı yazdır'}
          </Button>
        )}
      </View>
    );
  }
  return (
    <Text style={[styles.note, r.kind === 'FAILED' && styles.warnText]} testID={`belge-satir-sonuc-${row.noteNo}`}>
      {r.kind === 'FAILED' ? `Kaydedilemedi: ${r.text}` : r.text}
    </Text>
  );
}

const styles = StyleSheet.create({
  box: { padding: spacing.lg, borderRadius: radius.md, gap: spacing.sm, backgroundColor: colors.surfaceMuted },
  flat: { gap: spacing.md },
  ok: { backgroundColor: colors.successContainer },
  warn: { backgroundColor: colors.warningContainer },
  warnText: { color: colors.warningText },
  note: { fontSize: typography.size.sm, color: colors.text },
  result: { gap: spacing.sm },
  resultTitle: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: colors.text },
  btn: { minHeight: 56 },
});
