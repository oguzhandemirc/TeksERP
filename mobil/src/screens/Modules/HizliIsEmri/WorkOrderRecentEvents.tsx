import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { workOrderService } from '../../../services/workOrder.service';
import { colors, spacing } from '../../../theme';

/**
 * İş emrinin son 5 hareketi — salt-okunur özet (kullanıcı kararı S9). Tam liste,
 * arama ve Excel panelde. Satır başlığı sunucudan hazır gelir; "hata" ile
 * "kayıt yok" ayrı cümlelerdir.
 */
export default function WorkOrderRecentEvents({ workOrderId }: { workOrderId: string }) {
  const q = useQuery({
    queryKey: ['work-order-events', workOrderId, 5],
    queryFn: () => workOrderService.getRecentEvents(workOrderId, 5),
  });
  const rows = q.data ?? [];
  return (
    <View style={styles.section} testID="son-hareketler">
      <Text style={styles.title}>Son Hareketler</Text>
      {q.isLoading ? (
        <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.md }} />
      ) : q.isError ? (
        <Text style={styles.error}>Hareketler yüklenemedi — bu "hareket yok" demek değil.</Text>
      ) : rows.length === 0 ? (
        <Text style={styles.muted}>Kayıtlı hareket yok.</Text>
      ) : (
        rows.map((r) => (
          <View key={r.id} style={styles.line}>
            <Text style={styles.when}>{dayjs(r.at).format('DD.MM HH:mm')}</Text>
            <View style={styles.body}>
              <Text style={styles.head} numberOfLines={1}>
                {r.title}
                {r.detail ? ` · ${r.detail}` : ''}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {[r.actor, r.channel, r.trigger].filter(Boolean).join(' · ')}
                {r.reason ? ` · Sebep: ${r.reason}` : ''}
              </Text>
            </View>
          </View>
        ))
      )}
      <Text style={styles.hint}>Tam liste ve Excel: panel → İş Emri Hareketleri</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.md },
  title: { fontSize: 13, fontWeight: '800', color: colors.textSecondary, marginBottom: spacing.xs },
  line: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  when: { width: 84, fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  body: { flex: 1 },
  head: { fontSize: 13, fontWeight: '700', color: colors.text },
  meta: { fontSize: 11, color: colors.textMuted },
  muted: { fontSize: 12, color: colors.textMuted },
  error: { fontSize: 12, color: colors.dangerDark, fontWeight: '700' },
  hint: { fontSize: 11, color: colors.textMuted, marginTop: spacing.xs },
});
