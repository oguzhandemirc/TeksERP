// Dar/dikey ekranda (el terminali, telefon) yan panel yerine "Çek ve bitir"in üstünde TEK satır özet: "Okunan 3/5 · ✓ Fiş no
// · ⚠ Parti +2 ▲". Sayım ve işaretler `liveSummary`den (panel başlığıyla aynı model); dokununca alan paneli alt sayfada açılır.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../../../theme';
import { fitLiveStrip, liveProgress, liveStripItems, type LiveStripMark } from './liveSummary';
import type { LiveVoteState } from './liveVote';

type MarkIcon = 'check-circle' | 'lock' | 'timer-sand' | 'alert' | 'minus-circle-outline';
export const LIVE_STRIP_MARK: Record<LiveStripMark, { icon: MarkIcon; color: string; a11y: string }> = {
  read: { icon: 'check-circle', color: colors.success, a11y: 'okundu' },
  userLocked: { icon: 'lock', color: colors.success, a11y: 'elle kilitli' },
  reading: { icon: 'timer-sand', color: colors.textOnDarkMuted, a11y: 'okunuyor' },
  warn: { icon: 'alert', color: colors.warning, a11y: 'uyarı' },
  absent: { icon: 'minus-circle-outline', color: colors.textOnDarkMuted, a11y: 'belgede yok' },
};
// Sabit kısım ("Okunan 3/5", ▲, iç boşluk) ve ~14 px yazıda ortalama karakter genişliği.
const FIXED_PX = 150;
const CHAR_PX = 8;

export default function LiveSummaryStrip({ vote, width, onPress }: { vote: LiveVoteState; width: number; onPress: () => void }) {
  const { settled, total } = liveProgress(vote);
  const items = liveStripItems(vote);
  const { shown, hidden } = fitLiveStrip(items, Math.max(0, Math.floor((width - FIXED_PX) / CHAR_PX)));
  const a11y = `Okunan ${settled}/${total}. ${items.map((i) => `${i.label} ${LIVE_STRIP_MARK[i.mark].a11y}`).join(', ')}. Alanları aç`;
  return (
    <TouchableRipple onPress={onPress} style={[styles.strip, { width }]} accessibilityRole="button" accessibilityLabel={a11y} testID="canli-ozet-serit">
      <View style={styles.row}>
        <Text style={styles.count} testID="canli-ozet-sayi">{total ? `Okunan ${settled}/${total}` : 'Alanlar bekleniyor'}</Text>
        {shown.map((i) => (
          <View key={i.key} style={styles.item} testID={`canli-ozet-${i.key}-${i.mark}`}>
            <MaterialCommunityIcons name={LIVE_STRIP_MARK[i.mark].icon} size={16} color={LIVE_STRIP_MARK[i.mark].color} />
            <Text style={styles.label} numberOfLines={1}>{i.label}</Text>
          </View>
        ))}
        {hidden > 0 && <Text style={styles.more} testID="canli-ozet-fazla">+{hidden}</Text>}
        <MaterialCommunityIcons name="chevron-up" size={24} color={colors.textOnDark} style={styles.chevron} />
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  strip: { minHeight: 56, justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.scrim, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, overflow: 'hidden' },
  count: { color: colors.textOnDark, fontSize: 14, fontWeight: '800' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 1 },
  label: { color: colors.textOnDark, fontSize: 14, flexShrink: 1 },
  more: { color: colors.textOnDarkMuted, fontSize: 14, fontWeight: '700' },
  chevron: { marginLeft: 'auto' },
});
