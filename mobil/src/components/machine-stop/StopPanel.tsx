// =============================================================================
// DURUŞ PANELİ — bu makinedeki açık duruş; bildir · kapat · sebep ata · geri al
// =============================================================================
// Ortak (D4-A2): Dokuma ekranı tam kartı çizer; Kurşun/Tambur aynı gövdeyi yalnız
// duruştayken BANT olarak çizer (`hideWhenRunning`), açma modalı başlık çipinden.
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import ModuleSheet, { sheet } from '../ModuleSheet';
import { LOOM_STOP_REASONS } from '../../constants/loomStopReasons';
import { colors, spacing, radius, typography } from '../../theme';
import { useStopPanel, type StopPanelState } from './useStopPanel';
import { formatElapsed } from './stopPayload';
import StopReasonModal from './StopReasonModal';
import RevokeReasonModal from '../../screens/Modules/Dokuma/RevokeReasonModal';

function reasonLabel(code: string | null): string {
  if (!code) return 'Sebep bekliyor';
  return LOOM_STOP_REASONS.find((r) => r.code === code)?.label ?? code;
}

export interface StopPanelBodyProps {
  state: StopPanelState;
  isOnline: boolean;
  canRevoke: boolean;
  /** Çalışırken başlık (Dokuma: "Tezgah çalışıyor"). */
  runningLabel?: string;
  /** true: çalışırken kart çizilmez, yalnız modallar bağlı kalır (Kurşun/Tambur bandı). */
  hideWhenRunning?: boolean;
}

export function StopPanelBody({ state, isOnline, canRevoke, runningLabel = 'Tezgah çalışıyor', hideWhenRunning = false }: StopPanelBodyProps) {
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const stop = state.openStop;
  const showCard = stop !== null || !hideWhenRunning;

  return (
    <View style={showCard ? [styles.card, stop && styles.cardStopped] : undefined} testID={hideWhenRunning && stop ? 'machine-stop-band' : undefined}>
      {showCard ? (
        <View style={styles.row}>
          <View style={styles.grow}>
            <Text style={styles.heading}>{stop ? `DURUŞTA · ${formatElapsed(stop.startedAt, state.now)}` : runningLabel}</Text>
            <Text style={styles.meta}>{stop ? reasonLabel(stop.reasonCode) : 'Duruş bildirilmedi'}</Text>
          </View>
          {stop ? (
            <>
              {stop.requiresReason ? <Button compact icon="tag-outline" onPress={() => state.classifyModal(stop.id)}>Sebep ata</Button> : null}
              <Button mode="contained-tonal" icon="play" onPress={() => state.close(stop.id)} loading={state.closing} disabled={!isOnline || state.closing}>Çalıştı</Button>
              {canRevoke ? <Button compact icon="undo" onPress={() => setRevokeId(stop.id)}>Geri al</Button> : null}
            </>
          ) : (
            <Button mode="contained" icon="pause-circle-outline" buttonColor={colors.warning} onPress={state.openModal} disabled={!isOnline || state.stopsLoading}>Duruş Bildir</Button>
          )}
        </View>
      ) : null}
      <StopReasonModal state={state} />
      <ModuleSheet
        visible={state.collision !== null}
        onDismiss={state.dismissCollision}
        dismissable={false}
        size="sm"
        title="Bu deneme başka bir duruşla çakıştı"
        footer={
          <>
            <Button onPress={state.dismissCollision}>Vazgeç</Button>
            <Button mode="contained" onPress={state.resendAsNew}>Yeni duruş olarak aç</Button>
          </>
        }
      >
        <Text style={sheet.body_}>{state.collision}</Text>
      </ModuleSheet>
      <RevokeReasonModal
        visible={revokeId !== null}
        title="Duruş geri alınsın mı?"
        hint="Damga; duruş süresi randımandan düşer. Sebep zorunlu (en az 3 karakter)."
        busy={state.revoking}
        onClose={() => setRevokeId(null)}
        onConfirm={(why) => {
          if (revokeId) state.revoke(revokeId, why);
          setRevokeId(null);
        }}
      />
    </View>
  );
}

export default function StopPanel({ machineId, isOnline, canRevoke }: { machineId: string | null; isOnline: boolean; canRevoke: boolean }) {
  const state = useStopPanel({ machineId, isOnline });
  return <StopPanelBody state={state} isOnline={isOnline} canRevoke={canRevoke} />;
}

const styles = StyleSheet.create({
  card: { margin: spacing.lg, marginBottom: 0, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  cardStopped: { borderColor: colors.warning, backgroundColor: colors.warningContainer },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 160 },
  heading: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  meta: { fontSize: typography.size.sm, color: colors.textSecondary },
});
