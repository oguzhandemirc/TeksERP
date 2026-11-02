// K16 (fabrika cevabı 14/21-ek): okutulan iş BAŞKA kurşun makinesine atanmış — engel değil, operatöre sorulur.
// "Yine de al" sunucuya iz yazdırır (audit), atama değişmez; "Vazgeç" kartı açmaz.
import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import AppModal from '../../../components/AppModal';
import { palette } from '../../../theme/tokens';

export interface ForeignMachinePromptState {
  barcode: string;
  fromInput: boolean;
  batchNumber: string;
  plannedMachineName: string;
}

export default function ForeignMachinePrompt({
  prompt,
  busy,
  onConfirm,
  onCancel,
}: {
  prompt: ForeignMachinePromptState | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { width } = useWindowDimensions();
  const phone = width < 600;
  return (
    <AppModal visible={!!prompt} onDismiss={busy ? () => undefined : onCancel}>
      <View style={[styles.sheet, { width: phone ? width * 0.92 : Math.min(520, width * 0.6) }]} testID="foreign-machine-prompt">
        <View style={styles.header}>
          <Icon source="alert" size={22} color={palette.amber[700]} />
          <Text style={styles.title}>Bu iş başka makineye atanmış</Text>
        </View>
        {!!prompt && (
          <Text style={styles.body}>
            {prompt.batchNumber} — bu iş {prompt.plannedMachineName} makinesine atanmış. Bu makinede yine de alırsan kayda geçer;
            atama değişmez.
          </Text>
        )}
        <View style={styles.actions}>
          <Button mode="outlined" onPress={onCancel} disabled={busy} testID="foreign-machine-cancel">
            Vazgeç
          </Button>
          <Button mode="contained" onPress={onConfirm} loading={busy} disabled={busy} testID="foreign-machine-take">
            Yine de al
          </Button>
        </View>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden', paddingBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: palette.amber[100] },
  title: { fontSize: 17, fontWeight: '700', color: palette.amber[900], flex: 1 },
  body: { fontSize: 15, paddingHorizontal: 14, paddingTop: 12, color: '#1f2937' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingHorizontal: 14, paddingTop: 14 },
});
