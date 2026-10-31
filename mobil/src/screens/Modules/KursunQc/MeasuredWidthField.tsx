// D4-E2b: en ölçen istasyonda İSTEĞE BAĞLI "Ölçülen en (cm)" girişi (zorunlu değil, boş geçilir).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import NumpadInput from '../../../components/NumpadInput';
import { colors, spacing } from '../../../theme/tokens';
import type { MeasuredWidthState } from './useMeasuredWidth';

export default function MeasuredWidthField({ state, hidden }: { state: MeasuredWidthState; hidden?: boolean }) {
  if (!state.enabled || hidden) return null;
  return (
    <View style={s.wrap} testID="olculen-en-alani">
      <NumpadInput
        testID="olculen-en-giris"
        label="Ölçülen en (cm)"
        numpadLabel="Ölçülen en (cm)"
        value={state.text}
        onChangeText={state.setText}
        mode="outlined"
        dense
        right={<TextInput.Affix text="cm" />}
      />
      <Text style={s.hint}>İsteğe bağlı — boş bırakılırsa topun eni değişmez.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: spacing.sm },
  hint: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});
