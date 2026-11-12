// Birimli sayı girişi (Tambur Metre · Kg · En; Kurşun/muayene hata metresi): beyaz zemin, çerçevesiz, köşe radius.md;
// başlık yerine kutunun içinde sağda gri birim. Sıra: değer … ⊗ birim. Tuş takımı NumpadInput'ta.
import React, { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import NumpadInput from './NumpadInput';
import { colors, palette, radius, shadow, spacing, typography } from '../theme/tokens';

export interface UnitInputProps {
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
  /** Mount anında tuş takımını bu kutuya bağlar (NumpadInput.autoActivate). */
  autoActivate?: boolean;
  /** Telefonda sistem klavyesi (NumpadInput.useNativeKeyboard). */
  useNativeKeyboard?: boolean;
  /** Kutu yerleşimi (genişlik/yükseklik) — görünüm tokenları burada sabit. */
  style?: StyleProp<ViewStyle>;
  testID: string;
  clearTestID?: string;
}

/** ⊗ yalnız Manuel kipte ve kutu doluyken (kullanıcı 2026-11-10). */
export function showClearIcon(value: string, manual = true): boolean {
  return manual && value.trim().length > 0;
}

// İkon küçük ama dokunma hedefi IconButton + hitSlop ≥44dp.
const CLEAR_HIT = { top: 6, bottom: 6, left: 6, right: 6 };

export default function UnitInput(p: UnitInputProps) {
  const [focused, setFocused] = useState(false);
  const manual = p.manual ?? true;
  const a11y = `${p.label}, ${p.unitName}${p.required ? ', zorunlu' : ''}`;
  return (
    <View style={[s.box, p.style, focused && s.boxFocused]} testID={`${p.testID}-kutu`}>
      <NumpadInput
        mode="flat"
        value={p.value}
        onChangeText={p.onChange}
        numpadLabel={`${p.label} (${p.unit})`}
        allowDecimal
        numpadMaxLength={p.numpadMaxLength ?? 8}
        autoActivate={p.autoActivate}
        useNativeKeyboard={p.useNativeKeyboard}
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
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    paddingRight: spacing.md,
    ...shadow.sm,
    elevation: 1,
  },
  // Çerçeve yalnız odakta (tuş takımı hedefi) — NumpadInput'un indigo vurgusuyla aynı renk.
  boxFocused: { borderColor: palette.indigo[600] },
  input: {
    flex: 1,
    minWidth: 0,
    backgroundColor: 'transparent',
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
    fontVariant: ['tabular-nums'],
    height: 52,
  },
  content: { paddingLeft: spacing.md, paddingRight: spacing.xs, paddingTop: 0, paddingBottom: 0 },
  clear: { margin: 0 },
  unit: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: colors.textMuted },
  req: { color: palette.red[600], fontWeight: typography.weight.bold },
});
