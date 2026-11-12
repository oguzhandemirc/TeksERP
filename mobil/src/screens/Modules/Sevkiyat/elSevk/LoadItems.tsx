// Okutma ekranı liste öğeleri: çuval kartı (seçili = dolu vurgu + ✓; basılı tut → içerik; sağda kg) ve top satırı.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, IconButton, Text, TouchableRipple } from 'react-native-paper';
import TruncatedText from '../../../../components/TruncatedText';
import type { HandheldRoll, HandheldSack } from '../../../../services/handheldShipment.service';
import { colors, palette, radius, spacing, typography } from '../../../../theme';
import { fmtKg, fmtM, sackKgDisplay, sackMeta } from './summary';
import { ACCENT, ACCENT_SOFT, ui } from './ui';

export const LONG_PRESS_MS = 500;

interface SackCardProps {
  sack: HandheldSack;
  selected: boolean;
  highlighted: boolean;
  /** false: sevk edilmiş (salt-okunur) — seçim ve kg girişi yok, dokunuş içeriği açar. */
  editable: boolean;
  onPress: (sack: HandheldSack) => void;
  onLongPress: (sack: HandheldSack) => void;
  onKg: (sack: HandheldSack) => void;
}

export function SackCard({ sack, selected, highlighted, editable, onPress, onLongPress, onKg }: SackCardProps) {
  const kg = sackKgDisplay(sack);
  const fg = selected ? colors.textOnDark : colors.text;
  const muted = selected ? colors.textOnDark : colors.textMuted;
  return (
    <TouchableRipple
      onPress={() => onPress(sack)}
      onLongPress={() => onLongPress(sack)}
      delayLongPress={LONG_PRESS_MS}
      borderless
      style={[ui.card, styles.card, selected ? styles.cardOn : highlighted && styles.cardFlash]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${sack.sackNo}${selected ? ', seçili' : ''}`}
      testID={`sevk-cuval-${sack.sackNo}`}
    >
      <View style={styles.cardInner}>
        <Icon source={selected ? 'check-circle' : 'package-variant-closed'} size={28} color={selected ? colors.textOnDark : ACCENT} />
        <View style={styles.mid}>
          <Text style={[styles.code, { color: fg }]} numberOfLines={1}>
            {sack.sackNo}
          </Text>
          <Text style={[ui.secondary, { color: muted }]} numberOfLines={1}>
            {sackMeta(sack)}
          </Text>
        </View>
        {kg.text ? (
          <View style={styles.kgBox}>
            <Text style={[kg.kind === 'manual' ? styles.kgManual : ui.secondary, { color: kg.kind === 'manual' ? fg : muted }]}>{kg.text}</Text>
            {kg.kind === 'sum' ? <Text style={[styles.kgHint, { color: muted }]}>toplam</Text> : null}
          </View>
        ) : null}
        {editable ? (
          <IconButton
            icon="scale"
            size={22}
            iconColor={selected ? colors.textOnDark : colors.textSecondary}
            onPress={() => onKg(sack)}
            style={styles.kgButton}
            accessibilityLabel={`${sack.sackNo} kg gir`}
            testID={`sevk-cuval-kg-${sack.sackNo}`}
          />
        ) : null}
      </View>
    </TouchableRipple>
  );
}

export function RollRow({ roll, highlighted }: { roll: HandheldRoll; highlighted: boolean }) {
  const sub = [roll.itemName, roll.colorName].filter(Boolean).join(' · ');
  return (
    <View style={[ui.card, styles.roll, highlighted && styles.cardFlash]} testID={`sevk-top-${roll.barcode}`}>
      <View style={styles.mid}>
        <View style={styles.codeRow}>
          <Text style={styles.code} numberOfLines={1}>
            {roll.barcode}
          </Text>
          {roll.readinessClass === 'IN_PROCESS' ? <View style={styles.dot} accessibilityLabel="işlemde" /> : null}
        </View>
        <TruncatedText style={ui.secondary}>{sub}</TruncatedText>
      </View>
      <View style={styles.right}>
        <Text style={styles.num}>{fmtM(roll.meters)} m</Text>
        {roll.weightKg != null ? <Text style={[ui.secondary, styles.tab]}>{fmtKg(roll.weightKg)} kg</Text> : null}
      </View>
    </View>
  );
}

export function SectionTitle({ text, count }: { text: string; count: number }) {
  return (
    <View style={styles.section}>
      <Text style={ui.label}>{text}</Text>
      <Text style={ui.secondary}>{count} top</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm },
  cardOn: { backgroundColor: ACCENT },
  cardFlash: { backgroundColor: ACCENT_SOFT },
  cardInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: spacing.lg, paddingRight: spacing.xs, minHeight: 72 },
  mid: { flex: 1, minWidth: 0, gap: 2 },
  code: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.text, fontVariant: ['tabular-nums'] },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: palette.amber[500] },
  kgBox: { alignItems: 'flex-end' },
  kgManual: { fontSize: typography.size.base, fontWeight: typography.weight.bold, fontVariant: ['tabular-nums'] },
  kgHint: { fontSize: typography.size.xs },
  kgButton: { margin: 0, width: 48, height: 48 },
  roll: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, minHeight: 64, marginBottom: spacing.sm },
  right: { alignItems: 'flex-end' },
  num: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.text, fontVariant: ['tabular-nums'] },
  tab: { fontVariant: ['tabular-nums'] },
  section: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: spacing.md, paddingBottom: spacing.sm, paddingHorizontal: spacing.xs },
});
