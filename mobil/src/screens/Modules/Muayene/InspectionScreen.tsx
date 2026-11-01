// =============================================================================
// MUAYENE — istasyondan bağımsız 4 puan muayene ekranı (K4P-EKRAN, plan §4.1 konak b / §5.1)
// =============================================================================
// Top okutulur → aynı `InspectionPanel` tam ekran → KAYDET (`POST /quality-inspections` + clientToken).
// Oturumsuz; istasyon türüne bağlanmaz (istasyon→ekran haritasına girmez). Çevrimdışı kuyruk yok.
// =============================================================================
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenChrome from '../../../components/ScreenChrome';
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import InspectionPanel from '../../../components/inspection/InspectionPanel';
import InspectionRecentList from '../../../components/inspection/InspectionRecentList';
import { useLandscapeLock } from '../../../hooks/useLandscapeLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { palette } from '../../../theme/tokens';
import { OFFLINE_TEXT, saveBlockReason } from './standaloneInspectionHost';
import { useStandaloneInspection, type StandaloneInspection } from './useStandaloneInspection';
import { ActiveInspectionBanner, RollStrip, ScanEmptyState } from './InspectionRollStrip';
import { CustomerCodeMatchNote } from '../../../components/customerCode/CustomerCodeMatchNote';
import { scanMatchOf } from '../../../components/customerCode/customerCodeLogic';

function confirmClear(count: number, onYes: () => void) {
  Alert.alert('Muayene taslağı silinsin mi?', `${count} hata kaydı silinecek.`, [
    { text: 'Vazgeç', style: 'cancel' },
    { text: 'Sil', style: 'destructive', onPress: onYes },
  ]);
}

function SaveBar({ s, bottom }: { s: StandaloneInspection; bottom: number }) {
  const blocked = saveBlockReason({ rollId: s.roll?.id ?? null, isOnline: s.isOnline, active: s.active, busy: s.saving });
  const n = s.draft.defects.length;
  return (
    <View style={[styles.bar, { paddingBottom: bottom + 8 }]}>
      {!s.isOnline ? <Text style={styles.offline} testID="inspection-screen-offline">{OFFLINE_TEXT}</Text> : null}
      {s.saveError ? <Text style={styles.error} testID="inspection-save-error">{s.saveError}</Text> : null}
      <View style={styles.buttons}>
        {n > 0 ? (
          <Button mode="outlined" icon="delete-sweep" onPress={() => confirmClear(n, () => s.dispatch({ type: 'clear' }))} contentStyle={styles.tall} labelStyle={styles.clearLabel} style={styles.clear} testID="inspection-clear">
            TASLAĞI SİL
          </Button>
        ) : null}
        <Button mode="contained" icon="content-save-check" onPress={s.save} disabled={blocked !== null} loading={s.saving} contentStyle={styles.tall} labelStyle={styles.saveLabel} style={styles.grow} testID="inspection-save">
          {n > 0 ? `KAYDET · ${n} hata` : 'KAYDET · hata yok'}
        </Button>
      </View>
    </View>
  );
}

function Body({ s, compact }: { s: StandaloneInspection; compact: boolean }) {
  if (!s.roll) return <ScanEmptyState compact={compact} />;
  return (
    <>
      <RollStrip roll={s.roll} status={s.status} phase={s.status?.phase} onChange={s.reset} />
      {s.active ? (
        <ActiveInspectionBanner active={s.active} />
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <InspectionPanel
            defectTypes={s.defectTypes}
            ownDefects={s.ownDefects}
            meterInput={s.meterInput}
            onMeterChange={s.setMeterInput}
            sizeClassMode
            meterOptional
            meterAutoActivate={false}
            compact={compact}
            maxMeter={Number(s.roll.currentQty) || undefined}
            summary={s.summary}
            rulerEmptyText={s.draft.defects.length > 0 ? 'Metreli hata yok — kayıtlar aşağıda' : 'Hata yok — temiz top da KAYDET ile yazılır'}
            onDefect={s.onDefect}
            onDelete={(id) => s.dispatch({ type: 'remove', id })}
          >
            <InspectionRecentList entries={s.draft.defects} defectTypes={s.defectTypes} onUndo={() => s.dispatch({ type: 'undoLast' })} />
          </InspectionPanel>
        </ScrollView>
      )}
    </>
  );
}

export default function InspectionScreen() {
  const compact = useDeviceType() === 'phone';
  useLandscapeLock(!compact);
  const insets = useSafeAreaInsets();
  const s = useStandaloneInspection();
  const [camera, setCamera] = useState(false);
  return (
    <ScreenChrome title="Muayene" subtitle="4 puan · top okut">
      <View style={styles.root}>
        <View style={styles.scan}>
          <ScannerEntryBar
            value={s.barcode}
            onChangeText={s.setBarcode}
            placeholder="Top barkodu"
            onResolve={() => void s.scan(s.barcode)}
            resolving={s.scanBusy}
            onScan={() => setCamera(true)}
            scanCtaLabel="Top okut"
            tone="indigo"
          />
          {s.scanError ? <Text style={styles.error} testID="inspection-scan-error">{s.scanError}</Text> : null}
          <CustomerCodeMatchNote match={scanMatchOf(s.roll)} />
        </View>
        <View style={styles.flex}>
          <Body s={s} compact={compact} />
        </View>
        {s.roll ? <SaveBar s={s} bottom={insets.bottom} /> : null}
      </View>
      <BarcodeScannerModal
        visible={camera}
        title="Muayene edilecek topu okut"
        trigger="auto"
        onDismiss={() => setCamera(false)}
        onScan={(code) => {
          setCamera(false);
          void s.scan(code);
        }}
      />
      {s.ambiguousModal}
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.slate[50] },
  scan: { paddingHorizontal: 12, paddingTop: 8, gap: 4 },
  flex: { flex: 1 },
  body: { gap: 10, paddingVertical: 10 },
  bar: { paddingHorizontal: 12, paddingTop: 8, gap: 6, backgroundColor: palette.white, borderTopWidth: 1, borderTopColor: palette.slate[200] },
  buttons: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1 },
  tall: { minHeight: 64 },
  saveLabel: { fontSize: 20, fontWeight: '900' },
  clear: { borderColor: palette.red[600], borderWidth: 2 },
  clearLabel: { fontSize: 18, fontWeight: '900', color: palette.red[700] },
  offline: { fontSize: 17, fontWeight: '800', color: palette.white, backgroundColor: palette.slate[700], padding: 10, borderRadius: 6 },
  error: { fontSize: 17, fontWeight: '800', color: palette.red[700] },
});
