// Gelen kutusu satırı: büyük dokunma alanı; "Okundu" ve "1 saat ertele" düğmeyle (kaydırma yok).
// ALARM satırı ertelenmez (panel ile aynı); tıklama tablet rotası varsa oraya götürür.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, TouchableRipple } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import { useQueryClient } from '@tanstack/react-query';
import { bildirimApi } from '../../services/bildirim/bildirimApi';
import { formatFactory } from '../../lib/factory-time';
import { INBOX_KEY } from '../../services/bildirim/keys';
import type { InboxItem } from '../../services/bildirim/types';
import { colors, radius, spacing } from '../../theme';

export function useInboxAction(item: InboxItem) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<'read' | 'snooze' | null>(null);
  const run = async (kind: 'read' | 'snooze') => {
    setBusy(kind);
    try {
      await (kind === 'read' ? bildirimApi.markRead(item.id) : bildirimApi.snooze(item.id));
      await qc.invalidateQueries({ queryKey: INBOX_KEY });
    } catch {
      Toast.show({ type: 'error', text1: 'İşlem yapılamadı', text2: 'Bağlantı gelince yeniden deneyin.' });
    } finally {
      setBusy(null);
    }
  };
  return { busy, markRead: () => void run('read'), snooze: () => void run('snooze') };
}

export default function InboxRow({ item, onOpen }: { item: InboxItem; onOpen?: (item: InboxItem) => void }) {
  const a = useInboxAction(item);
  const unread = !item.okunduAn;
  const canOpen = !!onOpen && item.tabletRota === 'UyariDetay' && !!item.konu.id;
  return (
    <View style={[styles.root, unread && styles.unread]} testID={`kutu-satir-${item.id}`}>
      <TouchableRipple onPress={canOpen ? () => onOpen?.(item) : undefined} disabled={!canOpen} style={styles.body}>
        <View>
          <Text style={styles.title} numberOfLines={2}>
            {item.sayac > 1 ? `${item.baslik} (${item.sayac})` : item.baslik}
          </Text>
          {!!item.govde && <Text style={styles.text} numberOfLines={3}>{item.govde}</Text>}
          <Text style={styles.meta}>
            {formatFactory(item.sonAn, 'dd.MM HH:mm')}
            {item.cozulduAn ? ' · çözüldü' : ''}
          </Text>
        </View>
      </TouchableRipple>
      <View style={styles.actions}>
        {unread && (
          <Button mode="contained-tonal" onPress={a.markRead} loading={a.busy === 'read'} disabled={a.busy !== null} contentStyle={styles.tall}>
            Okundu
          </Button>
        )}
        {item.sinif === 'BILDIRIM' && !item.cozulduAn && (
          <Button mode="outlined" onPress={a.snooze} loading={a.busy === 'snooze'} disabled={a.busy !== null} contentStyle={styles.tall}>
            1 saat ertele
          </Button>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  unread: { backgroundColor: colors.infoContainer, borderRadius: radius.sm },
  body: { minHeight: 56, justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  text: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  tall: { minHeight: 48 },
});
