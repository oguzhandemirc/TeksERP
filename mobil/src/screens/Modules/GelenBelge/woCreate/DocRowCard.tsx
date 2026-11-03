// Belgeden terbiye iş emri — tek belge satırı: okuma izlenir, bitince form dolar (müşteri önerisi, parti adayı, metre +
// doğrulama, varsayılan gramaj). Kayıt "Hepsini kaydet"ten; sonuç satırda kalır.
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Chip, Text } from 'react-native-paper';
import ModuleSheet, { SheetField } from '../../../../components/ModuleSheet';
import NumpadInput from '../../../../components/NumpadInput';
import PickerModal, { type PickerOption } from '../../../../components/PickerModal';
import { colors, radius, spacing, typography } from '../../../../theme';
import { TERIM } from '../../../../lib/terim';
import { useReadResult } from '../useReadResult';
import { useApprovalDetail } from '../useApprovalCard';
import { usePermissions } from '../../../../hooks/usePermission';
import { readResultView, fmtKursunMeters } from '../readResult';
import { batchPatch, meterChoices, parseMeters } from '../approvalGate';
import { detailFromSummary, pinRecent, rowIssues, withSummaryFields } from './woFromDoc';
import type { DocRow, WoRowsState } from './useWoRows';
import PartyRows, { useRowParties } from './PartyRows';

interface Props {
  row: DocRow;
  wo: WoRowsState;
  customers: PickerOption[];
  customersLoading: boolean;
  /** Belge masası çok partide gramajı parti başına kendi plan bölümünde çizer. */
  hideGramaj?: boolean;
}

type Picker = 'owner' | 'batch' | null;

export default function DocRowCard({ row, wo, customers, customersLoading, hideGramaj = false }: Props) {
  const { read, readDone, detailFailed } = useRowRead(row, wo);
  const [picker, setPicker] = useState<Picker>(null);
  const [meterOpen, setMeterOpen] = useState(false);
  const owners = useMemo(() => pinRecent(customers, wo.recent), [customers, wo.recent]);

  const f = row.form;
  const done = row.result?.kind === 'OPENED' || row.result?.kind === 'DRAFT';
  const locked = done || wo.saving;
  const view = read.watch ? readResultView(read.watch, row.noteNo) : null;
  const issues = f && wo.mode !== 'SEPARATE' ? rowIssues(f) : [];
  const candidates = row.detail?.batchNoCandidates ?? [];
  const ownerName = f?.ownerCustomerId ? customers.find((o) => o.value === f.ownerCustomerId)?.label ?? f.ownerSuggested ?? 'Seçili müşteri' : '';
  const meterText = f?.meters != null ? `${fmtKursunMeters(f.meters)} m` : null;

  return (
    <View style={[styles.box, row.result?.kind === 'OPENED' && styles.ok, row.result?.kind === 'FAILED' && styles.warn]} testID={`belge-satir-${row.noteNo}`}>
      <View style={styles.head}>
        <Text style={styles.title}>{row.noteNo}</Text>
        <Text style={styles.status}>{view?.title ?? 'Okunuyor…'}</Text>
        {!f && !readDone && read.watch?.phase === 'polling' && <ActivityIndicator size="small" />}
        {!done && (
          <Button mode="text" onPress={() => wo.removeRow(row.noteId)} disabled={wo.saving} testID={`belge-satir-cikar-${row.noteNo}`}>
            Listeden çıkar
          </Button>
        )}
      </View>
      {view?.reason ? <Text style={styles.note}>{view.reason}</Text> : null}
      {detailFailed && <Text style={styles.note} testID={`belge-satir-detay-hata-${row.noteNo}`}>Belge detayı okunamadı; form okuma özetinden dolduruldu.</Text>}
      {read.watch && read.watch.phase !== 'polling' && !readDone && (
        <Button mode="outlined" icon="refresh" onPress={read.recheck} contentStyle={styles.btn}>
          Yeniden kontrol et
        </Button>
      )}
      {f && (
        <>
          <SheetField
            label="Müşteri"
            value={ownerName}
            placeholder="Müşteri seçin"
            onPress={() => setPicker('owner')}
            disabled={locked}
            hint={f.ownerSuggested && f.ownerCustomerId ? `Belgeden önerildi: ${f.ownerSuggested}` : undefined}
          />
          {f.ownerAsk && f.ownerCustomerId !== f.ownerAsk.customerId && (
            <Chip icon="help-circle-outline" onPress={() => wo.updateForm(row.noteId, { ownerCustomerId: f.ownerAsk!.customerId, ownerSuggested: f.ownerAsk!.name })}
              disabled={locked} style={styles.chip} testID={`belge-satir-sahip-sor-${row.noteNo}`}>
              {`Belgede “${f.ownerAsk.matchedText}” geçiyor — ${f.ownerAsk.name} mi? Seç`}
            </Chip>
          )}
          {f.multi ? <PartyRows row={row} wo={wo} locked={locked} /> : (
            <>
              <SheetField
                label="Parti no"
                value={f.ourBatchNo ?? ''}
                placeholder={candidates.length > 1 ? `Parti no seçin (${candidates.length} aday)` : 'Belgede parti no yok — seriden verilecek'}
                onPress={() => setPicker('batch')}
                disabled={locked || candidates.length === 0}
              />
              <MeterField row={row} wo={wo} meterText={meterText} locked={locked} onEdit={() => setMeterOpen(true)} />
            </>
          )}
          {!hideGramaj && <GramajField row={row} wo={wo} locked={locked} />}
          {!done && issues.map((n) => <Text key={n} style={styles.note}>• {n}</Text>)}
        </>
      )}
      <RowResultView row={row} wo={wo} />
      <RowPickers row={row} wo={wo} picker={picker} setPicker={setPicker} owners={owners} customersLoading={customersLoading} />
      {meterOpen && row.detail && (
        <MeterSheet
          choices={meterChoices(row.detail)}
          current={meterText}
          onDismiss={() => setMeterOpen(false)}
          onSave={(m) => {
            setMeterOpen(false);
            wo.updateForm(row.noteId, { meters: m, metersReview: false });
          }}
        />
      )}
    </View>
  );
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

function MeterField({ row, wo, meterText, locked, onEdit }: { row: DocRow; wo: WoRowsState; meterText: string | null; locked: boolean; onEdit: () => void }) {
  const f = row.form!;
  return (
    <View testID={`belge-satir-metre-${row.noteNo}`}>
      <Text style={styles.label}>Kurşun metresi</Text>
      <View style={styles.row}>
        <Text style={[styles.meters, f.metersReview && styles.warnText, !meterText && styles.muted]}>{meterText ?? 'Metre okunamadı'}</Text>
        {f.metersReview && (
          <Button mode="contained-tonal" icon="check" onPress={() => wo.updateForm(row.noteId, { metersReview: false })} disabled={locked} contentStyle={styles.btn} testID={`belge-satir-dogrula-${row.noteNo}`}>
            Doğrula
          </Button>
        )}
        <Button mode="outlined" icon="pencil" onPress={onEdit} disabled={locked} contentStyle={styles.btn} testID={`belge-satir-duzelt-${row.noteNo}`}>
          {meterText ? 'Düzelt' : 'Metre gir'}
        </Button>
      </View>
      {f.metersReview && <Text style={styles.warnText}>Metre doğrulama bekliyor: belgedeki değeri kontrol edin.</Text>}
    </View>
  );
}

/** Gramaj yalnız rotada kurşun adımı ve katalogda değer varsa çizilir; varsayılan ön seçili gelir (sözleşme 5). */
function GramajField({ row, wo, locked }: { row: DocRow; wo: WoRowsState; locked: boolean }) {
  const f = row.form!;
  if (!wo.showGramaj || wo.catalog.options.length === 0) return null;
  return (
    <View>
      <Text style={styles.label}>Kurşun gramajı</Text>
      <View style={styles.chips}>
        {wo.catalog.options.map((o) => (
          <Chip
            key={o.id}
            selected={f.gramajValueId === o.id}
            onPress={() => wo.updateForm(row.noteId, { gramajValueId: f.gramajValueId === o.id ? null : o.id })}
            disabled={locked}
            style={styles.chip}
            testID={`belge-satir-gramaj-${row.noteNo}-${o.name}`}
          >
            {o.isDefault ? `${o.name} (varsayılan)` : o.name}
          </Chip>
        ))}
      </View>
    </View>
  );
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

function MeterSheet({ choices, current, onDismiss, onSave }: { choices: ReturnType<typeof meterChoices>; current: string | null; onDismiss: () => void; onSave: (m: number) => void }) {
  const [text, setText] = useState('');
  const entered = parseMeters(text);
  return (
    <ModuleSheet
      visible
      onDismiss={onDismiss}
      title="Kurşun metresi"
      subtitle={current ? `Okunan: ${current}` : 'Belgeden okunamadı'}
      size="sm"
      footer={
        <View style={styles.actions}>
          <Button onPress={onDismiss} contentStyle={styles.btn}>
            Vazgeç
          </Button>
          <Button mode="contained" disabled={entered === null} onPress={() => entered !== null && onSave(entered)} contentStyle={styles.btn} testID="belge-satir-metre-kaydet">
            Kaydet
          </Button>
        </View>
      }
    >
      <View style={styles.chips}>
        {choices.map((m) => (
          <Chip key={m.role} onPress={() => onSave(m.value)} style={styles.chip}>
            {`${m.label}: ${m.text}`}
          </Chip>
        ))}
      </View>
      <NumpadInput value={text} onChangeText={setText} label="Metre" mode="outlined" useNativeKeyboard allowDecimal testID="belge-satir-metre-giris" />
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({
  box: { padding: spacing.lg, borderRadius: radius.md, gap: spacing.sm, backgroundColor: colors.surfaceMuted },
  ok: { backgroundColor: colors.successContainer },
  warn: { backgroundColor: colors.warningContainer },
  head: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, color: colors.text },
  status: { flex: 1, fontSize: typography.size.base, color: colors.textSecondary },
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  meters: { flex: 1, minWidth: 160, fontSize: typography.size.xl, fontWeight: typography.weight.semibold, color: colors.text },
  warnText: { color: colors.warningText },
  muted: { color: colors.textMuted },
  note: { fontSize: typography.size.sm, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 56, justifyContent: 'center' },
  result: { gap: spacing.sm },
  resultTitle: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: colors.text },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  btn: { minHeight: 56 },
});
