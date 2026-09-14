// =============================================================================
// KOŞUM PANELİ — bu hattaki açık koşum; aç · kapat · geri al (yetenek izni)
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import AppModal from '../../../components/AppModal';
import ModalTextInput from '../../../components/ModalTextInput';
import { colors, spacing, radius, typography } from '../../../theme';
import type { DoffEntry } from './useDoffEntry';
import { useRunPanel } from './useRunPanel';
import RunOpenModal from './RunOpenModal';
import RunCloseModal from './RunCloseModal';

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function RevokeModal({ runId, onClose, onConfirm, busy }: { runId: string | null; onClose: () => void; onConfirm: (reason: string) => void; busy: boolean }) {
  const [reason, setReason] = useState('');
  return (
    <AppModal visible={runId !== null} onDismiss={onClose} position="center">
      <Text style={styles.title}>Koşum geri alınsın mı?</Text>
      <Text style={styles.meta}>Damga; randımanın paydasını değiştirir. Sebep zorunlu.</Text>
      <ModalTextInput label="Sebep" value={reason} onChangeText={setReason} maxLength={300} autoFocus mode="outlined" />
      <View style={styles.actions}>
        <Button onPress={onClose} disabled={busy}>Vazgeç</Button>
        <Button mode="contained" disabled={reason.trim().length === 0 || busy} loading={busy} onPress={() => onConfirm(reason.trim())}>Geri Al</Button>
      </View>
    </AppModal>
  );
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
      <RevokeModal
        runId={revokeId}
        busy={state.revoking}
        onClose={() => setRevokeId(null)}
        onConfirm={(reason) => {
          if (revokeId) state.revoke(revokeId, reason);
          setRevokeId(null);
        }}
      />
      <AppModal visible={state.collision !== null} onDismiss={state.dismissCollision} position="center" dismissable={false}>
        <Text style={styles.title}>Bu deneme başka bir koşumla çakıştı</Text>
        <Text style={styles.meta}>{state.collision?.message}</Text>
        <View style={styles.actions}>
          <Button onPress={state.dismissCollision}>Vazgeç</Button>
          <Button mode="contained" onPress={state.resendAsNew}>Yeni koşum olarak aç</Button>
        </View>
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { margin: spacing.lg, marginBottom: 0, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 160 },
  heading: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  meta: { fontSize: typography.size.sm, color: colors.textSecondary },
  title: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text, marginBottom: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
});
