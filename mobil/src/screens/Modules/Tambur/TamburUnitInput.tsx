// Tambur geniş kesim sayı girişi (Metre · Kg · En; kullanıcı 2026-11-11 tur-4): beyaz zemin, çerçevesiz, köşe
// ACTION_BUTTON_RADIUS; başlık yerine kutunun içinde sağda birim. Sıra: değer … ⊗ birim. Tuş takımı NumpadInput'ta.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import NumpadInput from '../../../components/NumpadInput';
import { palette, shadow } from '../../../theme/tokens';
import { ACTION_BUTTON_RADIUS } from './CutActionBar';

export interface TamburUnitInputProps {
  value: string;
  onChange: (v: string) => void;
  /** Kutunun içinde sağda gösterilen birim ("m", "kg", "cm"). */
  unit: string;
  /** Erişilebilirlik etiketinde birimin uzun adı ("metre"). */
  unitName: string;
  /** Erişilebilirlik + tuş takımı başlığı ("Kesim uzunluğu"). */
  label: string;
  placeholder?: string;
  numpadMaxLength?: number;
  /** null → ⊗ yok. */
  onClear?: (() => void) | null;
  /** Otomatik kipte ⊗ çizilmez (kutu salt okunur görünüm). */
  manual?: boolean;
  required?: boolean;
  testID: string;
  clearTestID?: string;
}

/** ⊗ yalnız Manuel kipte ve kutu doluyken (kullanıcı 2026-11-10). */
export function showClearIcon(value: string, manual = true): boolean {
  return manual && value.trim().length > 0;
}

// İkon küçük ama dokunma hedefi IconButton + hitSlop ≥44dp.
const CLEAR_HIT = { top: 6, bottom: 6, left: 6, right: 6 };

export default function TamburUnitInput(p: TamburUnitInputProps) {
  const [focused, setFocused] = useState(false);
  const manual = p.manual ?? true;
  const a11y = `${p.label}, ${p.unitName}${p.required ? ', zorunlu' : ''}`;
  return (
    <View style={[s.box, focused && s.boxFocused]} testID={`${p.testID}-kutu`}>
      <NumpadInput
        mode="flat"
        value={p.value}
        onChangeText={p.onChange}
        numpadLabel={`${p.label} (${p.unit})`}
        allowDecimal
        numpadMaxLength={p.numpadMaxLength ?? 8}
        placeholder={p.placeholder}
        editable={manual}
        style={s.input}
        contentStyle={s.content}
        underlineColor="transparent"
        activeUnderlineColor="transparent"
        placeholderTextColor={palette.slate[400]}
        onFocusChange={setFocused}
        accessibilityLabel={a11y}
        testID={p.testID}
      />
      {p.onClear && showClearIcon(p.value, manual) ? (
        <IconButton
          icon="close-circle"
          size={22}
          iconColor={palette.slate[400]}
          onPress={p.onClear}
          hitSlop={CLEAR_HIT}
          style={s.clear}
          accessibilityLabel={`${p.label} temizle`}
          testID={p.clearTestID ?? `${p.testID}-temizle`}
        />
      ) : null}
      <Text style={s.unit} accessible={false}>
        {p.unit}
        {p.required ? <Text style={s.req}> *</Text> : null}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    backgroundColor: palette.white,
    borderRadius: ACTION_BUTTON_RADIUS,
    borderWidth: 2,
    borderColor: 'transparent',
    paddingRight: 12,
    ...shadow.sm,
    elevation: 1,
  },
  // Çerçeve yalnız odakta (tuş takımı hedefi) — NumpadInput'un indigo vurgusuyla aynı renk.
  boxFocused: { borderColor: palette.indigo[600] },
  input: { flex: 1, minWidth: 0, backgroundColor: 'transparent', fontSize: 24, fontWeight: '700', height: 52 },
  content: { paddingLeft: 12, paddingRight: 4, paddingTop: 0, paddingBottom: 0 },
  clear: { margin: 0 },
  unit: { fontSize: 18, fontWeight: '600', color: palette.slate[500], marginLeft: 2 },
  req: { color: palette.red[600], fontWeight: '800' },
});
