// Tek İE formunun en üstü: "Malın sahibi" — Bizim mal (STANDARD, mavi) | Müşteri malı (fason, turuncu). Seçim yokken kart
// kırmızı çerçeveli ve oluşturma kapalı (çağıran engeller); ön seçimde kısa neden yazılır.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import { colors, radius, spacing, typography } from '../../../../theme';
import type { WoCreateKind } from '../../../../store/woCreateKinds';

interface Props {
  value: WoCreateKind | null;
  reason: string | null;
  locked: boolean;
  onChange: (k: WoCreateKind) => void;
}

const OPTIONS: { kind: WoCreateKind; label: string; icon: string; tone: { fg: string; bg: string } }[] = [
  { kind: 'STANDARD', label: 'Bizim mal', icon: 'factory', tone: { fg: colors.infoDark, bg: colors.infoContainer } },
  { kind: 'CUSTOMER_GOODS', label: 'Müşteri malı (fason)', icon: 'account-arrow-down-outline', tone: { fg: colors.warningDark, bg: colors.warningContainer } },
];

export default function OwnerKindCard({ value, reason, locked, onChange }: Props) {
  const missing = value === null;
  return (
    <View style={[styles.card, missing && styles.missing]} testID="ie-mal-sahibi">
      <Text style={styles.title}>Malın sahibi</Text>
      <View style={styles.row}>
        {OPTIONS.map((o) => {
          const on = value === o.kind;
          return (
            <TouchableRipple
              key={o.kind}
              onPress={() => onChange(o.kind)}
              disabled={locked}
              style={[styles.opt, { borderColor: on ? o.tone.fg : colors.border, backgroundColor: on ? o.tone.bg : colors.surface }]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: locked }}
              testID={`ie-mal-sahibi-${o.kind}`}
            >
              <View style={styles.optInner}>
                <Icon source={on ? 'radiobox-marked' : 'radiobox-blank'} size={24} color={on ? o.tone.fg : colors.textMuted} />
                <Icon source={o.icon} size={24} color={o.tone.fg} />
                <Text style={[styles.optLabel, { color: on ? o.tone.fg : colors.text }]}>{o.label}</Text>
              </View>
            </TouchableRipple>
          );
        })}
      </View>
      {missing ? (
        <Text style={styles.need} testID="ie-mal-sahibi-sec">Seçin — oluşturmadan önce gerekli.</Text>
      ) : reason ? (
        <Text style={styles.reason} testID="ie-mal-sahibi-neden">{reason}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  missing: { borderWidth: 2, borderColor: colors.danger },
  title: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  opt: { flexGrow: 1, flexBasis: 220, minHeight: 64, borderRadius: radius.lg, borderWidth: 2, justifyContent: 'center', overflow: 'hidden' },
  optInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  optLabel: { flexShrink: 1, fontSize: typography.size.lg, fontWeight: typography.weight.bold },
  need: { fontSize: typography.size.sm, color: colors.dangerText },
  reason: { fontSize: typography.size.sm, color: colors.textSecondary },
});
