// Taleplerim satırı + Türkçe durum rozeti.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';

import { colors, radius, spacing } from '../../theme';
import type { DestekDurum, DestekTicketRow } from '../../services/destek.service';
import { formatRelativeWait } from '../../utils/relativeTime';
import TruncatedText from '../../components/TruncatedText';
import { STATUS_TONE, durumEtiketi, TUR_ETIKET, type StatusTone } from './destekMetin';

const TON_RENGI: Record<StatusTone, { bg: string; fg: string }> = {
  info: { bg: colors.infoContainer, fg: colors.infoText },
  warning: { bg: colors.warningContainer, fg: colors.warningText },
  success: { bg: colors.successContainer, fg: colors.successText },
  muted: { bg: colors.surfaceSunken, fg: colors.textSecondary },
};

export function StatusBadge({ durum }: { durum: DestekDurum }) {
  const ton = TON_RENGI[STATUS_TONE[durum] ?? 'muted'];
  return (
    <View style={[styles.rozet, { backgroundColor: ton.bg }]}>
      <Text style={[styles.rozetMetin, { color: ton.fg }]}>{durumEtiketi(durum)}</Text>
    </View>
  );
}

export default function TicketRow({
  t,
  talepEdeniGoster,
  onPress,
}: {
  t: DestekTicketRow;
  talepEdeniGoster: boolean;
  onPress: () => void;
}) {
  const okunmamis = t.unreadReplies > 0;
  return (
    <TouchableRipple onPress={onPress} style={styles.satir} accessibilityLabel={`${t.number} ${t.subject}`}>
      <View style={styles.ic}>
        <View style={styles.ust}>
          {okunmamis ? <View style={styles.nokta} accessibilityLabel="Okunmamış yanıt" /> : null}
          <Text style={styles.no}>{t.number}</Text>
          <Text style={styles.tur}>{TUR_ETIKET[t.type] ?? t.type}</Text>
          <View style={styles.bosluk} />
          <StatusBadge durum={t.status} />
        </View>
        <Text style={[styles.konu, okunmamis && styles.konuKalin]} numberOfLines={2}>
          {t.subject}
        </Text>
        <TruncatedText style={styles.alt}>
          {['Son hareket: ', formatRelativeWait(t.lastActivityAt), talepEdeniGoster && t.requester ? ` · ${t.requester.name}` : '']}
        </TruncatedText>
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  satir: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    minHeight: 72,
  },
  ic: { padding: spacing.md, gap: spacing.xs },
  ust: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nokta: { width: 10, height: 10, borderRadius: radius.full, backgroundColor: colors.danger },
  no: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
  tur: { fontSize: 13, color: colors.textMuted },
  bosluk: { flex: 1 },
  konu: { fontSize: 16, color: colors.text },
  konuKalin: { fontWeight: '700' },
  alt: { fontSize: 13, color: colors.textMuted },
  rozet: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  rozetMetin: { fontSize: 12, fontWeight: '700' },
});
