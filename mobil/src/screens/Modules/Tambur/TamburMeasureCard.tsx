// Geniş tablet ölçüm kartı (2026-11-10/11, kullanıcı kararı; başlıksız): yalnız MANUEL kipteki alanın kutusu çizilir (Metre ve/veya
// Kg). Kipler alt şeritteki METRE/KG düğmelerinde; ikisi de otomatikse kartı çağıran hiç çizmez. Kutular UnitInput
// (birim kutunun içinde sağda, dolu kutuda ⊗); kg kutusunda Tart (varsa) bugünkü gibi.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Button } from 'react-native-paper';
import { palette, spacing } from '../../../theme/tokens';
import { ACTION_BUTTON_RADIUS } from './CutActionBar';
import UnitInput from '../../../components/UnitInput';

export interface TamburMeasureCardProps {
  /** Metre Manuel değilse null (kutu yok). */
  length: { value: string; onChange: (v: string) => void; onClear: () => void; placeholder: string } | null;
  /** Kg Manuel değilse ya da kg alanı yoksa null. */
  kg: { value: string; onChange: (v: string) => void; required: boolean; onTart?: () => void; tartBusy?: boolean } | null;
  /** Bölme önerisi / "etiket iş bitince" ipucu. */
  extras?: React.ReactNode;
}

export default function TamburMeasureCard({ length, kg, extras }: TamburMeasureCardProps) {
  return (
    <View style={s.card} testID="tambur-olcum-karti">
      <View style={s.row}>
        {length && (
          <View style={s.col}>
            <UnitInput
              value={length.value}
              onChange={length.onChange}
              unit="m"
              unitName="metre"
              label="Kesim uzunluğu"
              placeholder={length.placeholder}
              onClear={length.onClear}
              testID="tambur-olcum-metre"
              clearTestID="tambur-olcum-metre-temizle"
            />
          </View>
        )}
        {kg && (
          <View style={[s.col, s.inputRow]}>
            <View style={s.grow}>
              <UnitInput
                value={kg.value}
                onChange={kg.onChange}
                unit="kg"
                unitName="kilogram"
                label="Tartım"
                placeholder="0,0"
                required={kg.required}
                onClear={() => kg.onChange('')}
                testID="tambur-tartim-kg"
                clearTestID="tambur-tartim-kg-temizle"
              />
            </View>
            {kg.onTart ? (
              <Button mode="contained" icon="scale" buttonColor={palette.slate[700]} textColor={palette.white} onPress={kg.onTart} disabled={kg.tartBusy} loading={kg.tartBusy} testID="tambur-tart" style={s.tart} contentStyle={{ height: 56 }}>
                Tart
              </Button>
            ) : null}
          </View>
        )}
      </View>
      {extras}
    </View>
  );
}

const s = StyleSheet.create({
  // Açık gri zemin + beyaz çerçevesiz kutular (kullanıcı 2026-11-11 tur-4).
  // Köşe 14: ekrandaki kardeş kartlarla (bilgi · hata · önizleme · çıkan etiketler) aynı seviye.
  card: { flexShrink: 0, backgroundColor: palette.slate[100], borderRadius: 14, padding: spacing.sm, gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  col: { flex: 1 },
  grow: { flex: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Tart dolu nötr koyu (outlined düğme yok — tasarım istemi §1); kip düğmeleriyle aynı ton.
  tart: { borderRadius: ACTION_BUTTON_RADIUS },
});
