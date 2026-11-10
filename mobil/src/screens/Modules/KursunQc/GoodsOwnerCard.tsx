// "Malın sahibi" (GK 2026-11-11): seçili topun sahibi carisi — cetvelin üstünde kompakt satır. Sunucu `goodsOwner`
// göndermezse (eski backend / sahip bilinmiyor) satır hiç çizilmez; uydurma metin yok.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import TruncatedText from '../../../components/TruncatedText';
import { colors, radius, spacing, typography } from '../../../theme/tokens';
import type { KursunRollSummary } from '../../../types/models';

export function goodsOwnerOf(roll: Pick<KursunRollSummary, 'goodsOwner'> | null | undefined): { name: string; consigned: boolean } | null {
  const o = roll?.goodsOwner;
  const name = o?.name?.trim();
  return o && name ? { name, consigned: o.consigned === true } : null;
}

export default function GoodsOwnerCard({ roll }: { roll: Pick<KursunRollSummary, 'goodsOwner'> | null | undefined }) {
  const owner = goodsOwnerOf(roll);
  if (!owner) return null;
  return (
    <View style={s.card} testID="kursun-mal-sahibi" accessibilityLabel={`Malın sahibi ${owner.name}${owner.consigned ? ', fason' : ''}`}>
      <Text style={s.label}>Malın sahibi</Text>
      <View style={s.nameWrap}>
        <TruncatedText style={s.name} testID="kursun-mal-sahibi-ad">{owner.name}</TruncatedText>
      </View>
      {owner.consigned && (
        <View style={s.badge} testID="kursun-mal-sahibi-fason">
          <Text style={s.badgeText}>Fason</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.sm,
    paddingHorizontal: spacing.lg,
    minHeight: 56,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  label: { fontSize: typography.size.sm, fontWeight: typography.weight.semibold, color: colors.textMuted },
  nameWrap: { flex: 1, minWidth: 0 },
  name: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, color: colors.text },
  badge: { backgroundColor: colors.surfaceMuted, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  badgeText: { fontSize: typography.size.xs, fontWeight: typography.weight.bold, color: colors.textSecondary },
});
