import React, { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, TouchableRipple, Icon, Button } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';

import AppModal from '../../../components/AppModal';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import { customerService } from '../../../services/customer.service';
import { itemService } from '../../../services/item.service';
import { colorService } from '../../../services/color.service';
import { useTruncationWarning } from '../../../hooks/useTruncationWarning';
import { colors, spacing, radius } from '../../../theme';

export interface OrderLineFilters {
  customerId: string | null;
  itemId: string | null;
  colorId: string | null;
}

export const EMPTY_ORDER_LINE_FILTERS: OrderLineFilters = {
  customerId: null,
  itemId: null,
  colorId: null,
};

export const activeFilterCount = (f: OrderLineFilters): number =>
  [f.customerId, f.itemId, f.colorId].filter(Boolean).length;

interface Props {
  visible: boolean;
  onDismiss: () => void;
  value: OrderLineFilters;
  onApply: (f: OrderLineFilters) => void;
  /** Toplar okutulduysa kumaş siparişten değil TOPLARDAN kilitlidir → alan gizlenir. */
  itemLocked?: boolean;
}

/**
 * Sipariş kalemi listesinin detaylı filtresi — müşteri / kumaş / renk.
 *
 * Filtreler BACKEND'e gider (`customerId`/`itemId`/`colorId` sorgu parametreleri),
 * yüklü sayfada istemci-içi süzme YAPILMAZ; aksi halde yalnız o ana kadar
 * indirilen 20-40 satır filtrelenir ve operatör "kayıt yok" sanırdı.
 *
 * Taslak state ile çalışır: seçimler "Uygula"ya basılana kadar sorguyu tetiklemez
 * (her dokunuşta yeni istek atmasın).
 */
export default function OrderLineFilterSheet({
  visible,
  onDismiss,
  value,
  onApply,
  itemLocked,
}: Props) {
  const [draft, setDraft] = useState<OrderLineFilters>(value);
  const [openPicker, setOpenPicker] = useState<'customer' | 'item' | 'color' | null>(null);

  // Taslağı her açılışta dışarıdaki gerçek filtreyle eşitle.
  const [syncedFor, setSyncedFor] = useState(false);
  if (visible && !syncedFor) {
    setDraft(value);
    setSyncedFor(true);
  }
  if (!visible && syncedFor) setSyncedFor(false);

  const customersQuery = useQuery({
    queryKey: ['customers', 'order-filter'],
    queryFn: () =>
      customerService.getAll({ page: 1, pageSize: 300, sortBy: 'name', sortOrder: 'asc' }),
    enabled: visible,
    staleTime: 10 * 60 * 1000,
  });
  const itemsQuery = useQuery({
    queryKey: ['items', 'order-filter'],
    queryFn: () => itemService.getAll({ page: 1, pageSize: 300, sortBy: 'name', sortOrder: 'asc' }),
    enabled: visible && !itemLocked,
    staleTime: 10 * 60 * 1000,
  });
  const colorsQuery = useQuery({
    queryKey: ['colors', 'order-filter'],
    queryFn: () =>
      colorService.getAll({ page: 1, pageSize: 300, sortBy: 'name', sortOrder: 'asc' }),
    enabled: visible,
    staleTime: 10 * 60 * 1000,
  });

  // Üç katalog da tek atış (pageSize 300) — tavan aşılırsa liste sessizce kırpılır
  // ve operatör "müşterim/kumaşım listede yok" der; uyarı kırpmayı görünür yapar.
  useTruncationWarning(customersQuery.data?.pagination, 'Müşteri');
  useTruncationWarning(itemsQuery.data?.pagination, 'Kumaş');
  useTruncationWarning(colorsQuery.data?.pagination, 'Renk');

  const customerOptions: PickerOption[] = useMemo(
    () => (customersQuery.data?.data ?? []).map((c) => ({ value: c.id, label: c.name, sublabel: c.code ?? undefined })),
    [customersQuery.data],
  );
  const itemOptions: PickerOption[] = useMemo(
    () => (itemsQuery.data?.data ?? []).map((i) => ({ value: i.id, label: i.name, sublabel: i.code ?? undefined })),
    [itemsQuery.data],
  );
  const colorOptions: PickerOption[] = useMemo(
    () =>
      (colorsQuery.data?.data ?? []).map((c) => ({
        value: c.id,
        label: c.name,
        sublabel: c.code ?? undefined,
        badge: c.hex ? { text: ' ', color: c.hex } : undefined,
      })),
    [colorsQuery.data],
  );

  const labelOf = (opts: PickerOption[], id: string | null) =>
    id ? (opts.find((o) => o.value === id)?.label ?? '—') : null;

  // Tek nesne parametresi: çağrı yerinde altı konumlu argümanın hangisinin ne
  // olduğu okunmuyordu (`max-params` kapısı da bunu ölçer).
  const row = ({
    key,
    label,
    icon,
    selected,
    opts,
    clear,
  }: {
    key: 'customer' | 'item' | 'color';
    label: string;
    icon: string;
    selected: string | null;
    opts: PickerOption[];
    clear: () => void;
  }) => (
    <View>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.rowGap}>
        <TouchableRipple
          onPress={() => setOpenPicker(key)}
          style={styles.field}
          borderless
          rippleColor="rgba(79,70,229,0.12)"
        >
          <View style={styles.fieldInner}>
            <Icon source={icon} size={20} color={colors.textSecondary} />
            <Text style={[styles.fieldText, !selected && styles.placeholder]} numberOfLines={1}>
              {labelOf(opts, selected) ?? 'Hepsi'}
            </Text>
          </View>
        </TouchableRipple>
        {selected ? (
          <TouchableRipple onPress={clear} style={styles.clearBtn} borderless>
            <Text style={styles.clearText}>Temizle</Text>
          </TouchableRipple>
        ) : null}
      </View>
    </View>
  );

  return (
    <AppModal visible={visible} onDismiss={onDismiss} position="bottom" contentStyle={styles.sheet}>
      <View style={styles.header}>
        <Text style={styles.title}>Detaylı Filtre</Text>
        <TouchableRipple onPress={onDismiss} borderless style={styles.closeBtn}>
          <Icon source="close" size={24} color={colors.textSecondary} />
        </TouchableRipple>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {row({
          key: 'customer',
          label: 'Müşteri',
          icon: 'account-tie',
          selected: draft.customerId,
          opts: customerOptions,
          clear: () => setDraft((d) => ({ ...d, customerId: null })),
        })}
        {itemLocked ? (
          <View style={styles.lockedNote}>
            <Icon source="lock" size={14} color={colors.textMuted} />
            <Text style={styles.lockedNoteText}>
              Kumaş okutulan toplardan kilitli — filtrelenemez.
            </Text>
          </View>
        ) : (
          row({
            key: 'item',
            label: 'Kumaş',
            icon: 'cube-outline',
            selected: draft.itemId,
            opts: itemOptions,
            clear: () => setDraft((d) => ({ ...d, itemId: null })),
          })
        )}
        {row({
          key: 'color',
          label: 'Renk',
          icon: 'palette',
          selected: draft.colorId,
          opts: colorOptions,
          clear: () => setDraft((d) => ({ ...d, colorId: null })),
        })}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          mode="outlined"
          onPress={() => setDraft(EMPTY_ORDER_LINE_FILTERS)}
          style={styles.footerBtn}
          contentStyle={styles.footerBtnContent}
        >
          Sıfırla
        </Button>
        <Button
          mode="contained"
          onPress={() => {
            onApply(draft);
            onDismiss();
          }}
          style={styles.footerBtn}
          contentStyle={styles.footerBtnContent}
        >
          Uygula
        </Button>
      </View>

      <PickerModal
        visible={openPicker === 'customer'}
        title="Müşteri Seç"
        options={customerOptions}
        selectedValue={draft.customerId}
        loading={customersQuery.isLoading}
        onSelect={(v) => setDraft((d) => ({ ...d, customerId: v }))}
        onDismiss={() => setOpenPicker(null)}
        onRefresh={() => customersQuery.refetch()}
        emptyText="Müşteri bulunamadı"
      />
      <PickerModal
        visible={openPicker === 'item'}
        title="Kumaş Seç"
        options={itemOptions}
        selectedValue={draft.itemId}
        loading={itemsQuery.isLoading}
        onSelect={(v) => setDraft((d) => ({ ...d, itemId: v }))}
        onDismiss={() => setOpenPicker(null)}
        onRefresh={() => itemsQuery.refetch()}
        emptyText="Kumaş bulunamadı"
      />
      <PickerModal
        visible={openPicker === 'color'}
        title="Renk Seç"
        options={colorOptions}
        selectedValue={draft.colorId}
        loading={colorsQuery.isLoading}
        onSelect={(v) => setDraft((d) => ({ ...d, colorId: v }))}
        onDismiss={() => setOpenPicker(null)}
        onRefresh={() => colorsQuery.refetch()}
        emptyText="Renk bulunamadı"
      />
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    width: '100%',
    maxHeight: '80%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.text },
  closeBtn: { padding: spacing.xs, borderRadius: radius.full },
  body: { padding: spacing.lg, gap: spacing.sm },
  label: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 2 },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  field: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  fieldInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 14 },
  fieldText: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '600' },
  placeholder: { color: colors.textMuted, fontWeight: '400' },
  clearBtn: { paddingHorizontal: spacing.sm, paddingVertical: 12 },
  clearText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  lockedNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
  lockedNoteText: { flex: 1, fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerBtn: { flex: 1, borderRadius: radius.md },
  footerBtnContent: { height: 48 },
});
