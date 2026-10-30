// =============================================================================
// MAKİNE DURUŞ ÇİPİ + BANDI — Kurşun/Tambur başlığı (D4-A2, DALGA4 §2.5/3 · §2.8)
// =============================================================================
// Makine oturumdan (`Device.machineId` → aktif oturum makinesi). Kapı: izin
// `mobile:makine-durus` ∧ üretim ∧ `uretim.makineDurusTakibi`; biri yoksa sorgu atılmaz,
// çip çizilmez. Uç 404/403 (eski backend / kapalı) → çip gizli, ekran çalışır.
// Aç/kapa/sebep Dokuma panelinin AYNI hook'u: `stopKey` = clientToken, mantıksal
// deneme başına; kuyruk yok (Dokuma ile aynı — çevrimdışı açılış reddedilir).
// =============================================================================
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import { useSessionStore } from '../../store/sessionStore';
import { usePermissions } from '../../hooks/usePermission';
import { useMachineStopTrackingEnabled } from '../../hooks/useFeatureFlags';
import { useIsOnline } from '../../offline/hooks';
import { StopPanelBody } from './StopPanel';
import { formatElapsed } from './stopPayload';
import { useStopPanel, type StopPanelState } from './useStopPanel';

export const MACHINE_STOP_PERMISSION = 'mobile:makine-durus';

export interface MachineStopControl {
  /** Çip çizilsin mi (izin ∧ ayar ∧ makine ∧ uç erişilebilir). */
  visible: boolean;
  /** Açık duruş var mı — gramaj dokunuşu UYARIR, göndermeyi kesmez (K2). */
  stopOpen: boolean;
  state: StopPanelState;
  isOnline: boolean;
}

export function useMachineStopControl(): MachineStopControl {
  const machineId = useSessionStore((s) => s.active?.machine?.id ?? null);
  const allowed = usePermissions().has(MACHINE_STOP_PERMISSION);
  const tracking = useMachineStopTrackingEnabled();
  const isOnline = useIsOnline();
  const enabled = allowed && tracking && machineId !== null;
  const state = useStopPanel({ machineId, isOnline, enabled, hideOnUnavailable: true });
  const visible = enabled && !state.unavailable;
  return { visible, stopOpen: visible && state.openStop !== null, state, isOnline };
}

/** Başlık çipi: çalışırken "Duruş" → açma modalı; duruştayken süre; sebep borcu varsa sebep modalı. */
export function MachineStopChip({ control }: { control: MachineStopControl }) {
  if (!control.visible) return null;
  const { state } = control;
  const stop = state.openStop;
  const label = stop ? `Duruşta · ${formatElapsed(stop.startedAt, state.now)}` : 'Duruş';
  const onPress = () => {
    if (!stop) state.openModal();
    else if (stop.requiresReason) state.classifyModal(stop.id);
  };
  return (
    <TouchableRipple
      onPress={onPress}
      disabled={!stop && (!control.isOnline || state.stopsLoading)}
      style={[styles.chip, stop && styles.chipStopped]}
      borderless
      rippleColor="rgba(255,255,255,0.2)"
      accessibilityLabel={stop ? 'Makine duruşta' : 'Duruş bildir'}
      testID="machine-stop-chip"
    >
      <View style={styles.inner}>
        <Icon source={stop ? 'pause-circle' : 'pause-circle-outline'} size={18} color="#fff" />
        <Text style={styles.text} numberOfLines={1}>{label}</Text>
      </View>
    </TouchableRipple>
  );
}

/** Açık duruş bandı (içerik üstü): süre + sebep + "Çalıştı"; çalışırken yalnız modallar bağlı. Geri alma tablette yok. */
export function MachineStopBand({ control }: { control: MachineStopControl }) {
  if (!control.visible) return null;
  return <StopPanelBody state={control.state} isOnline={control.isOnline} canRevoke={false} runningLabel="Makine çalışıyor" hideWhenRunning />;
}

const styles = StyleSheet.create({
  chip: { borderRadius: 999, minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.12)' },
  chipStopped: { backgroundColor: '#b45309' },
  inner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
