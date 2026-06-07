import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Icon, ActivityIndicator } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import AppModal from '../../../components/AppModal';
import { orderService, type AvailableOrderLine } from '../../../services/order.service';
import { colors, spacing, radius } from '../../../theme';

interface Props {
  /** Okutulan topların ürünü — sipariş kalemleri buna göre filtrelenir. */
  itemId: string | null;
  value: string[];
  onChange: (lineIds: string[]) => void;
}

// Gelişmiş modda "iş emrini siparişe bağla" — itemId'ye uyan açık kalemleri
// çoklu seçtirir. Seçim varsa quickStart ORDER_PRODUCTION olur.
export default function OrderLinkPicker({ itemId, value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const q = useQuery({
    queryKey: ['available-order-lines', itemId],
    queryFn: () => orderService.getAvailableOrderLines({ itemId: itemId as string }),
    enabled: open && !!itemId,
    staleTime: 60 * 1000,
  });

  const lines = q.data?.data ?? [];
  const selectedLines = useMemo(
    () => lines.filter((l) => value.includes(l.lineId)),
    [lines, value],
  );

  const toggle = (lineId: string) => {
    onChange(value.includes(lineId) ? value.filter((id) => id !== lineId) : [...value, lineId]);
  };

  const renderRow = ({ item }: { item: AvailableOrderLine }) => {
    const checked = value.includes(item.lineId);
    return (
      <TouchableRipple onPress={() => toggle(item.lineId)} style={styles.row} borderless>
        <View style={styles.rowInner}>
          <Icon
            source={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
            size={24}
            color={checked ? colors.brand : colors.textMuted}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.orderNumber} · {item.customerName}
            </Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              {item.customerItemName ?? item.itemName}
              {item.colorName ? ` · ${item.colorName}` : ''}
              {item.width != null ? ` · ${item.width}cm` : ''}
            </Text>
          </View>
          <Text style={styles.openQty}>Açık: {Math.round(item.openQty)}m</Text>
        </View>
      </TouchableRipple>
    );
  };

  return (
    <View>
      <Text style={styles.label}>Sipariş Bağla (opsiyonel)</Text>
      <TouchableRipple
        onPress={() => setOpen(true)}
        disabled={!itemId}
        style={[styles.trigger, !itemId && styles.triggerDisabled]}
        borderless
        rippleColor="rgba(79,70,229,0.12)"
      >
        <View style={styles.triggerInner}>
          <Icon source="link-variant" size={18} color={colors.brand} />
          <Text style={styles.triggerText}>
            {value.length > 0 ? `${value.length} sipariş kalemi bağlı` : itemId ? 'Sipariş seç' : 'Önce top okut'}
          </Text>
        </View>
      </TouchableRipple>

      {selectedLines.length > 0 ? (
        <View style={styles.chips}>
          {selectedLines.map((l) => (
            <TouchableRipple key={l.lineId} onPress={() => toggle(l.lineId)} style={styles.chip} borderless>
              <View style={styles.chipInner}>
                <Text style={styles.chipText} numberOfLines={1}>
                  {l.orderNumber}
                </Text>
                <Icon source="close" size={14} color={colors.brand} />
              </View>
            </TouchableRipple>
          ))}
        </View>
      ) : null}

      <AppModal visible={open} onDismiss={() => setOpen(false)} position="bottom" contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Sipariş Kalemi Seç</Text>
          <TouchableRipple onPress={() => setOpen(false)} borderless style={styles.doneBtn}>
            <Text style={styles.doneText}>Tamam ({value.length})</Text>
          </TouchableRipple>
        </View>
        {q.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : lines.length === 0 ? (
          <Text style={styles.empty}>Bu ürüne uyan açık sipariş kalemi yok.</Text>
        ) : (
          <View style={{ height: 360 }}>
            <FlashList data={lines} keyExtractor={(l) => l.lineId} renderItem={renderRow} />
          </View>
        )}
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 2 },
  trigger: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  triggerDisabled: { opacity: 0.5 },
  triggerInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  triggerText: { fontSize: 15, color: colors.text, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: { backgroundColor: colors.brandSoft, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chipText: { color: colors.brand, fontWeight: '700', fontSize: 12, maxWidth: 140 },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  doneBtn: { backgroundColor: colors.brand, borderRadius: radius.full, paddingHorizontal: spacing.lg, paddingVertical: 8 },
  doneText: { color: '#fff', fontWeight: '700' },
  center: { padding: spacing.xxl, alignItems: 'center' },
  empty: { textAlign: 'center', color: colors.textMuted, padding: spacing.xl },
  row: { borderRadius: radius.sm },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10, paddingHorizontal: spacing.sm },
  rowTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  openQty: { fontSize: 12, fontWeight: '700', color: colors.success },
});
