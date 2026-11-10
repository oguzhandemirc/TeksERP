// Geniş tablet "Ölçüm" kartı (2026-11-10, hedef görsel): Metre + Kg. Kip (Manuel/Otomatik) ana kesimin
// `cutMode`udur — burada yalnız gösterilir; değiştirme alt şeritteki tek düğmede. Otomatikte metreyi Kes anında
// makine ölçer (bugünkü akış), kg için Tart tek dokunuş; manuelde ikisi de elle (numpad alt sayfası).
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Icon, Button, IconButton } from 'react-native-paper';
import NumpadInput from '../../../components/NumpadInput';
import { colors, palette } from '../../../theme/tokens';

export interface TamburMeasureCardProps {
  mode: 'manual' | 'auto';
  length: { value: string; onChange: (v: string) => void; onClear: () => void; placeholder: string };
  /** Şablon kg basmıyor ve tartım zorunlu değilse null (bugünkü görünürlük kuralı) → sütun çizilmez. */
  kg: { value: string; onChange: (v: string) => void; required: boolean; onTart?: () => void; tartBusy?: boolean } | null;
  /** Bölme önerisi / "etiket iş bitince" ipucu. */
  extras?: React.ReactNode;
}

export function measureModeText(mode: 'manual' | 'auto'): string {
  return mode === 'manual' ? 'Manuel giriş' : 'Otomatik (makine)';
}

export default function TamburMeasureCard({ mode, length, kg, extras }: TamburMeasureCardProps) {
  const manual = mode === 'manual';
  return (
    <View style={s.card} testID="tambur-olcum-karti">
      <View style={s.head}>
        <Text style={s.title}>Ölçüm</Text>
        <View style={{ flex: 1 }} />
        <View style={[s.dot, { backgroundColor: manual ? palette.indigo[700] : palette.emerald[600] }]} />
        <Text style={[s.mode, { color: manual ? palette.indigo[700] : palette.emerald[600] }]} testID="tambur-olcum-kip">{measureModeText(mode)}</Text>
      </View>
      <View style={s.row}>
        <View style={s.col}>
          <Text style={s.label}>Metre</Text>
          {manual ? (
            <View style={s.inputRow}>
              <View style={{ flex: 1 }}>
                <NumpadInput
                  mode="outlined"
                  value={length.value}
                  onChangeText={length.onChange}
                  numpadLabel="Kesim uzunluğu"
                  allowDecimal
                  numpadMaxLength={8}
                  placeholder={length.placeholder}
                  style={s.input}
                  testID="tambur-olcum-metre"
                />
              </View>
              <IconButton icon="backspace-outline" mode="contained-tonal" size={22} onPress={length.onClear} disabled={!length.value} accessibilityLabel="Uzunluğu temizle" style={{ margin: 0 }} />
            </View>
          ) : (
            <View style={s.autoBox}>
              <Icon source="ruler" size={22} color={palette.emerald[600]} />
              <Text style={s.autoText}>Kes’te makineden ölçülür</Text>
            </View>
          )}
        </View>
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
                testID="tambur-tartim-kg"
              />
            </View>
            {kg.onTart ? (
              <Button mode={manual ? 'outlined' : 'contained'} icon="scale" onPress={kg.onTart} disabled={kg.tartBusy} loading={kg.tartBusy} testID="tambur-tart" contentStyle={{ height: 52 }}>
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
  card: { backgroundColor: palette.white, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: palette.slate[200] },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 17, fontWeight: '800', color: palette.slate[900] },
  dot: { width: 9, height: 9, borderRadius: 5 },
  mode: { fontSize: 14, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 12 },
  col: { flex: 1, gap: 4 },
  label: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: { fontSize: 26, fontWeight: '700' },
  autoBox: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 56, paddingHorizontal: 12, borderRadius: 8, backgroundColor: palette.emerald[50] },
  autoText: { fontSize: 14, fontWeight: '700', color: palette.emerald[700], flexShrink: 1 },
});
