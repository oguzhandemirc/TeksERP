// =============================================================================
// SAR İSTASYONU — sağ sütun üstü: okutma bandı (levent no / gövde no) + basılmayan levent etiketleri
// =============================================================================
// Tek kod okutan yüzey → kamera `trigger="auto"` (çok top okutan değil). Sonuç sesi/titreşimi
// `signalScan` (hook'ta). Etiketi çıkmayan levent SİLİNMEZ: satırda "Tekrar bas" / "Kaldır".
// =============================================================================
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { colors, radius, spacing, typography } from '../../../theme';
import { useBeamLabelQueue } from './beamLabelQueue';
import type { WindStationState } from './useWindStation';

function LabelFailures() {
  const jobs = useBeamLabelQueue((s) => s.jobs);
  const failed = jobs.filter((j) => j.error);
  const pending = jobs.length - failed.length;
  if (jobs.length === 0) return null;
  return (
    <View style={styles.labels} testID="levent-etiket-kuyrugu">
      {pending > 0 ? <Text style={styles.pending}>{`Etiket kuyrukta: ${pending}`}</Text> : null}
      {failed.map((j) => (
        <View key={j.beamId} style={styles.failRow}>
          <View style={styles.grow}>
            <Text style={styles.failNo}>{`${j.beamNo} — etiketi çıkmadı`}</Text>
            <Text style={styles.failWhy}>{j.error}</Text>
          </View>
          <Button compact mode="contained-tonal" icon="printer" onPress={() => useBeamLabelQueue.getState().enqueue(j.beamId, j.beamNo)}>
            Tekrar bas
          </Button>
          <Button compact mode="text" onPress={() => useBeamLabelQueue.getState().remove(j.beamId)}>
            Kaldır
          </Button>
        </View>
      ))}
    </View>
  );
}

export default function WindScanColumn({ station }: { station: WindStationState }) {
  const [camera, setCamera] = useState(false);
  return (
    <View style={styles.root}>
      <ScannerEntryBar
        value={station.scanValue}
        onChangeText={station.setScanValue}
        placeholder="Levent no ya da gövde no okut/yaz…"
        onResolve={() => station.submitScan(station.scanValue)}
        onScan={() => setCamera(true)}
        scanCtaLabel="Levent / gövde okut"
        tone="blue"
      />
      {station.scanMessage ? <Text style={styles.scanMessage}>{station.scanMessage}</Text> : null}
      <LabelFailures />
      <BarcodeScannerModal
        visible={camera}
        title="Levent no ya da gövde no okut"
        trigger="auto"
        onDismiss={() => setCamera(false)}
        onScan={(code) => {
          setCamera(false);
          station.submitScan(code);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  scanMessage: { color: colors.dangerText, fontSize: typography.size.sm },
  labels: { gap: spacing.xs, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.warningContainer },
  pending: { fontSize: typography.size.sm, color: colors.warningText },
  failRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  failNo: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.text },
  failWhy: { fontSize: typography.size.sm, color: colors.dangerText },
});
