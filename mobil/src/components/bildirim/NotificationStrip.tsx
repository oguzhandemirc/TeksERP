// İstasyon şeridi: tablet kanalı açık, okunmamış KOSUL/OLAY satırı (sunucu süzgeci). Alarm şeridinin
// ALTINDA çizilir (ScreenChrome `topStrip` yuvası önce gelir). Bayrak kapalıyken hiçbir şey.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { useNotificationBell } from '../../hooks/useNotificationBell';
import { useStripItems } from '../../hooks/useInboxQueries';
import { useInboxAction } from './InboxRow';
import type { InboxItem } from '../../services/bildirim/types';
import { colors, spacing } from '../../theme';

export default function NotificationStrip() {
  const bell = useNotificationBell();
  const live = bell.ready && bell.supported && bell.enabled;
  const items = useStripItems(live);
  // Süzme sunucuda (okunmamış sekmesi ALARM'ı içermez; tablet kanalı/özet süzgeci parametrede).
  const lead = items[0];
  if (!live || !lead) return null;
  return <StripBody key={lead.id} item={lead} more={items.length - 1} />;
}

function StripBody({ item, more }: { item: InboxItem; more: number }) {
  const a = useInboxAction(item);
  return (
    <View style={styles.root} accessibilityRole="summary" testID="bildirim-serit">
      <Icon source="bell-alert" size={24} color={colors.warningText} />
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>{item.baslik}</Text>
        {!!item.govde && <Text style={styles.sub} numberOfLines={2}>{more > 0 ? `${item.govde} · +${more}` : item.govde}</Text>}
      </View>
      <Button mode="contained-tonal" onPress={a.markRead} loading={a.busy === 'read'} disabled={a.busy !== null} contentStyle={styles.tall}>
        Okundu
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.warningContainer },
  text: { flex: 1 },
  title: { fontSize: 16, fontWeight: '700', color: colors.warningText },
  sub: { fontSize: 13, color: colors.text },
  tall: { minHeight: 48 },
});
