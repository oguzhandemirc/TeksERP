// Kart numarasını elle yazma (kullanıcı 2026-11-11): iş yokken tam ekran boş durumda okutma çubuğu çizilmez; elle giriş
// "Diğer" menüsünden bu sayfaya taşındı. Çözümleme ekranın kart okutma yolu (resolveCard) — ikinci kaynak yok.
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Button } from 'react-native-paper';
import ModuleSheet from '../../../components/ModuleSheet';
import ModalTextInput from '../../../components/ModalTextInput';
import { colors, palette, radius, shadow, typography } from '../../../theme/tokens';

export interface TamburCardCodeSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (code: string) => void;
}

export default function TamburCardCodeSheet({ visible, onDismiss, onSubmit }: TamburCardCodeSheetProps) {
  const [code, setCode] = useState('');
  const trimmed = code.trim();
  const submit = () => {
    if (!trimmed) return;
    onSubmit(trimmed);
    setCode('');
  };
  return (
    <ModuleSheet
      visible={visible}
      onDismiss={onDismiss}
      title="Kart numarası"
      size="sm"
      footer={
        <>
          <Button mode="contained" buttonColor={palette.slate[700]} textColor={palette.white} onPress={onDismiss} style={s.btn} testID="tambur-kart-no-vazgec">
            Vazgeç
          </Button>
          <Button mode="contained" buttonColor={palette.blue[700]} textColor={palette.white} onPress={submit} disabled={!trimmed} style={s.btn} testID="tambur-kart-no-ac">
            Kartı aç
          </Button>
        </>
      }
    >
      <ModalTextInput
        value={code}
        onChangeText={setCode}
        placeholder="Refakat kartı numarası"
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus
        returnKeyType="go"
        onSubmitEditing={submit}
        mode="flat"
        underlineColor="transparent"
        activeUnderlineColor="transparent"
        style={s.input}
        accessibilityLabel="Refakat kartı numarası"
        testID="tambur-kart-no"
      />
    </ModuleSheet>
  );
}

const s = StyleSheet.create({
  btn: { borderRadius: radius.md },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, fontSize: typography.size.lg, ...shadow.sm },
});
