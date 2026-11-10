// Sevk Et → özet onayı (çuval/dökme/top/metre/kg + plaka/şoför) → sonuç (irsaliye no + iki baskı düğmesi).
import React, { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import ModuleSheet from '../../../../components/ModuleSheet';
import { NoticeStrip } from '../../../../components/form';
import type { DispatchResult, HandheldLoadState } from '../../../../services/handheldShipment.service';
import { colors, radius, spacing, typography } from '../../../../theme';
import { dispatchSummary, fmtInt, fmtKg, fmtM, loadSummaryLine, resultLine } from './summary';
import { ACCENT, FilledButton, ui } from './ui';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kv}>
      <Text style={ui.secondary}>{label}</Text>
      <Text style={styles.kvValue}>{value}</Text>
    </View>
  );
}

interface ConfirmProps {
  visible: boolean;
  state: HandheldLoadState | undefined;
  busy: boolean;
  /** Sunucunun reddi (ör. "Yük değişti") sayfada kalır. */
  error: string | null;
  onCancel: () => void;
  onConfirm: (p: { plateNumber?: string; driverName?: string }) => void;
}

export function DispatchConfirmSheet({ visible, state, busy, error, onCancel, onConfirm }: ConfirmProps) {
  const [plate, setPlate] = useState('');
  const [driver, setDriver] = useState('');
  useEffect(() => {
    if (!visible) return;
    setPlate(state?.shipment.plateNumber ?? '');
    setDriver(state?.shipment.driverName ?? '');
    // Yalnız açılışta doldurulur; açıkken gelen durum yazılanı ezmez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  if (!state) return null;
  const d = dispatchSummary(state);
  return (
    <ModuleSheet
      visible={visible}
      onDismiss={onCancel}
      title="Sevk edilsin mi?"
      subtitle={state.shipment.customer.name}
      footer={
        <View style={ui.row}>
          <FilledButton label="Vazgeç" tone="neutral" onPress={onCancel} disabled={busy} style={ui.flex} />
          <FilledButton
            label="Sevk Et"
            icon="truck-check"
            loading={busy}
            onPress={() => onConfirm({ plateNumber: plate.trim() || undefined, driverName: driver.trim() || undefined })}
            style={ui.flex}
            testID="sevk-onay-gonder"
          />
        </View>
      }
    >
      <Text style={styles.load}>{loadSummaryLine(d)}</Text>
      <View style={[ui.card, styles.box]}>
        <Row label="Top" value={fmtInt(d.rollCount)} />
        <Row label="Metre" value={`${fmtM(d.meters)} m`} />
        <Row label="Kg" value={d.kg != null ? `${fmtKg(d.kg)} kg${d.kgMissing > 0 ? ` (${d.kgMissing} top kg'sız)` : ''}` : '—'} />
      </View>
      {d.emptySackNos.length > 0 ? (
        <NoticeStrip tone="warn" testID="sevk-onay-bos-cuval" text={`Boş çuval sevke girmez: ${d.emptySackNos.join(', ')}`} />
      ) : null}
      <View style={styles.inputs}>
        <TextInput value={plate} onChangeText={setPlate} placeholder="Plaka (isteğe bağlı)" placeholderTextColor={colors.textMuted} autoCapitalize="characters" style={styles.input} testID="sevk-onay-plaka" />
        <TextInput value={driver} onChangeText={setDriver} placeholder="Şoför (isteğe bağlı)" placeholderTextColor={colors.textMuted} style={styles.input} testID="sevk-onay-sofor" />
      </View>
      {error ? <NoticeStrip tone="danger" text={error} testID="sevk-onay-hata" /> : null}
    </ModuleSheet>
  );
}

interface ResultProps {
  result: DispatchResult | null;
  onClose: () => void;
  onPrintNote: () => void;
  printingNote: boolean;
  labelText: string;
  labelBusy: boolean;
  labelCount: number;
  onPrintLabels: () => void;
}

export function DispatchResultSheet(p: ResultProps) {
  const r = p.result;
  return (
    <ModuleSheet
      visible={r != null}
      onDismiss={p.onClose}
      title="Sevk edildi"
      size="sm"
      footer={<FilledButton label="Tamam" tone="neutral" onPress={p.onClose} style={ui.flex} testID="sevk-sonuc-tamam" />}
    >
      {r ? (
        <View style={styles.result}>
          <Icon source="check-circle" size={56} color={colors.success} />
          <Text style={ui.secondary}>İrsaliye no</Text>
          <Text style={styles.docNo} selectable testID="sevk-sonuc-irsaliye">
            {r.documentNo ?? r.shipmentNo}
          </Text>
          <Text style={ui.secondary}>{resultLine(r)}</Text>
          <View style={styles.actions}>
            <FilledButton label="İrsaliyeyi yazdır" icon="printer" onPress={p.onPrintNote} loading={p.printingNote} testID="sevk-sonuc-yazdir" />
            {p.labelCount > 0 ? (
              <FilledButton label={p.labelText} icon="label-multiple-outline" tone="neutral" onPress={p.onPrintLabels} loading={p.labelBusy} testID="sevk-sonuc-etiket" />
            ) : null}
          </View>
        </View>
      ) : null}
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({
  load: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: ACCENT, marginBottom: spacing.md },
  box: { padding: spacing.md, gap: spacing.sm, marginBottom: spacing.md },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  kvValue: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, color: colors.text, fontVariant: ['tabular-nums'] },
  inputs: { gap: spacing.sm, marginVertical: spacing.md },
  input: { minHeight: 52, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, paddingHorizontal: spacing.md, fontSize: typography.size.base, color: colors.text },
  result: { alignItems: 'center', gap: spacing.xs },
  docNo: { fontSize: typography.size.xxl, fontWeight: typography.weight.bold, color: colors.text, fontVariant: ['tabular-nums'], marginBottom: spacing.xs },
  actions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.md },
});
