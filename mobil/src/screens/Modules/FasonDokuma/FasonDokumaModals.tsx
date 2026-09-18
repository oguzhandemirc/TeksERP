// =============================================================================
// FASON DOKUMA KABUL — "Top kabul" SAYFALI (PagedSheet) · "Levent döndü" TEK KART (ModuleSheet)
// =============================================================================
// Top kabul: ① İrsaliye ② Top 1 … Top N (satır başına sayfa; İleri'de `validateReceiptRow` O sayfada)
// ③ Özet + Kaydet. Hücreler kırılmaz (satır bir sayfa); kalite serbest metin DEĞİL — kalite
// kataloğundan `PickerModal` (KK1 ile aynı kaynak, değer = kod, backend ≤16). Native klavye yok.
// Kısmi kabulde düşen satırlar formda kalır ve ① ile ③'te kutuda listelenir (mevcut karar).
// =============================================================================
import React, { useState } from 'react';
import { View } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import ModuleSheet, { SheetField, sheet } from '../../../components/ModuleSheet';
import PagedSheet, { SummaryRow, type SheetPage } from '../../../components/PagedSheet';
import ModalTextInput from '../../../components/ModalTextInput';
import NumpadInput from '../../../components/NumpadInput';
import PickerModal from '../../../components/PickerModal';
import { useOpenSequence } from '../../../hooks/useOpenSequence';
import { qualityGradeService } from '../../../services/qualityGrade.service';
import { EMPTY_RECEIPT_ROW, validateReceiptRow, validateReturn, type ReceiptRowForm } from './receiptPayload';
import type { FasonDokumaState } from './useFasonDokuma';

const QUALITY_NONE = 'Belirsiz';

function FailedBox({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <View style={sheet.box}>
      <Text style={sheet.warn}>Düşen satırlar formda kaldı — doğan toplar kabul edildi (kısmi kabul):</Text>
      {messages.map((m) => (
        <Text key={m} style={sheet.line}>{m}</Text>
      ))}
    </View>
  );
}

interface RowPageProps {
  row: ReceiptRowForm;
  index: number;
  count: number;
  qualityLabel: (code: string) => string;
  onChange: (p: Partial<ReceiptRowForm>) => void;
  onPickQuality: () => void;
  onAdd: () => void;
  onRemove: () => void;
}

/** Bir top = bir sayfa: metre zorunlu, en/kg isteğe bağlı, kalite katalogdan. */
function RowPage({ row, index, count, qualityLabel, onChange, onPickQuality, onAdd, onRemove }: RowPageProps) {
  return (
    <>
      <Text style={sheet.label}>Metre *</Text>
      <NumpadInput value={row.initialQty} onChangeText={(t) => onChange({ initialQty: t })} numpadLabel={`Top ${index + 1} metre`} placeholder="ör. 120" style={sheet.input} />
      <View style={sheet.row}>
        <View style={sheet.col}>
          <Text style={sheet.label}>En (cm)</Text>
          <NumpadInput value={row.width} onChangeText={(t) => onChange({ width: t })} numpadLabel="En (cm)" placeholder="—" style={sheet.input} />
        </View>
        <View style={sheet.col}>
          <Text style={sheet.label}>Kg</Text>
          <NumpadInput value={row.weightKg} onChangeText={(t) => onChange({ weightKg: t })} numpadLabel="Kg" placeholder="—" style={sheet.input} />
        </View>
      </View>
      <SheetField label="Kalite" value={row.qualityGrade ? qualityLabel(row.qualityGrade) : ''} placeholder={QUALITY_NONE} onPress={onPickQuality} />
      <View style={sheet.footerLeft}>
        <Button icon="plus" onPress={onAdd} testID="kabul-satir-ekle">Top ekle</Button>
        <Button icon="delete-outline" onPress={onRemove} disabled={count <= 1} testID="kabul-satir-sil">Bu topu sil</Button>
      </View>
    </>
  );
}

interface PagesArgs {
  state: FasonDokumaState;
  qualityLabel: (code: string) => string;
  setRow: (i: number, p: Partial<ReceiptRowForm>) => void;
  onPickQuality: (i: number) => void;
}

/** ① İrsaliye · ② Top i (satır başına sayfa, İleri'de doğrulama) · ③ Özet. */
function buildReceivePages({ state, qualityLabel, setRow, onPickQuality }: PagesArgs): SheetPage[] {
  const rows = state.rows;
  const rowPages: SheetPage[] = rows.map((r, i) => ({
    key: `top-${i}`,
    title: `Top ${i + 1}`,
    render: () => (
      <RowPage
        row={r}
        index={i}
        count={rows.length}
        qualityLabel={qualityLabel}
        onChange={(p) => setRow(i, p)}
        onPickQuality={() => onPickQuality(i)}
        onAdd={() => state.setRows([...rows.slice(0, i + 1), { ...EMPTY_RECEIPT_ROW }, ...rows.slice(i + 1)])}
        onRemove={() => state.setRows(rows.filter((_, k) => k !== i))}
      />
    ),
    validate: () => {
      const v = validateReceiptRow(r);
      return v.ok ? null : v.message;
    },
  }));
  return [
    {
      key: 'irsaliye',
      title: 'İrsaliye',
      render: () => (
        <>
          <FailedBox messages={state.failedMessages} />
          <ModalTextInput mode="outlined" dense label="İrsaliye no (fasoncunun)" value={state.manifestNo} onChangeText={state.setManifestNo} maxLength={64} style={sheet.input} testID="kabul-irsaliye" />
          <Text style={sheet.hint}>İsteğe bağlı. Her top KK1'de ölçülür ve etiketlenir; renk işin rengidir.</Text>
        </>
      ),
    },
    ...rowPages,
    {
      key: 'ozet',
      title: 'Özet',
      render: () => (
        <>
          <FailedBox messages={state.failedMessages} />
          <SummaryRow label="İrsaliye no" value={state.manifestNo} />
          <SummaryRow label="Top sayısı" value={rows.length} />
          {rows.map((r, i) => (
            <SummaryRow
              key={i}
              label={`Top ${i + 1}`}
              value={`${r.initialQty || '—'} m · en ${r.width || '—'} · ${r.weightKg || '—'} kg · ${r.qualityGrade ? qualityLabel(r.qualityGrade) : QUALITY_NONE}`}
            />
          ))}
          <Text style={sheet.hint}>Kaydedince her satır bir TOP olarak doğar; kısmi kabulde düşen satırlar formda kalır.</Text>
        </>
      ),
    },
  ];
}

export function ReceiveModal({ state }: { state: FasonDokumaState }) {
  const open = state.modal === 'receive';
  const openSeq = useOpenSequence(open);
  const [qualityRow, setQualityRow] = useState<number | null>(null);
  const grades = useQuery({ queryKey: ['quality-grades', 'active'], queryFn: () => qualityGradeService.list({ pageSize: 100 }), enabled: open, staleTime: 10 * 60_000 });
  const gradeRows = grades.data?.data ?? [];
  const qualityLabel = (code: string) => gradeRows.find((g) => g.code === code)?.name ?? code;
  const setRow = (i: number, p: Partial<ReceiptRowForm>) => state.setRows(state.rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const ok = state.rows.length > 0 && state.rows.every((r) => validateReceiptRow(r).ok);
  const o = state.order;
  return (
    <PagedSheet
      key={openSeq}
      visible={open}
      onDismiss={() => state.setModal(null)}
      onCancel={() => state.setModal(null)}
      onSubmit={() => state.receive.mutate()}
      submitLabel={`${state.rows.length} topu kabul et`}
      busy={state.receive.isPending}
      submitDisabled={!ok || state.busy || !state.isOnline}
      title={`${o?.weavingOrderNumber ?? ''} — dönen topları kabul et`}
      subtitle={`Kumaş ${o?.item.name ?? ''} · ${o?.color?.name ?? 'renksiz'} — her satır bir TOP olarak doğar`}
      pages={buildReceivePages({ state, qualityLabel, setRow, onPickQuality: setQualityRow })}
      overlays={
        <PickerModal
          visible={qualityRow !== null}
          title="Kalite"
          options={gradeRows.map((g) => ({ value: g.code, label: g.name, sublabel: g.code }))}
          selectedValue={qualityRow !== null ? (state.rows[qualityRow]?.qualityGrade ?? '') : ''}
          loading={grades.isLoading}
          emptyText="Kalite kataloğu boş — Belirsiz bırakın."
          leadingAction={{
            label: `${QUALITY_NONE} — kalite girilmedi`,
            icon: 'close-circle-outline',
            onPress: () => {
              if (qualityRow !== null) setRow(qualityRow, { qualityGrade: '' });
              setQualityRow(null);
            },
          }}
          onDismiss={() => setQualityRow(null)}
          onSelect={(code) => {
            if (qualityRow !== null) setRow(qualityRow, { qualityGrade: code });
            setQualityRow(null);
          }}
        />
      }
    />
  );
}

export function ReturnModal({ state }: { state: FasonDokumaState }) {
  const beams = (state.order?.openDispatches ?? []).flatMap((d) => d.beams.map((b) => ({ ...b, dispatchId: d.dispatchId, dispatchNo: d.dispatchNo })));
  const [beamId, setBeamId] = useState<string>('');
  const [picker, setPicker] = useState(false);
  const [lengthM, setLengthM] = useState('');
  const beam = beams.find((b) => b.id === beamId) ?? null;
  const v = beam ? validateReturn(lengthM, beam.sentM) : { ok: false as const, message: 'Levent seçin' };
  const close = () => state.setModal(null);
  return (
    <ModuleSheet
      visible={state.modal === 'return'}
      onDismiss={close}
      size="sm"
      title={`${state.order?.weavingOrderNumber ?? ''} — levent döndü`}
      subtitle="Dönen metre gideni aşamaz; fark fasoncuda kalan/çekilen çözgüdür. Levent HAZIR'a döner."
      footer={
        <>
          <Button onPress={close} disabled={state.busy}>Vazgeç</Button>
          <Button
            mode="contained"
            loading={state.returnBeam.isPending}
            disabled={!v.ok || !beam || state.busy || !state.isOnline}
            onPress={() => beam && state.returnBeam.mutate({ dispatchId: beam.dispatchId, warpBeamId: beam.id, lengthM: Number(lengthM) })}
            testID="donus-kaydet"
          >
            Dönüşü kaydet
          </Button>
        </>
      }
      overlays={
        <PickerModal
          visible={picker}
          title="Dönen levent"
          options={beams.map((b) => ({ value: b.id, label: b.beamNo, sublabel: `sevk ${b.dispatchNo}`, details: [`${b.sentM} m gitti`] }))}
          selectedValue={beamId}
          emptyText="Bu işte dönmemiş levent yok."
          onDismiss={() => setPicker(false)}
          onSelect={(id) => {
            setBeamId(id);
            setPicker(false);
          }}
        />
      }
    >
      <SheetField label="Dönen levent" value={beam ? `${beam.beamNo} · sevk ${beam.dispatchNo} · ${beam.sentM} m gitti` : ''} placeholder="Levent seç" onPress={() => setPicker(true)} />
      <Text style={sheet.label}>Dönen metre</Text>
      <NumpadInput value={lengthM} onChangeText={setLengthM} numpadLabel="Dönen metre" placeholder="ör. 180" style={sheet.input} />
      {!v.ok && beam ? <Text style={sheet.error}>{v.message}</Text> : null}
    </ModuleSheet>
  );
}
