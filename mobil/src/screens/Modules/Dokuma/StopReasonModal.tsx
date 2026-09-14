// =============================================================================
// DURUŞ SEBEBİ MODALİ — açılışta isteğe bağlı (borç doğar), sebep atamada zorunlu
// =============================================================================
// Sunum `ReasonPresetPicker`: serbest metin ÜSTTE, chip'ler altında (2026-08-19 kararı).
// Sunucusuzken gömülü zemin (`constants/loomStopReasons.ts`) — ekran kilitlenmez.
// =============================================================================
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import AppModal from '../../../components/AppModal';
import ReasonPresetPicker from '../../../components/reasonPresets/ReasonPresetPicker';
import { colors, spacing, typography } from '../../../theme';
import { REASON_NOTE_MAX } from './stopPayload';
import type { StopPanelState } from './useStopPanel';

export default function StopReasonModal({ state }: { state: StopPanelState }) {
  const classify = state.modal?.mode === 'classify';
  return (
    <AppModal visible={state.modal !== null} onDismiss={state.closeModal} position="center">
      <Text style={styles.title}>{classify ? 'Duruşa sebep ata' : 'Duruş bildir'}</Text>
      <Text style={styles.body}>
        {classify
          ? 'Kayıp sınıfı sebepten gelir; karar defterine yazılır, sonradan yalnız yeniden sınıflandırma ile değişir.'
          : 'Sebep şimdi verilmezse duruş yine açılır; sınıflandırma borcu doğar ve panelde "sebep ata" görünür.'}
      </Text>
      <ReasonPresetPicker kind="MACHINE_STOP" value={state.reason} onChange={state.setReason} optional={!classify} placeholder="Not (isteğe bağlı) — ya da aşağıdan seç" maxLength={REASON_NOTE_MAX} />
      <View style={styles.actions}>
        <Button onPress={state.closeModal} disabled={state.submitting}>Vazgeç</Button>
        <Button mode="contained" onPress={state.submit} loading={state.submitting} disabled={state.submitting}>
          {classify ? 'Sebebi Kaydet' : 'Duruşu Aç'}
        </Button>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text, marginBottom: spacing.sm },
  body: { fontSize: typography.size.sm, color: colors.textSecondary, marginBottom: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
});
