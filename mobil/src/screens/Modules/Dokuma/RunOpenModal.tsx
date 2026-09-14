// =============================================================================
// KOŞUM AÇ — iş emri (opsiyonel) · desen/renk (işten ön-dolu, kilitli değil) · hedef devir
// =============================================================================
import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, TouchableRipple, ActivityIndicator } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import AppModal from '../../../components/AppModal';
import NumpadInput from '../../../components/NumpadInput';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import { useTruncationWarning } from '../../../hooks/useTruncationWarning';
import { itemService } from '../../../services/item.service';
import { colorService } from '../../../services/color.service';
import { colors, spacing, radius, typography } from '../../../theme';
import { prefillFromOrder } from './runPayload';
import type { RunPanelState } from './useRunPanel';

type PickerKind = 'order' | 'item' | 'color' | null;

function useOrderOptions(state: RunPanelState): PickerOption[] {
  return useMemo(
    () =>
      state.orders.map((o) => ({
        value: o.id,
        label: o.weavingOrderNumber,
        sublabel: `${o.item.name}${o.color ? ` · ${o.color.name}` : ''}`,
        details: o.plannedM != null ? [`Hedef ${o.plannedM} m`] : ['Açık uçlu'],
        badge: { text: o.status === 'IN_PROGRESS' ? 'Devam' : 'Plan', color: o.status === 'IN_PROGRESS' ? colors.success : colors.info },
      })),
    [state.orders]
  );
}

function Field({ label, value, placeholder, onPress }: { label: string; value: string; placeholder: string; onPress: () => void }) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TouchableRipple onPress={onPress} style={styles.field} accessibilityRole="button">
        <Text style={value ? styles.fieldText : styles.fieldPlaceholder}>{value || placeholder}</Text>
      </TouchableRipple>
    </View>
  );
}

export default function RunOpenModal({ state }: { state: RunPanelState }) {
  const [picker, setPicker] = useState<PickerKind>(null);
  const orderOptions = useOrderOptions(state);
  const itemsQuery = useQuery({
    queryKey: ['items', 'dokuma', 'FABRIC'],
    queryFn: () => itemService.getAll({ page: 1, pageSize: 500, sortBy: 'code', sortOrder: 'asc', filters: { isActive: 'true', itemType: 'FABRIC' } }),
    enabled: picker === 'item',
    staleTime: 5 * 60_000,
  });
  const colorsQuery = useQuery({
    queryKey: ['colors', 'dokuma'],
    queryFn: () => colorService.listPublicForPicker({ pageSize: 500, sortBy: 'name', sortOrder: 'asc' }),
    enabled: picker === 'color',
    staleTime: 5 * 60_000,
  });
  useTruncationWarning(itemsQuery.data?.pagination, 'Desen');
  useTruncationWarning(colorsQuery.data?.pagination, 'Renk');
  const itemOptions: PickerOption[] = (itemsQuery.data?.data ?? []).map((i) => ({ value: i.id, label: i.name, sublabel: i.code }));
  const colorOptions: PickerOption[] = (colorsQuery.data?.data ?? []).map((c) => ({ value: c.id, label: c.name, sublabel: c.code }));
  const f = state.form;
  const orderLabel = state.orders.find((o) => o.id === f.weavingOrderId)?.weavingOrderNumber ?? '';

  return (
    <AppModal visible={state.openModal} onDismiss={() => state.setOpenModal(false)} position="center">
      <Text style={styles.title}>Koşum aç</Text>
      {state.ordersLoading ? <ActivityIndicator /> : null}
      {state.ordersError ? <Text style={styles.error}>İş emri listesi yüklenemedi — emirsiz koşum açılabilir.</Text> : null}
      <Field label="Dokuma işi (isteğe bağlı — numune koşumu meşru)" value={orderLabel} placeholder="İş emrisiz" onPress={() => setPicker('order')} />
      <Field label="Desen" value={f.itemLabel} placeholder="Seçilmedi" onPress={() => setPicker('item')} />
      <Field label="Renk" value={f.colorLabel} placeholder="Renk yok (ham)" onPress={() => setPicker('color')} />
      <Text style={styles.label}>Hedef devir (atkı/dk) — boş: makine tanımındaki yedek</Text>
      <NumpadInput value={f.targetPicksPerMin} onChangeText={(t) => state.setForm({ ...f, targetPicksPerMin: t })} allowDecimal={false} numpadMaxLength={5} numpadLabel="Hedef devir" placeholder="ör. 420" style={styles.input} />
      <View style={styles.actions}>
        <Button onPress={() => state.setOpenModal(false)} disabled={state.opening}>Vazgeç</Button>
        <Button mode="contained" onPress={state.submitOpen} loading={state.opening} disabled={state.opening}>Koşumu Aç</Button>
      </View>

      <PickerModal
        visible={picker === 'order'}
        title="Dokuma işi seç"
        options={orderOptions}
        selectedValue={f.weavingOrderId ?? ''}
        loading={state.ordersLoading}
        emptyText="Açık dokuma işi yok — emirsiz koşum açabilirsiniz."
        onDismiss={() => setPicker(null)}
        onSelect={(v) => {
          state.setForm(prefillFromOrder(f, state.orders.find((o) => o.id === v) ?? null));
          setPicker(null);
        }}
      />
      <PickerModal
        visible={picker === 'item'}
        title="Desen seç"
        options={itemOptions}
        selectedValue={f.itemId ?? ''}
        loading={itemsQuery.isLoading}
        onDismiss={() => setPicker(null)}
        onSelect={(v) => {
          state.setForm({ ...f, itemId: v, itemLabel: itemOptions.find((o) => o.value === v)?.label ?? '' });
          setPicker(null);
        }}
      />
      <PickerModal
        visible={picker === 'color'}
        title="Renk seç"
        options={colorOptions}
        selectedValue={f.colorId ?? ''}
        loading={colorsQuery.isLoading}
        onDismiss={() => setPicker(null)}
        onSelect={(v) => {
          state.setForm({ ...f, colorId: v, colorLabel: colorOptions.find((o) => o.value === v)?.label ?? '' });
          setPicker(null);
        }}
      />
    </AppModal>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text, marginBottom: spacing.sm },
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold, marginTop: spacing.sm },
  field: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface, minHeight: 48, justifyContent: 'center' },
  fieldText: { color: colors.text },
  fieldPlaceholder: { color: colors.textMuted },
  input: { backgroundColor: colors.surface },
  error: { color: colors.dangerText },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
});
