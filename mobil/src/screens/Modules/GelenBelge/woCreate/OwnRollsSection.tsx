// "Kendi üretim" kipinde sol sütun: isteğe bağlı "Toplar" — ham stoktaki topları okut ya da listeden seç; kayıtta İE'ye
// bağlanır ve ilk istasyona gider. Top okutmadan da oluşturulur (toplar sonra İE detayında "Parti Ekle" ile).
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';
import { BarcodeScannerModal } from '../../../../components/BarcodeScannerModal';
import ScannerRollStrip from '../../../../components/ScannerRollStrip';
import RollPickerModal from '../../../../components/RollPickerModal';
import HardwareTriggerHint from '../../../../components/HardwareTriggerHint';
import { ScanFlashCard } from '../../../../components/HardwareScanPanel';
import { CustomerCodeMatchNote } from '../../../../components/customerCode/CustomerCodeMatchNote';
import { useHardwareScanMode } from '../../../../hooks/useScanMethod';
import { colors, radius, spacing, typography } from '../../../../theme';
import type { OwnGoodsCreate } from './useOwnGoodsCreate';

interface Props {
  own: OwnGoodsCreate;
  /** Hedef kumaş seçildiyse liste o kumaşla süzülür (okutmada farklı kumaş reddedilir). */
  itemId: string | null;
  locked: boolean;
}

const fmtM = (n: number): string => Math.round(n).toLocaleString('tr-TR');

export default function OwnRollsSection({ own, itemId, locked }: Props) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const hardware = useHardwareScanMode() && !locked;
  const itemFilter: Record<string, string> = itemId ? { itemId } : {};
  const filters = { rollScope: 'RAW_STOCK', rollKind: 'WOUND_ROLL', mulkiyet: 'OWN', ...itemFilter };

  if (own.result) {
    return (
      <View style={styles.result} testID="ie-kendi-sonuc">
        <Text style={styles.resultText}>{own.result.text}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card} testID="ie-kendi-toplar">
      <Text style={styles.title}>Toplar (isteğe bağlı)</Text>
      <Text style={styles.help}>Ham stoktaki topları okutun; {`İE'ye`} bağlanır ve ilk istasyona gider. Top okutmadan da oluşturabilirsiniz — toplar sonra {`İE detayında "Parti Ekle"`} ile okutulur.</Text>
      <View style={styles.row}>
        {hardware ? (
          <HardwareTriggerHint label="Tuşla okut" style={styles.grow} />
        ) : (
          <Button mode="contained-tonal" icon="barcode-scan" onPress={() => setScannerOpen(true)} disabled={locked} contentStyle={styles.btn} style={styles.grow} testID="ie-kendi-top-okut">
            Top okut
          </Button>
        )}
        <Button mode="outlined" icon="format-list-checkbox" onPress={() => setPickerOpen(true)} disabled={locked} contentStyle={styles.btn} style={styles.grow} testID="ie-kendi-listeden">
          Listeden seç
        </Button>
      </View>
      {hardware && own.feedback.flash ? <ScanFlashCard flash={own.feedback.flash} /> : null}
      {own.feedback.rejects.map((r) => (
        <Text key={r.barcode} style={styles.reject} testID={`ie-kendi-ret-${r.barcode}`}>{`${r.barcode} — ${r.reason}`}</Text>
      ))}
      {own.rolls.length === 0 ? (
        <Text style={styles.empty} testID="ie-kendi-topsuz">Top yok — {`İE`} topsuz oluşturulur.</Text>
      ) : (
        <>
          {own.rolls.map((r) => (
            <View key={r.id} style={styles.rollRow}>
              <View style={styles.grow}>
                <Text style={styles.rollText}>{`${r.barcode} · ${fmtM(r.qty)} m`}</Text>
                <CustomerCodeMatchNote match={r.customerMatch} />
              </View>
              <IconButton icon="close" size={24} style={styles.remove} onPress={() => own.remove(r.barcode)} disabled={locked} accessibilityLabel={`${r.barcode} çıkar`} />
            </View>
          ))}
          <Text style={styles.total} testID="ie-kendi-toplam">{`${own.rolls.length} top · ${fmtM(own.totalQty)} m`}</Text>
        </>
      )}
      <BarcodeScannerModal
        visible={scannerOpen} listenWhileHidden onDismiss={() => setScannerOpen(false)} onScan={(b) => void own.onScan(b)}
        title="Ham Stok Topu Okut" continuous trigger="tap" captureHaptic={false} barcodeTypes={['qr', 'code128']} flash={own.feedback.flash}
        footer={<ScannerRollStrip rolls={own.rolls} totalQty={own.totalQty} onRemove={own.remove} rejects={own.feedback.rejects} onDismissReject={own.feedback.dismissReject} duplicateBarcode={own.feedback.duplicateBarcode} />}
      />
      {own.ambiguousModal}
      <RollPickerModal
        visible={pickerOpen} onDismiss={() => setPickerOpen(false)} multiSelect confirmLabel="Ekle"
        onConfirm={(picked) => { own.take(picked); setPickerOpen(false); }}
        filters={filters} excludeIds={own.rolls.map((r) => r.id)} title="Ham Stoktan Top Seç" subtitle="Yalnız bizim stok (emanet hariç)" emptyText="Ham stokta uygun top yok"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  title: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text },
  help: { fontSize: typography.size.sm, color: colors.textSecondary },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  grow: { flexGrow: 1, flexShrink: 1, minWidth: 140 },
  btn: { minHeight: 56 },
  reject: { fontSize: typography.size.sm, color: colors.dangerText },
  empty: { fontSize: typography.size.base, color: colors.textSecondary },
  rollRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  rollText: { fontSize: typography.size.base, color: colors.text },
  remove: { width: 56, height: 56, margin: 0 },
  total: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  result: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.successContainer, borderWidth: 1, borderColor: colors.success },
  resultText: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: colors.successText },
});
