// =============================================================================
// Fason sevkinde "Beklenen dönüş" (F6/T2) — opsiyonel, ÇİPLERLE (takvim paketi yok; sipariş termini emsali).
// "Varsayılan" alanı HİÇ göndermez → backend firma > süreç türü > genel ayar zincirini uygular (eski APK ile aynı).
// Gün seçimi fabrika günü anahtarıyla `YYYY-MM-DD` gider; backend o günün son anını yazar.
// =============================================================================
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Chip, Text } from 'react-native-paper';
import { colors, spacing } from '../../../theme';
import { addDaysToKey, factoryDayKey, fmtDayKey } from '../../../lib/factory-time';

export const EXPECTED_RETURN_CHOICES: readonly { label: string; days: number | null }[] = [
  { label: 'Varsayılan', days: null },
  { label: '3 gün', days: 3 },
  { label: '5 gün', days: 5 },
  { label: '7 gün', days: 7 },
  { label: '10 gün', days: 10 },
  { label: '14 gün', days: 14 },
];

/** Sevk gövdesine giden değer: seçim yoksa `undefined` (alan gönderilmez). */
export function expectedReturnPayload(days: number | null, today: string = factoryDayKey()): string | undefined {
  return days == null ? undefined : addDaysToKey(today, days);
}

interface Props {
  days: number | null;
  onChange: (days: number | null) => void;
}

export default function ExpectedReturnChips({ days, onChange }: Props) {
  const preview = days == null ? 'Firma / süreç ayarı uygulanır' : fmtDayKey(expectedReturnPayload(days) ?? null);
  return (
    <View>
      <Text style={styles.label}>Beklenen dönüş</Text>
      <View style={styles.row}>
        {EXPECTED_RETURN_CHOICES.map((c) => {
          const on = days === c.days;
          return (
            <Chip
              key={c.label}
              mode={on ? 'flat' : 'outlined'}
              selected={on}
              showSelectedCheck={false}
              onPress={() => onChange(c.days)}
              style={[styles.chip, on && styles.chipOn]}
              textStyle={on ? styles.chipTextOn : undefined}
              accessibilityLabel={`Beklenen dönüş ${c.label}`}
            >
              {c.label}
            </Chip>
          );
        })}
      </View>
      <Text style={styles.hint}>{preview}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: spacing.sm, marginBottom: spacing.xs, color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { height: 44, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.brandContainer },
  chipTextOn: { color: colors.brandDark, fontWeight: '700' },
  hint: { marginTop: spacing.xs, color: colors.textSecondary, fontSize: 13 },
});
