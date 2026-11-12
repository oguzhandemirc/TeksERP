// Okutma ekranının üstü: özet şerit (N çuval · M top · X m · Y kg) + hedef/son olay satırı.
// Satır boşta okutmanın nereye gideceğini söyler; okutma olunca 4 sn olayı (kabul/taşıma/ret) gösterir.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import Animated, { FadeIn } from 'react-native-reanimated';
import type { HandheldLoadState } from '../../../../services/handheldShipment.service';
import { colors, durations, spacing, typography } from '../../../../theme';
import type { BannerTone } from './scanOutcome';
import { summaryMetrics } from './summary';
import { ACCENT, ACCENT_SOFT, ui } from './ui';

export function SummaryStrip({ summary }: { summary: HandheldLoadState['summary'] }) {
  return (
    <View style={[ui.card, styles.strip]} testID="sevk-ozet">
      {summaryMetrics(summary).map((m) => (
        <View key={m.key} style={styles.metric}>
          <Text style={ui.figure} numberOfLines={1} adjustsFontSizeToFit>
            {m.value}
          </Text>
          <Text style={ui.secondary}>{m.unit}</Text>
        </View>
      ))}
    </View>
  );
}

const TONE: Record<BannerTone, { bg: string; fg: string; icon: string }> = {
  ok: { bg: colors.successContainer, fg: colors.successText, icon: 'check-circle' },
  info: { bg: colors.infoContainer, fg: colors.infoText, icon: 'swap-horizontal' },
  error: { bg: colors.dangerContainer, fg: colors.dangerText, icon: 'close-circle' },
};

interface LineProps {
  banner: { tone: BannerTone; text: string; id: number } | null;
  /** Boşta gösterilen hedef ("Çuvalsız" ya da çuval no). */
  target: string;
  targetIsSack: boolean;
}

export function ScanLine({ banner, target, targetIsSack }: LineProps) {
  if (banner) {
    const t = TONE[banner.tone];
    return (
      <Animated.View key={banner.id} entering={FadeIn.duration(durations.fast)} style={[styles.line, { backgroundColor: t.bg }]} testID="sevk-olay">
        <Icon source={t.icon} size={20} color={t.fg} />
        <Text style={[styles.lineText, { color: t.fg }]} numberOfLines={1}>
          {banner.text}
        </Text>
      </Animated.View>
    );
  }
  return (
    <View style={[styles.line, { backgroundColor: targetIsSack ? ACCENT_SOFT : colors.surfaceMuted }]} testID="sevk-hedef">
      <Icon source="barcode-scan" size={20} color={targetIsSack ? ACCENT : colors.textSecondary} />
      <Text style={[styles.lineText, { color: targetIsSack ? ACCENT : colors.textSecondary }]} numberOfLines={1}>
        Okut → {target}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
  metric: { flex: 1, alignItems: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: 12 },
  lineText: { flex: 1, fontSize: typography.size.sm, fontWeight: typography.weight.bold },
});
