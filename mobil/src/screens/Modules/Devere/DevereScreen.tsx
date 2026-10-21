// =============================================================================
// LEVENT SARIM EKRANI (kabuk) — devere tablet dilimi (DEVERE-LEVENT-TARAMASI §11)
// =============================================================================
// OTURUMSUZ (devere StationKind değil); makine her sarımda seçilir. Liste (planlı · Faz 3 tezgahta ·
// bugün sarılan) + üç aksiyon: plan / sar / taslak sil; iptal yetenek izniyle.
// TABLET (S3b, istasyon dili): sol SAR istasyonu formu + ana düğme; sağ okutma bandı + etiket
// kuyruğu + liste + NumpadHost. Telefon bugünkü düzen. Levent etiketi pompası ekranla yaşar.
// Kuyruk YOK (online-only); çevrimdışıyken butonlar kilitli, sebebi ayrı yazılır.
// Kalıp: ince kabuk + görünüm bileşenleri + ekran-hook + saf mantık (MOBIL.md).
// =============================================================================
import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenChrome from '../../../components/ScreenChrome';
import { useLandscapeLock } from '../../../hooks/useLandscapeLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { colors, spacing, typography } from '../../../theme';
import { useDevereScreen } from './useDevereScreen';
import BeamList from './BeamList';
import PlanModal from './PlanModal';
import WindModal from './WindModal';
import BeamActionModals from './BeamActionModals';
import MountModal from './MountModal';
import { NumpadHost } from '../../../components/NumpadProvider';
import { useWindStation } from './useWindStation';
import WindStationForm from './WindStationForm';
import WindScanColumn from './WindScanColumn';
import WarpBeamLabelPrinter from './WarpBeamLabelPrinter';

export default function DevereScreen() {
  const compact = useDeviceType() === 'phone';
  useLandscapeLock(!compact);
  const insets = useSafeAreaInsets();
  const state = useDevereScreen();
  const station = useWindStation({ context: state.context.data, planned: state.planned, recent: state.todayWound, isOnline: state.isOnline });

  const bottomBar = (
    <View style={[styles.bottomBar, { paddingBottom: compact ? insets.bottom : spacing.sm }]}>
      {!state.isOnline ? (
        <Text style={styles.offline}>{state.offlineReason === 'server' ? 'Sunucuya ulaşılamıyor — kayıt yapılamaz (kuyruk yok)' : 'Ağ bağlantısı yok — kayıt yapılamaz (kuyruk yok)'}</Text>
      ) : null}
      {state.context.isError ? <Text style={styles.offline}>Form bağlamı yüklenemedi (çözgü kartı / depo / makine) — yenileyin.</Text> : null}
      <View style={styles.buttons}>
        <Button mode="outlined" icon="refresh" onPress={state.refresh} contentStyle={styles.tall}>
          Yenile
        </Button>
        <Button mode="contained" icon="plus" onPress={state.openPlan} disabled={!state.isOnline || state.busy || !state.context.data} contentStyle={styles.tall} labelStyle={styles.primaryLabel} style={styles.grow}>
          {compact ? 'Yeni levent' : 'Yeni plan (fason/hazır)'}
        </Button>
      </View>
    </View>
  );

  return (
    <ScreenChrome title="Levent Sarım" subtitle={state.context.data ? `${state.context.data.machines.length} devere makinesi` : undefined}>
      {compact ? (
        <View style={styles.root}>
          <BeamList state={state} />
          {bottomBar}
        </View>
      ) : (
        <View style={styles.split} testID="sar-istasyon">
          <ScrollView style={styles.leftCol} contentContainerStyle={styles.leftContent} keyboardShouldPersistTaps="handled">
            <WindStationForm station={station} context={state.context.data} isOnline={state.isOnline} busyBeams={state.physicalBusyBeams} knownBeams={[...state.planned, ...state.todayWound]} />
          </ScrollView>
          <View style={styles.rightCol}>
            <WindScanColumn station={station} />
            <View style={styles.grow}>
              <BeamList state={state} />
            </View>
            {bottomBar}
            <NumpadHost style={styles.numpad} />
          </View>
        </View>
      )}
      <PlanModal state={state} />
      <WindModal state={state} />
      <BeamActionModals state={state} />
      <WarpBeamLabelPrinter />
      {state.mountTracking ? <MountModal state={state.mountForm} loomMachines={state.context.data?.loomMachines ?? []} methodRequired={state.context.data?.mountTrackingRequired === true} isOnline={state.isOnline} /> : null}
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.appBg },
  split: { flex: 1, flexDirection: 'row', backgroundColor: colors.appBg },
  leftCol: { flex: 1, borderRightWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  leftContent: { padding: spacing.lg, paddingBottom: spacing.xl },
  rightCol: { flex: 1 },
  numpad: { margin: spacing.sm },
  bottomBar: { padding: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  grow: { flex: 1 },
  tall: { height: 56 },
  primaryLabel: { fontSize: typography.size.lg, fontWeight: typography.weight.bold },
  offline: { color: colors.dangerText, textAlign: 'center' },
});
