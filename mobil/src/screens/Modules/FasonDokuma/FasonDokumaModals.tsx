// =============================================================================
// FASON DOKUMA KABUL — "Top kabul" (satırlar) ve "Levent döndü" modalları
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, TextInput, IconButton } from 'react-native-paper';
import AppModal from '../../../components/AppModal';
import NumpadInput from '../../../components/NumpadInput';
import PickerModal from '../../../components/PickerModal';
import { colors, spacing, typography } from '../../../theme';
import { EMPTY_RECEIPT_ROW, validateReceiptRow, validateReturn, type ReceiptRowForm } from './receiptPayload';
import type { FasonDokumaState } from './useFasonDokuma';

function Row({ r, i, onChange, onRemove, removable }: { r: ReceiptRowForm; i: number; onChange: (p: Partial<ReceiptRowForm>) => void; onRemove: () => void; removable: boolean }) {
  const v = validateReceiptRow(r);
  return (
    <View style={styles.row}>
      <Text style={styles.rowNo}>{i + 1}</Text>
      <NumpadInput value={r.initialQty} onChangeText={(t) => onChange({ initialQty: t })} numpadLabel={`Satır ${i + 1} metre`} placeholder="metre *" style={styles.cell} />
      <NumpadInput value={r.width} onChangeText={(t) => onChange({ width: t })} numpadLabel="En (cm)" placeholder="en" style={styles.cell} />
      <NumpadInput value={r.weightKg} onChangeText={(t) => onChange({ weightKg: t })} numpadLabel="Kg" placeholder="kg" style={styles.cell} />
      <TextInput mode="outlined" dense value={r.qualityGrade} onChangeText={(t) => onChange({ qualityGrade: t })} placeholder="kalite" maxLength={16} style={styles.cellSmall} />
      <IconButton icon="delete-outline" onPress={onRemove} disabled={!removable} accessibilityLabel="Satırı sil" />
      {!v.ok ? <Text style={styles.err}>{v.message}</Text> : null}
    </View>
  );
}

export function ReceiveModal({ state }: { state: FasonDokumaState }) {
  const ok = state.rows.length > 0 && state.rows.every((r) => validateReceiptRow(r).ok);
  const set = (i: number, p: Partial<ReceiptRowForm>) => state.setRows(state.rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <AppModal visible={state.modal === 'receive'} onDismiss={() => state.setModal(null)} position="center" contentStyle={styles.wide}>
      <Text style={styles.title}>{state.order?.weavingOrderNumber} — dönen topları kabul et</Text>
      <Text style={styles.hint}>Her satır bir TOP olarak doğar (kumaş {state.order?.item.name}, {state.order?.color?.name ?? 'renksiz'}); ölçüm ve etiket KK1'de. Renk işin rengidir.</Text>
      {state.failedMessages.length > 0 ? (
        <View style={styles.failedBox}>
          <Text style={styles.failedTitle}>Düşen satırlar formda kaldı — doğan toplar kabul edildi (kısmi kabul):</Text>
          {state.failedMessages.map((m) => <Text key={m} style={styles.failedLine}>{m}</Text>)}
        </View>
      ) : null}
      <TextInput mode="outlined" dense label="İrsaliye no (fasoncunun)" value={state.manifestNo} onChangeText={state.setManifestNo} maxLength={64} style={styles.manifest} />
      <ScrollView style={styles.rows}>
        {state.rows.map((r, i) => (
          <Row key={i} r={r} i={i} onChange={(p) => set(i, p)} onRemove={() => state.setRows(state.rows.filter((_, k) => k !== i))} removable={state.rows.length > 1} />
        ))}
      </ScrollView>
      <View style={styles.actions}>
        <Button icon="plus" onPress={() => state.setRows([...state.rows, { ...EMPTY_RECEIPT_ROW }])} disabled={state.busy}>Satır</Button>
        <View style={styles.spacer} />
        <Button onPress={() => state.setModal(null)} disabled={state.busy}>Vazgeç</Button>
        <Button mode="contained" onPress={() => state.receive.mutate()} loading={state.receive.isPending} disabled={!ok || state.busy || !state.isOnline}>
          {state.rows.length} topu kabul et
        </Button>
      </View>
    </AppModal>
  );
}

export function ReturnModal({ state }: { state: FasonDokumaState }) {
  const beams = (state.order?.openDispatches ?? []).flatMap((d) => d.beams.map((b) => ({ ...b, dispatchId: d.dispatchId, dispatchNo: d.dispatchNo })));
  const [beamId, setBeamId] = useState<string>('');
  const [picker, setPicker] = useState(false);
  const [lengthM, setLengthM] = useState('');
  const beam = beams.find((b) => b.id === beamId) ?? null;
  const v = beam ? validateReturn(lengthM, beam.sentM) : { ok: false as const, message: 'Levent seçin' };
  return (
    <AppModal visible={state.modal === 'return'} onDismiss={() => state.setModal(null)} position="center">
      <Text style={styles.title}>{state.order?.weavingOrderNumber} — levent döndü</Text>
      <Text style={styles.hint}>Dönen metre gideni aşamaz; fark fasoncuda kalan/çekilen çözgüdür. Levent HAZIR'a döner.</Text>
      <Button mode="outlined" onPress={() => setPicker(true)} style={styles.manifest}>{beam ? `${beam.beamNo} · sevk ${beam.dispatchNo} · ${beam.sentM} m gitti` : 'Levent seç'}</Button>
      <NumpadInput value={lengthM} onChangeText={setLengthM} numpadLabel="Dönen metre" placeholder="dönen metre" style={styles.manifest} />
      {!v.ok && beam ? <Text style={styles.err}>{v.message}</Text> : null}
      <View style={styles.actions}>
        <View style={styles.spacer} />
        <Button onPress={() => state.setModal(null)} disabled={state.busy}>Vazgeç</Button>
        <Button mode="contained" loading={state.returnBeam.isPending} disabled={!v.ok || !beam || state.busy || !state.isOnline} onPress={() => beam && state.returnBeam.mutate({ dispatchId: beam.dispatchId, warpBeamId: beam.id, lengthM: Number(lengthM) })}>
          Dönüşü kaydet
        </Button>
      </View>
      <PickerModal
        visible={picker}
        title="Dönen levent"
        options={beams.map((b) => ({ value: b.id, label: b.beamNo, sublabel: `sevk ${b.dispatchNo}`, details: [`${b.sentM} m gitti`] }))}
        selectedValue={beamId}
        emptyText="Bu işte dönmemiş levent yok."
        onDismiss={() => setPicker(false)}
        onSelect={(id) => { setBeamId(id); setPicker(false); }}
      />
    </AppModal>
  );
}

const styles = StyleSheet.create({
  wide: { width: '92%', maxHeight: '90%' },
  title: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text, marginBottom: spacing.xs },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary, marginBottom: spacing.sm },
  failedBox: { backgroundColor: colors.warningContainer, padding: spacing.sm, borderRadius: 8, marginBottom: spacing.sm },
  failedTitle: { fontWeight: typography.weight.semibold, color: colors.text },
  failedLine: { color: colors.text },
  manifest: { marginBottom: spacing.sm },
  rows: { maxHeight: 360 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs, flexWrap: 'wrap' },
  rowNo: { width: 22, color: colors.textSecondary },
  cell: { flex: 1, minWidth: 90, backgroundColor: colors.surface },
  cellSmall: { width: 90, backgroundColor: colors.surface },
  err: { width: '100%', color: colors.dangerText, fontSize: typography.size.sm },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  spacer: { flex: 1 },
});
