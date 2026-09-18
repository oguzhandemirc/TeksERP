// =============================================================================
// KOŞUM PANELİ — bu hattaki açık koşum; aç · kapat · geri al (yetenek izni)
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import { colors, spacing, radius, typography } from '../../../theme';
import type { DoffEntry } from './useDoffEntry';
import { useRunPanel } from './useRunPanel';
import RunOpenModal from './RunOpenModal';
import RunCloseModal from './RunCloseModal';
import RevokeReasonModal from './RevokeReasonModal';

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

export default function RunPanel({ entry }: { entry: DoffEntry }) {
  const machineId = entry.machine?.id ?? null;
  const state = useRunPanel({ machineId, lineNo: entry.lineNo, isOnline: entry.isOnline });
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const run = entry.openRuns[0] ?? null;

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.grow}>
          <Text style={styles.heading}>{run ? `Koşum açık · ${fmtTime(run.startedAt)}` : 'Bu hatta açık koşum yok'}</Text>
          <Text style={styles.meta}>{run ? (run.weavingOrderId ? 'İş emrine bağlı' : 'İş emrisiz (numune) — indirmeler metreye girmez') : 'Koşum açmadan indirme kaydedilebilir; metreye girmez.'}</Text>
        </View>
        {run ? (
          <Button mode="contained-tonal" icon="stop-circle-outline" onPress={() => state.setCloseTarget(run.id)} disabled={!entry.isOnline}>Kapat</Button>
        ) : (
          <Button mode="contained" icon="play-circle-outline" onPress={() => state.setOpenModal(true)} disabled={!entry.isOnline || entry.runsLoading}>Koşum Aç</Button>
        )}
        {run && entry.canRevoke ? <Button compact icon="undo" onPress={() => setRevokeId(run.id)}>Geri al</Button> : null}
      </View>
      <RunOpenModal state={state} />
      <RunCloseModal state={state} />
      <RevokeReasonModal
        visible={revokeId !== null}
        title="Koşum geri alınsın mı?"
        hint="Damga; randımanın paydasını değiştirir. Sebep zorunlu (en az 3 karakter)."
        busy={state.revoking}
        onClose={() => setRevokeId(null)}
        onConfirm={(reason) => {
          if (revokeId) state.revoke(revokeId, reason);
          setRevokeId(null);
        }}
      />
      <ModuleSheet
        visible={state.collision !== null}
        onDismiss={state.dismissCollision}
        dismissable={false}
        size="sm"
        title="Bu deneme başka bir koşumla çakıştı"
        footer={
          <>
            <Button onPress={state.dismissCollision}>Vazgeç</Button>
            <Button mode="contained" onPress={state.resendAsNew}>Yeni koşum olarak aç</Button>
          </>
        }
      >
        <Text style={sheet.body_}>{state.collision?.message}</Text>
      </ModuleSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { margin: spacing.lg, marginBottom: 0, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 160 },
  heading: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  meta: { fontSize: typography.size.sm, color: colors.textSecondary },
});
