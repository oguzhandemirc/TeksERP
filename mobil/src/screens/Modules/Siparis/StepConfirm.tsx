import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Surface, Icon, Divider } from 'react-native-paper';
import dayjs from 'dayjs';

import { colors, spacing, radius } from '../../../theme';
import type { NewOrderState } from './useNewOrder';

// =============================================================================
// ③ ONAY — gönderilecek şeyin tamamı tek ekranda. Bu adımın varlık sebebi
// "yanlış müşteriye sipariş açma" hatasını SON dokunuştan önce yakalamaktır;
// o yüzden müşteri en üstte ve en büyük yazıdır.
// =============================================================================

interface Props {
  state: NewOrderState;
  branchesEnabled: boolean;
  online: boolean;
}

export default function StepConfirm({ state, branchesEnabled, online }: Props) {
  const deadlineText =
    state.deadlineDays == null
      ? 'Sistem varsayılanı'
      : `${dayjs().add(state.deadlineDays, 'day').format('DD.MM.YYYY')} (${state.deadlineDays} gün)`;

  // Sipariş açıldı — artık özet değil SONUÇ gösterilir.
  if (state.result) {
    return (
      <ScrollView contentContainerStyle={styles.body}>
        <Surface style={styles.doneCard} elevation={1}>
          <Icon source="check-circle" size={48} color={colors.successDark} />
          <Text style={styles.doneTitle}>Sipariş açıldı</Text>
          <Text style={styles.doneNumber}>{state.result.orderNumber}</Text>
          <Text style={styles.doneSub}>
            {state.customerName} · {state.lines.length} kalem ·{' '}
            {state.totalQty.toLocaleString('tr-TR')} m
          </Text>
        </Surface>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Surface style={styles.card} elevation={1}>
        <Text style={styles.label}>MÜŞTERİ</Text>
        <Text style={styles.customer}>{state.customerName}</Text>
        {branchesEnabled && state.branchName ? (
          <Text style={styles.branch}>Sevk noktası: {state.branchName}</Text>
        ) : null}
        <Divider style={styles.divider} />
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Termin</Text>
          <Text style={styles.metaValue}>{deadlineText}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Sipariş No</Text>
          <Text style={styles.metaValue}>Kaydederken otomatik verilir</Text>
        </View>
      </Surface>

      <Text style={styles.sectionLabel}>KALEMLER ({state.lines.length})</Text>
      <Surface style={styles.card} elevation={1}>
        {state.lines.map((l, i) => (
          <View key={l.clientId}>
            {i > 0 && <Divider style={styles.rowDivider} />}
            <View style={styles.lineRow}>
              <View style={styles.lineTextCol}>
                <Text style={styles.lineTitle} numberOfLines={1}>
                  {l.itemName}
                </Text>
                <Text style={styles.lineSub} numberOfLines={1}>
                  {l.colorName ?? 'Ham (renksiz)'}
                  {l.width != null ? ` · ${l.width} cm` : ''}
                </Text>
              </View>
              <Text style={styles.lineQty}>{l.quantity.toLocaleString('tr-TR')} m</Text>
            </View>
          </View>
        ))}
        <Divider style={styles.rowDivider} />
        <View style={styles.lineRow}>
          <Text style={styles.totalLabel}>TOPLAM</Text>
          <Text style={styles.totalValue}>{state.totalQty.toLocaleString('tr-TR')} m</Text>
        </View>
      </Surface>

      {!online && (
        <View style={styles.offlineBox}>
          <Icon source="wifi-off" size={18} color={colors.dangerText} />
          <Text style={styles.offlineText}>
            Çevrimdışısınız. Sipariş numarasını sunucu ürettiği için bu ekran çevrimdışı
            kaydedemez — bağlantı gelince tekrar deneyin.
          </Text>
        </View>
      )}

      {state.retrying && online && (
        <View style={styles.retryBox}>
          <Icon source="information-outline" size={18} color={colors.infoText} />
          <Text style={styles.retryText}>
            Önceki deneme sonuçsuz kaldı. Tekrar gönderim aynı anahtarla yapılır — sipariş
            zaten açıldıysa ikinci bir kayıt oluşmaz.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.md, paddingBottom: spacing.xl },
  card: {
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  label: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, color: colors.textMuted },
  customer: { fontSize: 22, fontWeight: '800', color: colors.text },
  branch: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  divider: { marginVertical: spacing.sm },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, gap: spacing.sm },
  metaLabel: { fontSize: 13, color: colors.textMuted },
  metaValue: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '600', color: colors.text, textAlign: 'right' },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  rowDivider: { marginVertical: 0 },
  lineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.sm },
  lineTextCol: { flex: 1, minWidth: 0 },
  lineTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  lineSub: { fontSize: 12, color: colors.textSecondary },
  lineQty: { fontSize: 15, fontWeight: '800', color: colors.text },
  totalLabel: { flex: 1, fontSize: 13, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.4 },
  totalValue: { fontSize: 18, fontWeight: '800', color: colors.brandDark },
  offlineBox: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.dangerContainer,
  },
  offlineText: { flex: 1, minWidth: 0, fontSize: 12, color: colors.dangerText, lineHeight: 17 },
  retryBox: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.infoContainer,
  },
  retryText: { flex: 1, minWidth: 0, fontSize: 12, color: colors.infoText, lineHeight: 17 },
  doneCard: {
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
  },
  doneTitle: { fontSize: 16, fontWeight: '700', color: colors.textSecondary },
  doneNumber: { fontSize: 26, fontWeight: '900', color: colors.text, letterSpacing: 0.5 },
  doneSub: { fontSize: 13, color: colors.textSecondary, textAlign: 'center' },
});
