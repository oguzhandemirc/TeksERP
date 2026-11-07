// =============================================================================
// Hızlı İE adım ① — el terminali (donanım okuyucu) düzeni: okutulan toplar TABLO olarak
// =============================================================================
// Kamera modalı yok; ekran tuş okumasını kendisi alır. En yeni top en üstte (ScannerRollStrip ile aynı
// "son ne oldu" kuralı), mükerrer satır vurgulanır. Hata TEK yüzeyde (2026-11-07 saha: bir ret üç kez görünüyordu):
// bant görünürken başka şey yok; bant sönünce yalnız EN SON ret küçük satır olarak kalır, sonra top eklenirse o da düşer.
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
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
  /** Kilitli ürün — ilk toptan sonra tek kumaş kuralının görünür hali. */
  itemName?: string | null;
}

/** Ekranda kalan ret notu: bant (flash) varken yok; yoksa en son ret — ondan SONRA top eklendiyse o da yok. */
function useLingeringReject(rolls: number, rejects: ScanReject[], flash: ScanFlash | null): ScanReject | null {
  const [staleId, setStaleId] = useState<number | null>(null);
  const latestRef = useRef<number | null>(null);
  latestRef.current = rejects[0]?.id ?? null;
  const prevRolls = useRef(rolls);
  useEffect(() => {
    if (rolls > prevRolls.current) setStaleId(latestRef.current);
    prevRolls.current = rolls;
  }, [rolls]);
  const latest = rejects[0];
  return !flash && latest && latest.id !== staleId ? latest : null;
}

export default function HardwareRollsTable(p: Props) {
  const newestFirst = [...p.rolls].reverse();
  const lingering = useLingeringReject(p.rolls.length, p.rejects, p.flash);
  return (
    <View style={styles.root} testID="hw-rolls">
      {p.flash ? <ScanFlashCard flash={p.flash} /> : null}
      {lingering ? <RejectRow reject={lingering} onDismiss={() => p.onDismissReject(lingering.id)} /> : null}
      {p.rolls.length ? <HardwareTriggerHint label="Sıradaki topu okutun" /> : <EmptyCard />}
      {p.itemName ? (
        <View style={styles.item}>
          <Icon source="cube-outline" size={16} color={colors.brand} />
          {/* Bakım hattında TruncatedText yok: tek satır kısaltma (1.0.12 StepRolls ile aynı). */}
          <Text style={styles.itemText} numberOfLines={1}>
            {p.itemName}
          </Text>
        </View>
      ) : null}
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

function EmptyCard() {
  return (
    <View style={styles.empty} testID="hw-rolls-empty">
      <Icon source="barcode-scan" size={48} color={colors.brand} />
      <Text style={styles.emptyTitle}>Okuyucu tuşuna basıp topu okutun</Text>
      <Text style={styles.emptyHint}>
        {`Aynı üründen stok toplarını arka arkaya okutun. Tek iş emri tek kumaş içindir.`}
      </Text>
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
  item: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.xs },
  itemText: { flex: 1, color: colors.brand, fontWeight: '700', fontSize: 14 },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.brand, textAlign: 'center' },
  emptyHint: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
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
