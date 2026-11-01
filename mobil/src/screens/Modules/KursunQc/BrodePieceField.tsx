// GK-H1b: brode ADET/VURUŞ fiyatlamasında ZORUNLU "Brode adedi" girişi (gramaj/desen dokunuşundan önce).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import NumpadInput from '../../../components/NumpadInput';
import { colors, spacing } from '../../../theme/tokens';
import { pieceHint } from './brodePiece';
import type { BrodePieceState } from './useBrodePieceCount';

export default function BrodePieceField({ state, hidden }: { state: BrodePieceState; hidden?: boolean }) {
  if (!state.mode || hidden) return null;
  return (
    <View style={s.wrap} testID="brode-adet-alani">
      <NumpadInput
        testID="brode-adet-giris"
        label="Brode adedi"
        numpadLabel="Brode adedi"
        allowDecimal={false}
        value={state.text}
        onChangeText={state.setText}
        mode="outlined"
        dense
        right={<TextInput.Affix text="adet" />}
      />
      <Text style={s.hint}>{pieceHint(state.mode)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: spacing.sm },
  hint: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});
