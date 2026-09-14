// =============================================================================
// LEVENT SARIM EKRANI (kabuk) — devere tablet dilimi (DEVERE-LEVENT-TARAMASI §11)
// =============================================================================
// OTURUMSUZ (devere StationKind değil); makine her sarımda seçilir. Liste (planlı · Faz 3 tezgahta ·
// bugün sarılan) + üç aksiyon: plan / sar / taslak sil; iptal yetenek izniyle.
// Kuyruk YOK (online-only); çevrimdışıyken butonlar kilitli, sebebi ayrı yazılır.
// Kalıp: ince kabuk + görünüm bileşenleri + ekran-hook + saf mantık (MOBIL.md).
// =============================================================================
import React from 'react';
import { View, StyleSheet } from 'react-native';
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

export default function DevereScreen() {
  const compact = useDeviceType() === 'phone';
  useLandscapeLock(!compact);
  const insets = useSafeAreaInsets();
  const state = useDevereScreen();

  return (
    <ScreenChrome title="Levent Sarım" subtitle={state.context.data ? `${state.context.data.machines.length} devere makinesi` : undefined}>
      <View style={styles.root}>
        <BeamList state={state} />
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom }]}>
          {!state.isOnline ? (
            <Text style={styles.offline}>{state.offlineReason === 'server' ? 'Sunucuya ulaşılamıyor — kayıt yapılamaz (kuyruk yok)' : 'Ağ bağlantısı yok — kayıt yapılamaz (kuyruk yok)'}</Text>
          ) : null}
          {state.context.isError ? <Text style={styles.offline}>Form bağlamı yüklenemedi (çözgü kartı / depo / makine) — yenileyin.</Text> : null}
          <View style={styles.buttons}>
            <Button mode="outlined" icon="refresh" onPress={state.refresh} contentStyle={styles.tall}>
              Yenile
            </Button>
            <Button mode="contained" icon="plus" onPress={state.openPlan} disabled={!state.isOnline || state.busy || !state.context.data} contentStyle={styles.tall} labelStyle={styles.primaryLabel} style={styles.grow}>
              Yeni levent
            </Button>
          </View>
        </View>
      </View>
      <PlanModal state={state} />
      <WindModal state={state} />
      <BeamActionModals state={state} />
      {state.mountTracking ? <MountModal state={state.mountForm} loomMachines={state.context.data?.loomMachines ?? []} methodRequired={state.context.data?.mountTrackingRequired === true} isOnline={state.isOnline} /> : null}
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.appBg },
  bottomBar: { padding: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  grow: { flex: 1 },
  tall: { height: 56 },
  primaryLabel: { fontSize: typography.size.lg, fontWeight: typography.weight.bold },
  offline: { color: colors.dangerText, textAlign: 'center' },
});
