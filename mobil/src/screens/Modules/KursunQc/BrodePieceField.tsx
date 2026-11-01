// GK-H1b: brode ADET/VURUŞ fiyatlamasında ZORUNLU "Brode adedi" girişi (gramaj/desen dokunuşundan önce).
// Boş/geçersiz adette dokunuş durunca hata alanın ALTINDA kırmızı yazılır ve alana odaklanılır (prova-2 bulgusu).
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, type TextInput as RNTextInput } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import NumpadInput from '../../../components/NumpadInput';
import { colors, spacing } from '../../../theme/tokens';
import { pieceHint } from './brodePiece';
import type { BrodePieceState } from './useBrodePieceCount';

export default function BrodePieceField({ state, hidden }: { state: BrodePieceState; hidden?: boolean }) {
  const inputRef = useRef<RNTextInput>(null);
  // Yalnız sayaç DEĞİŞİNCE odaklan: alan yeniden bağlanınca (çıkış ölçümü aç/kapa) eski istek numpad'i açmasın.
  const handledFocus = useRef(state.focusRequest);
  useEffect(() => {
    if (state.focusRequest === handledFocus.current) return;
    handledFocus.current = state.focusRequest;
    const input = inputRef.current;
    // Zaten odaktaysa focus() onFocus'u tetiklemez → numpad kapalı kalırdı; önce bırak.
    if (input?.isFocused?.()) input.blur();
    input?.focus();
  }, [state.focusRequest]);
  if (!state.mode || hidden) return null;
  return (
    <View style={s.wrap} testID="brode-adet-alani">
      <NumpadInput
        ref={inputRef}
        testID="brode-adet-giris"
        label="Brode adedi"
        numpadLabel="Brode adedi"
        allowDecimal={false}
        value={state.text}
        onChangeText={state.setText}
        mode="outlined"
        dense
        error={state.error !== null}
        right={<TextInput.Affix text="adet" />}
      />
      {state.error ? (
        <Text style={s.error} testID="brode-adet-hata" accessibilityRole="alert">
          {state.error}
        </Text>
      ) : (
        <Text style={s.hint}>{pieceHint(state.mode)}</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: spacing.sm },
  hint: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  error: { fontSize: 13, fontWeight: '600', color: colors.dangerDark, marginTop: 2 },
});
