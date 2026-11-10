// Tambur kompakt tek ekran (K5, 2026-11-10) — geniş tablette kesim formunun tek satırlık seçicileri.
// Kime? dikey listesi (iç kaydırmalı) yerine tek düğme → PickerModal; Kalite dikey listesi yerine yatay segment.
// Telefon (dikey) bugünkü uzun formu kullanır; bu bileşenler yalnız geniş dalda çizilir.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import TruncatedText from '../../../components/TruncatedText';
import { colors, radius, spacing } from '../../../theme/tokens';

/** PickerModal'daki "Stok (müşterisiz)" satırının değeri — gerçek id ile çakışmasın diye ayraçlı. */
export const TARGET_STOCK_VALUE = '__kime_stok__';
/** Ana akışta sipariş satırı seçeneklerinin değer öneki (müşteri id'leriyle aynı listede durur). */
export const TARGET_LINE_PREFIX = 'line:';

/** Kime düğmesinin metni: sipariş satırı > müşteri > Stok. */
export function targetButtonText(i: { lineLabel?: string | null; customerName?: string | null }): string {
  if (i.lineLabel) return i.lineLabel;
  if (i.customerName) return i.customerName;
  return 'Stok (müşterisiz)';
}

export function TargetButton({ text, stock, onPress }: { text: string; stock: boolean; onPress: () => void }) {
  return (
    <TouchableRipple
      borderless
      onPress={onPress}
      style={[s.kime, stock ? s.kimeStock : s.kimeTarget]}
      testID="tambur-kime-sec"
      accessibilityRole="button"
      accessibilityLabel={`Kime: ${text}. Değiştirmek için dokunun`}
    >
      <View style={s.kimeRow}>
        <Text style={s.kimeLabel}>Kime</Text>
        <TruncatedText style={[s.kimeText, stock ? s.kimeTextStock : s.kimeTextTarget]}>{text}</TruncatedText>
        <Icon source="chevron-down" size={22} color={stock ? colors.successDark : colors.brand} />
      </View>
    </TouchableRipple>
  );
}

export interface QualityOption {
  id: string;
  code: string;
  name: string;
  color?: string | null;
}

export function QualitySegment({
  grades,
  value,
  onPick,
}: {
  grades: QualityOption[];
  value: string | null | undefined;
  onPick: (grade: QualityOption, active: boolean) => void;
}) {
  return (
    <View style={s.segment} accessibilityRole="radiogroup" accessibilityLabel="Kalite">
      {grades.map((g) => {
        const active = value === g.code;
        return (
          <TouchableRipple
            key={g.id}
            borderless
            onPress={() => onPick(g, active)}
            style={[s.seg, active && s.segActive, active && g.color ? { backgroundColor: g.color, borderColor: g.color } : null]}
            testID={`tambur-kalite-${g.code}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
          >
            <TruncatedText style={[s.segText, active && s.segTextActive]}>{g.name}</TruncatedText>
          </TouchableRipple>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  kime: { flex: 1, minHeight: 56, borderRadius: radius.md, borderWidth: 1.5, justifyContent: 'center', paddingHorizontal: spacing.md },
  kimeStock: { borderColor: colors.successDark, backgroundColor: colors.successContainer },
  kimeTarget: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  kimeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  kimeLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  kimeText: { flex: 1, fontSize: 17, fontWeight: '700' },
  kimeTextStock: { color: colors.successText },
  kimeTextTarget: { color: colors.brandDark },
  segment: { flex: 1, flexDirection: 'row', gap: spacing.xs },
  seg: {
    flex: 1,
    minHeight: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  segActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  segText: { fontSize: 16, fontWeight: '700', color: colors.text },
  segTextActive: { color: colors.textOnDark },
});
