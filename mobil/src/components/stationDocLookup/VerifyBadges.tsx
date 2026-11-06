// "Emin değilim" satırının doğrulama göstergesi: büyük puan rozeti + alan başına renkli rozet (tuttu ✓ · kısmen ≈ · tutmadı ✗).
// Renk tek başına anlam taşımaz (ikon + metin de var) — eldivenli elde, uzaktan ve renk körlüğünde okunur.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import type { StationLookupWorkOrder } from '../../services/stationDocLookup.service';
import { colors, radius, spacing, typography } from '../../theme';
import { verifyBadges, verifyScoreText, type VerifyTone } from './decide';

const TONE: Record<VerifyTone, { icon: string; fg: string; bg: string; a11y: string }> = {
  ok: { icon: 'check-circle', fg: colors.successText, bg: colors.successContainer, a11y: 'tuttu' },
  partial: { icon: 'approximately-equal', fg: colors.warningText, bg: colors.warningContainer, a11y: 'kısmen tuttu' },
  miss: { icon: 'close-circle', fg: colors.dangerText, bg: colors.dangerContainer, a11y: 'tutmadı' },
};

export default function VerifyBadges({ w }: { w: StationLookupWorkOrder }) {
  const score = verifyScoreText(w);
  if (!score) return null;
  const badges = verifyBadges(w);
  return (
    <View style={styles.wrap} testID={`belge-okut-dogrulama-${w.workOrderNumber}`}>
      <View style={styles.score} accessibilityLabel={`Doğrulama puanı ${score}`}>
        <Text style={styles.scoreText}>{score}</Text>
      </View>
      {badges.map((b) => {
        const t = TONE[b.tone];
        return (
          <View
            key={b.key}
            style={[styles.badge, { backgroundColor: t.bg }]}
            accessibilityLabel={`${b.label} ${t.a11y}${b.detail ? `, ${b.detail}` : ''}`}
            testID={`belge-okut-rozet-${w.workOrderNumber}-${b.key}`}
          >
            <Icon source={t.icon} size={18} color={t.fg} />
            <Text style={[styles.badgeLabel, { color: t.fg }]}>{b.label}</Text>
            {b.detail ? <Text style={[styles.badgeDetail, { color: t.fg }]}>{b.detail}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  score: { backgroundColor: colors.warningContainer, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  scoreText: { color: colors.warningText, fontSize: typography.size.xl, fontWeight: typography.weight.bold },
  badge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  badgeLabel: { fontSize: typography.size.base, fontWeight: typography.weight.semibold },
  badgeDetail: { fontSize: typography.size.sm },
});
