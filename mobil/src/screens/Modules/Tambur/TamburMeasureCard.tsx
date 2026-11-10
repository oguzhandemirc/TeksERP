// Geniş tablet ölçüm kartı (2026-11-10/11, kullanıcı kararı; başlıksız): yalnız MANUEL kipteki alanın kutusu çizilir (Metre ve/veya
// Kg). Kipler alt şeritteki METRE/KG düğmelerinde; ikisi de otomatikse kartı çağıran hiç çizmez. Dolu kutunun içinde
// sağda ⊗ temizle; kg kutusunda Tart (varsa) bugünkü gibi.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, TextInput } from 'react-native-paper';
import NumpadInput from '../../../components/NumpadInput';
import { colors, palette } from '../../../theme/tokens';

export interface TamburMeasureCardProps {
  /** Metre Manuel değilse null (kutu yok). */
  length: { value: string; onChange: (v: string) => void; onClear: () => void; placeholder: string } | null;
  /** Kg Manuel değilse ya da kg alanı yoksa null. */
  kg: { value: string; onChange: (v: string) => void; required: boolean; onTart?: () => void; tartBusy?: boolean } | null;
  /** Bölme önerisi / "etiket iş bitince" ipucu. */
  extras?: React.ReactNode;
}

/** Kutu içi ⊗ yalnız kutu doluyken (kutu zaten yalnız Manuel kipte var — kullanıcı 2026-11-10). */
export function showClearIcon(value: string): boolean {
  return value.trim().length > 0;
}

// İkon küçük (22) ama dokunma hedefi IconButton ~38 + hitSlop 6 → ≥44dp.
const CLEAR_HIT = { top: 6, bottom: 6, left: 6, right: 6 };
function clearIcon(value: string, onPress: () => void, testID: string, label: string) {
  if (!showClearIcon(value)) return undefined;
  return <TextInput.Icon icon="close-circle" size={22} color={palette.slate[400]} onPress={onPress} hitSlop={CLEAR_HIT} accessibilityLabel={label} testID={testID} />;
}

export default function TamburMeasureCard({ length, kg, extras }: TamburMeasureCardProps) {
  return (
    <View style={s.card} testID="tambur-olcum-karti">
      <View style={s.row}>
        {length && (
          <View style={s.col}>
            <Text style={s.label}>Metre</Text>
            <NumpadInput
              mode="outlined"
              value={length.value}
              onChangeText={length.onChange}
              numpadLabel="Kesim uzunluğu"
              allowDecimal
              numpadMaxLength={8}
              placeholder={length.placeholder}
              style={s.input}
              right={clearIcon(length.value, length.onClear, 'tambur-olcum-metre-temizle', 'Uzunluğu temizle')}
              testID="tambur-olcum-metre"
            />
          </View>
        )}
        {kg && (
          <View style={s.col}>
            <Text style={s.label}>{kg.required ? 'Kg *' : 'Kg'}</Text>
            <View style={s.inputRow}>
              <View style={{ flex: 1 }}>
                <NumpadInput
                  mode="outlined"
                  value={kg.value}
                  onChangeText={kg.onChange}
                  numpadLabel="Tartım (kg)"
                  allowDecimal
                  numpadMaxLength={8}
                  placeholder="0,0"
                  style={s.input}
                  right={clearIcon(kg.value, () => kg.onChange(''), 'tambur-tartim-kg-temizle', 'Tartımı temizle')}
                  testID="tambur-tartim-kg"
                />
              </View>
              {kg.onTart ? (
                <Button mode="outlined" icon="scale" onPress={kg.onTart} disabled={kg.tartBusy} loading={kg.tartBusy} testID="tambur-tart" contentStyle={{ height: 52 }}>
                  Tart
                </Button>
              ) : null}
            </View>
          </View>
        )}
      </View>
      {extras}
    </View>
  );
}

const s = StyleSheet.create({
  card: { flexShrink: 0, backgroundColor: palette.white, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, gap: 4, borderWidth: 1, borderColor: palette.slate[200] },
  row: { flexDirection: 'row', gap: 12 },
  col: { flex: 1, gap: 4 },
  label: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: { fontSize: 24, fontWeight: '700' },
});
