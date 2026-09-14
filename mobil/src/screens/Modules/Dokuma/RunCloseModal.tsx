// =============================================================================
// KOŞUMU KAPAT — atkı sayacı (opsiyonel; boş = ölçülmedi, 0 DEĞİL)
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import AppModal from '../../../components/AppModal';
import NumpadInput from '../../../components/NumpadInput';
import { colors, spacing, typography } from '../../../theme';
import type { RunPanelState } from './useRunPanel';

export default function RunCloseModal({ state }: { state: RunPanelState }) {
  const [picks, setPicks] = useState('');
  const close = () => {
    state.setCloseTarget(null);
    setPicks('');
  };
  return (
    <AppModal visible={state.closeTarget !== null} onDismiss={close} position="center">
      <Text style={styles.title}>Koşumu kapat</Text>
      <Text style={styles.body}>Kapanış terimleri donar. Üretilen metre KK1'den (doff → top) gelir; burada yalnız atkı sayacı sorulur.</Text>
      <Text style={styles.label}>Atkı sayacı (isteğe bağlı — boş: ölçülmedi)</Text>
      <NumpadInput value={picks} onChangeText={setPicks} allowDecimal={false} numpadMaxLength={9} numpadLabel="Atkı sayacı" placeholder="okunmadı" style={styles.input} />
      <View style={styles.actions}>
        <Button onPress={close} disabled={state.closing}>Vazgeç</Button>
        <Button mode="contained" onPress={() => state.submitClose(picks)} loading={state.closing} disabled={state.closing}>Kapat</Button>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text, marginBottom: spacing.sm },
  body: { fontSize: typography.size.sm, color: colors.textSecondary },
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold, marginTop: spacing.sm },
  input: { backgroundColor: colors.surface },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
});
