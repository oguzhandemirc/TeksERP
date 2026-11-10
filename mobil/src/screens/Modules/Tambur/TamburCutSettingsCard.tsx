// Geniş ana kesim Kat / En / Kalite kartı (2026-11-10, kullanıcı: sağ sütunda Çıkan etiketlerin altında).
// Dar sütun için iki satır: üstte Kat + En, altta Kalite düğmeleri; dokunma hedefleri ≥56dp. Saf görünüm.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import NumpadInput from '../../../components/NumpadInput';
import { colors, palette } from '../../../theme/tokens';
import { QualitySegment, type QualityOption } from './TamburCompactPickers';

export interface TamburCutSettingsProps {
  fold: { options: { code: string; name: string }[]; value: string | null | undefined; onPick: (code: string) => void };
  /** Şablon en basmıyorsa null (bugünkü görünürlük kuralı). */
  width: { value: string; onChange: (v: string) => void; placeholder: string } | null;
  quality: { grades: QualityOption[]; value: string | null | undefined; onPick: (g: QualityOption, active: boolean) => void };
}

export default function TamburCutSettingsCard(p: TamburCutSettingsProps) {
  return (
    <View style={s.card} testID="tambur-kesim-ayar-karti">
      <View style={s.row}>
        <View style={s.foldCol}>
          <Text style={s.label}>Tambur (kat)</Text>
          <View style={s.foldGroup} accessibilityRole="radiogroup" accessibilityLabel="Tambur katı">
            {p.fold.options.map((ft) => {
              const active = p.fold.value === ft.code;
              return (
                <TouchableRipple
                  key={ft.code}
                  borderless
                  onPress={() => p.fold.onPick(ft.code)}
                  style={[s.fold, active && s.foldActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  testID={`tambur-kat-${ft.code}`}
                >
                  <Text style={[s.foldText, active && s.foldTextActive]}>{ft.name}</Text>
                </TouchableRipple>
              );
            })}
          </View>
        </View>
        {p.width && (
          <View style={s.widthCol}>
            <Text style={s.label}>En (cm)</Text>
            <NumpadInput
              mode="outlined"
              value={p.width.value}
              onChangeText={p.width.onChange}
              numpadLabel="En (cm)"
              allowDecimal
              numpadMaxLength={6}
              placeholder={p.width.placeholder}
              style={s.input}
              testID="tambur-en-cm"
            />
          </View>
        )}
      </View>
      <View style={{ gap: 4 }}>
        <Text style={s.label}>Kalite</Text>
        <QualitySegment grades={p.quality.grades} value={p.quality.value} onPick={p.quality.onPick} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: palette.white, borderRadius: 14, padding: 12, gap: 8, borderWidth: 1, borderColor: palette.slate[200] },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-end' },
  foldCol: { flex: 1.4, gap: 4 },
  widthCol: { flex: 1, gap: 4 },
  label: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  foldGroup: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 12, backgroundColor: palette.slate[100] },
  fold: { flex: 1, minHeight: 56, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  foldActive: { backgroundColor: palette.blue[800] },
  foldText: { fontSize: 18, fontWeight: '700', color: palette.slate[700] },
  foldTextActive: { color: palette.white },
  input: { fontSize: 22, fontWeight: '700' },
});
