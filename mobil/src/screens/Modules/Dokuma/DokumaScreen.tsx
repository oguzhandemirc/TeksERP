// =============================================================================
// TEZGAH EKRANI (kabuk) — bir TEZGAH, bir liste değil (DOKUMA-IS-EMRI §3.2)
// =============================================================================
// Oturum WEAVING istasyonu + makine (`SessionGate` sarar; `stationScreens.ts`).
// (1) KOŞUM (`RunPanel`) · (2) DURUŞ (`StopPanel`) · (4) TOP İNDİR ve geri almaları;
// (3) LEVENT (`BeamPanel`, Faz 3 — bayrakla). `rollBirth` KK1_* iken (4) İNDİR çizilmez (D14).
// Kuyruk YOK (online-only); çevrimdışıyken buton kilitli.
// Kalıp: ince kabuk + görünüm bileşenleri + ekran-hook + saf mantık (MOBIL.md).
// =============================================================================
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, Icon } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenChrome from '../../../components/ScreenChrome';
import { useLandscapeLock } from '../../../hooks/useLandscapeLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { colors, spacing, radius, typography } from '../../../theme';
import { useDoffEntry } from './useDoffEntry';
import DoffEntryView from './DoffEntryView';
import DoffTodayList from './DoffTodayList';
import DoffFailureModal from './DoffFailureModal';
import RunPanel from './RunPanel';
import StopPanel from './StopPanel';
import BeamPanel from './BeamPanel';
import LoomAlarmStrip from '../../../components/alarm/LoomAlarmStrip';

export default function DokumaScreen() {
  const compact = useDeviceType() === 'phone';
  useLandscapeLock(!compact);
  const insets = useSafeAreaInsets();
  const entry = useDoffEntry();

  return (
    <ScreenChrome
      title="Tezgah"
      subtitle={entry.machine ? `${entry.machine.name} · hat ${entry.lineNo}` : undefined}
      topStrip={<LoomAlarmStrip machineId={entry.machine?.id ?? null} />}
    >
      <View style={[styles.root, compact && styles.rootColumn]}>
        <View style={styles.pane}>
          <RunPanel entry={entry} />
          {entry.doffEnabled ? (
            <DoffEntryView entry={entry} />
          ) : (
            <View style={styles.info} testID="doff-kk1-info">
              <Icon source="barcode-scan" size={20} color={colors.infoDark} />
              <Text style={styles.infoText}>Toplar KK1'de etiketle doğar — bu ekranda İNDİR yok. Koşum, duruş ve levent burada.</Text>
            </View>
          )}
          {entry.result && (
            <View style={styles.resultBox}>
              <Text style={styles.resultCode}>{entry.result.code}</Text>
              <Text style={styles.resultSub}>{entry.result.subtitle}</Text>
              {entry.result.warnings.map((w) => (
                <View key={w} style={styles.amber}>
                  <Icon source="alert-outline" size={16} color={colors.warningText} />
                  <Text style={styles.amberText}>{w}</Text>
                </View>
              ))}
              <Button compact onPress={entry.dismissResult}>Kapat</Button>
            </View>
          )}
          {entry.doffEnabled && (
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom }]}>
            {!entry.isOnline && <Text style={styles.offline}>Çevrimdışı — indirme kaydedilemez (kuyruk yok)</Text>}
            <Button
              mode="contained"
              icon="package-down"
              onPress={entry.submit}
              disabled={!entry.canSubmit}
              loading={entry.submitting}
              contentStyle={styles.submitContent}
              labelStyle={styles.submitLabel}
            >
              İNDİR
            </Button>
          </View>
          )}
        </View>
        <View style={[styles.pane, styles.listPane]}>
          <StopPanel entry={entry} />
          <BeamPanel entry={entry} />
          <DoffTodayList entry={entry} />
        </View>
      </View>
      <DoffFailureModal failure={entry.failure} onDismiss={entry.dismissFailure} onResendAsNew={entry.resendAsNew} />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.appBg },
  rootColumn: { flexDirection: 'column' },
  pane: { flex: 1 },
  listPane: { borderLeftWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  bottomBar: { padding: spacing.lg, gap: spacing.sm, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  submitContent: { height: 56 },
  submitLabel: { fontSize: typography.size.lg, fontWeight: typography.weight.bold },
  offline: { color: colors.dangerText, textAlign: 'center' },
  info: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', margin: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.infoContainer },
  infoText: { flex: 1, color: colors.infoText, fontSize: typography.size.base },
  resultBox: { margin: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.successContainer, gap: spacing.xs },
  resultCode: { fontSize: 28, fontWeight: typography.weight.bold, color: colors.successText, textAlign: 'center' },
  resultSub: { color: colors.successText, textAlign: 'center' },
  amber: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', backgroundColor: colors.warningContainer, borderRadius: radius.md, padding: spacing.sm },
  amberText: { flex: 1, color: colors.warningText, fontSize: typography.size.sm },
});
