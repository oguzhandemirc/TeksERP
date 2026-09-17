// =============================================================================
// SARIM İPTALİ (önizlemeli, gerekçe ≥3) · TASLAK SİL (④ sınıfı) · TOKEN ÇAKIŞMASI
// =============================================================================
// İptal önizlemesi zorunlu (§11 D3): depoya dönecek çıkış satırları depo ADIYLA, düşecek
// dip iadeleri sebep ADIYLA; buton önizleme gelmeden kilitli (panel `CancelDialog` aynası).
// İptal terminaldir — PLANNED'a dönüş yok, ekran bunu söyler.
// =============================================================================
import React, { useState } from 'react';
import { View } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import ModalTextInput from '../../../components/ModalTextInput';
import { warpBeamService } from '../../../services/warpBeam.service';
import { colors } from '../../../theme';
import DevereSheet, { sheet } from './devereSheet';
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
    <DevereSheet
      visible
      onDismiss={state.closeModal}
      size="sm"
      title={`${beam.beamNo} — sarımı iptal et`}
      subtitle="İptal geri alınamaz; levent CANCELLED kalır, yeniden sarım için yeni plan açılır."
      footer={
        <>
          <Button onPress={state.closeModal} disabled={state.busy}>Vazgeç</Button>
          <Button mode="contained" buttonColor={colors.danger} onPress={() => state.cancel(beam.id, reason.trim())} loading={state.busy} disabled={!canSubmit}>
            İptal Et
          </Button>
        </>
      }
    >
      <Text style={sheet.body_}>İplik defterine ters satır yazılır:</Text>
      {preview.isLoading ? <ActivityIndicator /> : null}
      {preview.isError ? <Text style={sheet.error}>Önizleme alınamadı — iptal kilitli.</Text> : null}
      {p ? (
        <View style={sheet.box}>
          <Text style={sheet.line}>{`Sarılan ${p.wound?.lengthM ?? '—'} m düşer`}</Text>
          {p.issueReversals.map((r, i) => (
            <Text key={`i${i}`} style={sheet.line}>{`+ ${r.qtyKg} kg → ${r.warehouse.name} (çıkış geri)`}</Text>
          ))}
          {p.returnReversals.map((r, i) => (
            <Text key={`r${i}`} style={sheet.line}>{`− ${r.qtyKg} kg ← ${r.warehouse.name} (dip iadesi ${r.reasonCode} düşer)`}</Text>
          ))}
          {p.issueReversals.length === 0 && p.returnReversals.length === 0 ? <Text style={sheet.line}>İplik satırı yok (fason/hazır levent).</Text> : null}
        </View>
      ) : null}
      <Text style={sheet.label}>Gerekçe (en az 3 karakter)</Text>
      <ModalTextInput value={reason} onChangeText={setReason} maxLength={300} placeholder="Neden iptal?" style={sheet.input} dense />
    </DevereSheet>
  );
}

function DeleteModal({ state }: { state: DevereScreenState }) {
  const beam = state.modal?.kind === 'delete' ? state.modal.beam : null;
  if (!beam) return null;
  return (
    <DevereSheet
      visible
      onDismiss={state.closeModal}
      size="sm"
      title={`${beam.beamNo} taslağını sil`}
      footer={
        <>
          <Button onPress={state.closeModal} disabled={state.busy}>Vazgeç</Button>
          <Button mode="contained" buttonColor={colors.danger} onPress={() => state.deleteDraft(beam.id)} loading={state.busy} disabled={state.busy || !state.isOnline}>
            Sil
          </Button>
        </>
      }
    >
      <Text style={sheet.body_}>Hiç olayı ve iplik satırı yok — plan silinir, numara geri gelmez. Yanlış planı düzeltmenin yolu budur.</Text>
    </DevereSheet>
  );
}

function CollisionModal({ state }: { state: DevereScreenState }) {
  return (
    <DevereSheet
      visible={state.collision !== null}
      onDismiss={state.dismissCollision}
      dismissable={false}
      size="sm"
      title="Bu deneme başka bir kayıtla çakıştı"
      footer={
        <>
          <Button onPress={state.dismissCollision}>Vazgeç</Button>
          <Button mode="contained" onPress={state.resendAsNew}>Yeni kayıt olarak gönder</Button>
        </>
      }
    >
      <Text style={sheet.body_}>{state.collision ?? ''}</Text>
    </DevereSheet>
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

