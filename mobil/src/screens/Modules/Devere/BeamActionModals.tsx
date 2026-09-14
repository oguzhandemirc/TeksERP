// =============================================================================
// SARIM İPTALİ (önizlemeli, gerekçe ≥3) · TASLAK SİL (④ sınıfı) · TOKEN ÇAKIŞMASI
// =============================================================================
// İptal önizlemesi zorunlu (§11 D3): depoya dönecek çıkış satırları depo ADIYLA, düşecek
// dip iadeleri sebep ADIYLA; buton önizleme gelmeden kilitli (panel `CancelDialog` aynası).
// İptal terminaldir — PLANNED'a dönüş yok, ekran bunu söyler.
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import AppModal from '../../../components/AppModal';
import ModalTextInput from '../../../components/ModalTextInput';
import { warpBeamService } from '../../../services/warpBeam.service';
import { colors, spacing, radius, typography } from '../../../theme';
import type { DevereScreenState } from './useDevereScreen';

export const CANCEL_REASON_MIN = 3;

function CancelModal({ state }: { state: DevereScreenState }) {
  const beam = state.modal?.kind === 'cancel' ? state.modal.beam : null;
  const [reason, setReason] = useState('');
  const preview = useQuery({
    queryKey: ['warp-beams', 'cancel-preview', beam?.id ?? ''],
    queryFn: () => warpBeamService.cancelPreview(beam!.id),
    enabled: beam != null,
    staleTime: 0,
  });
  if (!beam) return null;
  const p = preview.data;
  const canSubmit = !!p && reason.trim().length >= CANCEL_REASON_MIN && !state.busy && state.isOnline;
  return (
    <AppModal visible onDismiss={state.closeModal} position="center">
      <Text style={styles.title}>{`${beam.beamNo} — sarımı iptal et`}</Text>
      <Text style={styles.body}>İptal geri alınamaz; levent CANCELLED kalır, yeniden sarım için yeni plan açılır. İplik defterine ters satır yazılır:</Text>
      {preview.isLoading ? <ActivityIndicator /> : null}
      {preview.isError ? <Text style={styles.error}>Önizleme alınamadı — iptal kilitli.</Text> : null}
      {p ? (
        <View style={styles.box}>
          <Text style={styles.line}>{`Sarılan ${p.wound?.lengthM ?? '—'} m düşer`}</Text>
          {p.issueReversals.map((r, i) => (
            <Text key={`i${i}`} style={styles.line}>{`+ ${r.qtyKg} kg → ${r.warehouse.name} (çıkış geri)`}</Text>
          ))}
          {p.returnReversals.map((r, i) => (
            <Text key={`r${i}`} style={styles.line}>{`− ${r.qtyKg} kg ← ${r.warehouse.name} (dip iadesi ${r.reasonCode} düşer)`}</Text>
          ))}
          {p.issueReversals.length === 0 && p.returnReversals.length === 0 ? <Text style={styles.line}>İplik satırı yok (fason/hazır levent).</Text> : null}
        </View>
      ) : null}
      <Text style={styles.label}>Gerekçe (en az 3 karakter)</Text>
      <ModalTextInput value={reason} onChangeText={setReason} maxLength={300} placeholder="Neden iptal?" style={styles.input} dense />
      <View style={styles.actions}>
        <Button onPress={state.closeModal} disabled={state.busy}>Vazgeç</Button>
        <Button mode="contained" buttonColor={colors.danger} onPress={() => state.cancel(beam.id, reason.trim())} loading={state.busy} disabled={!canSubmit}>
          İptal Et
        </Button>
      </View>
    </AppModal>
  );
}

function DeleteModal({ state }: { state: DevereScreenState }) {
  const beam = state.modal?.kind === 'delete' ? state.modal.beam : null;
  if (!beam) return null;
  return (
    <AppModal visible onDismiss={state.closeModal} position="center">
      <Text style={styles.title}>{`${beam.beamNo} taslağını sil`}</Text>
      <Text style={styles.body}>Hiç olayı ve iplik satırı yok — plan silinir, numara geri gelmez. Yanlış planı düzeltmenin yolu budur.</Text>
      <View style={styles.actions}>
        <Button onPress={state.closeModal} disabled={state.busy}>Vazgeç</Button>
        <Button mode="contained" buttonColor={colors.danger} onPress={() => state.deleteDraft(beam.id)} loading={state.busy} disabled={state.busy || !state.isOnline}>
          Sil
        </Button>
      </View>
    </AppModal>
  );
}

function CollisionModal({ state }: { state: DevereScreenState }) {
  return (
    <AppModal visible={state.collision !== null} onDismiss={state.dismissCollision} position="center" dismissable={false}>
      <Text style={styles.title}>Bu deneme başka bir kayıtla çakıştı</Text>
      <Text style={styles.body}>{state.collision ?? ''}</Text>
      <View style={styles.actions}>
        <Button onPress={state.dismissCollision}>Vazgeç</Button>
        <Button mode="contained" onPress={state.resendAsNew}>Yeni kayıt olarak gönder</Button>
      </View>
    </AppModal>
  );
}

export default function BeamActionModals({ state }: { state: DevereScreenState }) {
  return (
    <>
      {state.modal?.kind === 'cancel' ? <CancelModal state={state} /> : null}
      {state.modal?.kind === 'delete' ? <DeleteModal state={state} /> : null}
      <CollisionModal state={state} />
    </>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text, marginBottom: spacing.sm },
  body: { fontSize: typography.size.sm, color: colors.textSecondary, marginBottom: spacing.sm },
  box: { borderRadius: radius.md, backgroundColor: colors.surfaceMuted, padding: spacing.md, gap: spacing.xs },
  line: { fontSize: typography.size.sm, color: colors.text },
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold, marginTop: spacing.sm },
  input: { backgroundColor: colors.surface },
  error: { color: colors.dangerText },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
});
