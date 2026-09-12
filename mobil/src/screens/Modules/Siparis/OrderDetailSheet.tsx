import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { isMeasuredUnit, unitLabel } from '../../../lib/item-unit';
import { Surface, Text, Button, Divider } from 'react-native-paper';
import dayjs from 'dayjs';

import AppModal from '../../../components/AppModal';
import type { Order } from '../../../types/models';
import { ORDER_STATUS_LABEL, ORDER_STATUS_COLOR, trLabel } from '../../../utils/labels';
import { colors, spacing, radius } from '../../../theme';
import { num, orderTotals } from './OrderListView';

// =============================================================================
// Sipariş detayı — SALT OKUNUR. Veri listedeki satırdan gelir (backend
// `defaultInclude` customer + branch + lines'ı zaten taşıyor), ek istek YOK.
//
// Düzenleme/iptal aksiyonu BİLİNÇLİ olarak yok: `mobile:siparis` yalnız okur ve
// yaratır (bkz. Teks-Erp/scripts/test_mobile_order_permission.ts). Buraya bir
// "Düzenle" tuşu eklemek önce o izin kararını değiştirmeyi gerektirir — aksi
// halde tuş sahada 403 verir.
// =============================================================================

interface Props {
  order: Order | null;
  onClose: () => void;
}

export default function OrderDetailSheet({ order, onClose }: Props) {
  const totals = order ? orderTotals(order) : null;
  const statusColor = order ? (ORDER_STATUS_COLOR[order.status] ?? colors.textMuted) : colors.textMuted;

  return (
    <AppModal visible={order !== null} onDismiss={onClose} position="center" contentStyle={styles.wrap}>
      <Surface style={styles.sheet} elevation={4}>
        {order && totals && (
          <>
            <View style={styles.header}>
              <View style={styles.headerCol}>
                <Text style={styles.orderNo}>{order.orderNumber}</Text>
                <Text style={styles.customer} numberOfLines={2}>
                  {order.customer?.name ?? '—'}
                  {order.branch?.name ? ` · ${order.branch.name}` : ''}
                </Text>
              </View>
              <View style={[styles.statusChip, { backgroundColor: statusColor }]}>
                <Text style={styles.statusChipText}>{trLabel(ORDER_STATUS_LABEL, order.status)}</Text>
              </View>
            </View>

            <View style={styles.metaRow}>
              <Meta label="Sipariş" value={dayjs(order.orderDate ?? order.createdAt).format('DD.MM.YYYY')} />
              <Meta
                label="Termin"
                value={order.deadline ? dayjs(order.deadline).format('DD.MM.YYYY') : '—'}
              />
              <Meta label="Kalem" value={String(order.lines?.length ?? 0)} />
            </View>

            <Divider style={styles.divider} />

            <ScrollView style={styles.scroll}>
              {(order.lines ?? []).map((l, i) => {
                const q = num(l.quantity);
                const s = num(l.shippedQty);
                return (
                  <View key={l.id} style={styles.lineRow}>
                    <View style={styles.lineCol}>
                      <Text style={styles.lineTitle} numberOfLines={1}>
                        {i + 1}. {l.item?.name ?? '—'}
                      </Text>
                      <Text style={styles.lineSub} numberOfLines={1}>
                        {l.color?.name ?? 'Ham (renksiz)'}
                        {l.width != null ? ` · ${num(l.width)} cm` : ''}
                      </Text>
                    </View>
                    <View style={styles.lineQtyCol}>
                      <Text style={styles.lineQty}>{q.toLocaleString('tr-TR')} {unitLabel(l.unit)}</Text>
                      {!isMeasuredUnit(l.unit) && (
                        <Text style={styles.lineShipped}>karşılama ölçülmüyor</Text>
                      )}
                      {s > 0 && (
                        <Text style={styles.lineShipped}>
                          sevk {s.toLocaleString('tr-TR')} · açık{' '}
                          {Math.max(0, q - s).toLocaleString('tr-TR')}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <Divider style={styles.divider} />

            {/* Sözleşme: "İstenen | Sevk | Açık" — rezerv YOK, düşüş yalnız sevkte. */}
            <View style={styles.totalRow}>
              <Total label="İstenen" value={totals.requested} tone={colors.text} />
              <Total label="Sevk" value={totals.shipped} tone={colors.successDark} />
              <Total label="Açık" value={totals.open} tone="#0f766e" />
            </View>

            <Button mode="contained" onPress={onClose} style={styles.closeBtn} contentStyle={styles.closeBtnInner}>
              Kapat
            </Button>
          </>
        )}
      </Surface>
    </AppModal>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaCell}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function Total({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <View style={styles.totalCell}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={[styles.totalValue, { color: tone }]}>{value.toLocaleString('tr-TR')} m</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Genişlik VERİLMEZ — center + contentStyle'da AppModal `min(ekran−32, 560)`
  // yazar. Buraya `alignSelf`/`width` koymak onu ezer ve kutuyu min-içeriğe
  // büzer (bkz. OrderLineSheet'teki uzun not).
  wrap: { maxHeight: '90%' },
  sheet: { width: '100%', borderRadius: radius.lg, padding: spacing.lg, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  headerCol: { flex: 1, minWidth: 0 },
  orderNo: { fontSize: 20, fontWeight: '900', color: colors.text },
  customer: { fontSize: 14, fontWeight: '600', color: colors.textSecondary, marginTop: 2 },
  statusChip: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  statusChipText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  metaRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  metaCell: { flex: 1, minWidth: 0 },
  metaLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, color: colors.textMuted },
  metaValue: { fontSize: 14, fontWeight: '600', color: colors.text },
  divider: { marginVertical: spacing.sm },
  scroll: { flexShrink: 1 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  lineCol: { flex: 1, minWidth: 0 },
  lineTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  lineSub: { fontSize: 12, color: colors.textSecondary },
  lineQtyCol: { alignItems: 'flex-end' },
  lineQty: { fontSize: 15, fontWeight: '800', color: colors.text },
  lineShipped: { fontSize: 11, color: colors.textMuted },
  totalRow: { flexDirection: 'row', gap: spacing.sm },
  totalCell: { flex: 1, minWidth: 0 },
  totalLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, color: colors.textMuted },
  totalValue: { fontSize: 16, fontWeight: '800' },
  closeBtn: { marginTop: spacing.md, borderRadius: radius.md },
  closeBtnInner: { height: 52 },
});
