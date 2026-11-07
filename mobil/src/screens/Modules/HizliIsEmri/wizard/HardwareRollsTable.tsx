// =============================================================================
// Hızlı İE adım ① — el terminali (donanım okuyucu) düzeni: okutulan toplar TABLO olarak
// =============================================================================
// Kamera modalı yok; ekran tuş okumasını kendisi alır. En yeni top en üstte (ScannerRollStrip ile aynı
// "son ne oldu" kuralı), mükerrer satır vurgulanır, retler tablonun üstünde sebebiyle durur.
// =============================================================================

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, IconButton, Text, TouchableRipple } from 'react-native-paper';

import type { ScanReject } from '../../../../hooks/useScanFeedback';
import type { ScanFlash } from '../../../../components/BarcodeScannerView';
import { ScanFlashCard } from '../../../../components/HardwareScanPanel';
import HardwareTriggerHint from '../../../../components/HardwareTriggerHint';
import { colors, radius, spacing } from '../../../../theme';
import type { ScannedRoll } from '../useQuickWorkOrder';

interface Props {
  rolls: ScannedRoll[];
  totalQty: number;
  onRemove: (barcode: string) => void;
  rejects: ScanReject[];
  onDismissReject: (id: number) => void;
  duplicateBarcode: string | null;
  flash: ScanFlash | null;
  showWidth: boolean;
}

export default function HardwareRollsTable(p: Props) {
  const newestFirst = [...p.rolls].reverse();
  return (
    <View style={styles.root} testID="hw-rolls">
      {p.flash ? <ScanFlashCard flash={p.flash} /> : null}
      {p.rejects.map((r) => (
        <RejectRow key={r.id} reject={r} onDismiss={() => p.onDismissReject(r.id)} />
      ))}
      <HardwareTriggerHint label={p.rolls.length ? 'Sıradaki topu okutun' : 'Okuyucu tuşuna basıp topu okutun'} />
      {p.rolls.length ? (
        <View style={styles.table}>
          <View style={[styles.row, styles.headRow]}>
            <Text style={[styles.cellNo, styles.head]}>#</Text>
            <Text style={[styles.cellCode, styles.head]}>Barkod</Text>
            {p.showWidth ? <Text style={[styles.cellNum, styles.head]}>En</Text> : null}
            <Text style={[styles.cellNum, styles.head]}>Metre</Text>
            <View style={styles.cellAct} />
          </View>
          {newestFirst.map((r, i) => (
            <RollRow
              key={r.id}
              roll={r}
              no={p.rolls.length - i}
              newest={i === 0}
              duplicate={r.barcode === p.duplicateBarcode}
              showWidth={p.showWidth}
              onRemove={() => p.onRemove(r.barcode)}
            />
          ))}
          <View style={[styles.row, styles.totalRow]}>
            <Text style={[styles.cellCode, styles.total]}>{`Toplam ${p.rolls.length} top`}</Text>
            <Text style={[styles.cellNum, styles.total]}>{Math.round(p.totalQty)}</Text>
            <View style={styles.cellAct} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function RollRow(p: {
  roll: ScannedRoll;
  no: number;
  newest: boolean;
  duplicate: boolean;
  showWidth: boolean;
  onRemove: () => void;
}) {
  const { roll } = p;
  return (
    <View
      style={[styles.row, p.newest && styles.newest, p.duplicate && styles.duplicate]}
      testID={`hw-roll-${roll.barcode}`}
    >
      <Text style={styles.cellNo}>{p.no}</Text>
      <View style={styles.cellCode}>
        <Text style={styles.code} numberOfLines={1}>
          {roll.barcode}
        </Text>
        {roll.status !== 'STOCK' ? <Text style={styles.rework}>yeniden üretim</Text> : null}
      </View>
      {p.showWidth ? <Text style={styles.cellNum}>{roll.width ?? '—'}</Text> : null}
      <Text style={[styles.cellNum, styles.qty]}>{Math.round(roll.qty)}</Text>
      <IconButton
        icon="close"
        size={20}
        style={styles.cellAct}
        onPress={p.onRemove}
        accessibilityLabel={`${roll.barcode} topunu çıkar`}
      />
    </View>
  );
}

function RejectRow({ reject, onDismiss }: { reject: ScanReject; onDismiss: () => void }) {
  return (
    <TouchableRipple onPress={onDismiss} style={styles.reject} accessibilityLabel="Ret notunu kapat">
      <View style={styles.rejectInner}>
        <Icon source="close-octagon" size={20} color={colors.dangerDark} />
        <View style={styles.rejectText}>
          <Text style={styles.rejectCode} numberOfLines={1}>
            {reject.barcode}
          </Text>
          <Text style={styles.rejectReason}>{reject.reason}</Text>
        </View>
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  table: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingLeft: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  headRow: { borderTopWidth: 0, minHeight: 36, backgroundColor: colors.surfaceMuted },
  head: { fontSize: 12, fontWeight: '800', color: colors.textMuted },
  newest: { backgroundColor: colors.successContainer },
  duplicate: { backgroundColor: colors.warningContainer },
  totalRow: { backgroundColor: colors.brandSoft },
  total: { fontSize: 14, fontWeight: '800', color: colors.brand },
  cellNo: { width: 28, fontSize: 12, color: colors.textMuted },
  cellCode: { flex: 1, paddingRight: spacing.xs },
  cellNum: { width: 56, textAlign: 'right', fontSize: 14, color: colors.text },
  cellAct: { width: 44, margin: 0 },
  code: { fontSize: 14, fontWeight: '700', color: colors.text, fontFamily: 'monospace' },
  qty: { fontWeight: '800' },
  rework: { fontSize: 12, color: colors.warningDark, fontWeight: '700' },
  reject: { borderRadius: radius.sm, backgroundColor: colors.dangerContainer },
  rejectInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm },
  rejectText: { flex: 1 },
  rejectCode: { fontSize: 14, fontWeight: '800', color: colors.dangerDark, fontFamily: 'monospace' },
  rejectReason: { fontSize: 12, color: colors.dangerDark },
});
