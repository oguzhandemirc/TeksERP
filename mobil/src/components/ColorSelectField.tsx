import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';

import PickerModal, { type PickerOption } from './PickerModal';
import { colorService } from '../services/color.service';
import { useTruncationWarning } from '../hooks/useTruncationWarning';
import { colors, spacing, radius } from '../theme';

interface Props {
  value: string | null;
  onChange: (colorId: string | null) => void;
  /** Kilitli (ör. sipariş kaleminden gelen renk) — dokunma kapalı, zemin soluk. */
  disabled?: boolean;
  /** Renk adını dışarıdan dayat (sipariş kaleminden gelen ad) — public picker'da
   *  olmayan müşteri-özel renkte de doğru ad görünsün, round-trip beklenmesin. */
  labelOverride?: string | null;
  /** Çözümlenen ad üst bileşene bildirilir (özet satırları için). */
  onLabelResolved?: (label: string | null) => void;
  /** "Temizle" kısayolu gösterilsin mi (kilitliyken zaten gizlenir). */
  showClear?: boolean;
}

/**
 * Hedef renk seçici — public renk listesi + seçili rengin ad çözümü.
 *
 * `scope=public` → müşteriye ATANMIŞ (exclusive) renkler listelenmez; Hızlı İş
 * Emri stok üretimidir. Seçili renk public listede değilse (ör. sipariş kaleminden
 * gelen müşteri-özel renk) tek-renk fallback sorgusu adını çeker — yoksa alan
 * boş "seç" görünür ve operatör rengin kaybolduğunu sanır.
 *
 * Hızlı İş Emri sihirbazı ve iş emri düzeltme menüsü (Rengi Değiştir) ortak kullanır.
 */
export default function ColorSelectField({
  value,
  onChange,
  disabled,
  labelOverride,
  onLabelResolved,
  showClear = true,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const colorsQuery = useQuery({
    queryKey: ['colors', 'wo-picker-public'],
    queryFn: () =>
      colorService.listPublicForPicker({ page: 1, pageSize: 300, sortBy: 'name', sortOrder: 'asc' }),
    staleTime: 10 * 60 * 1000,
  });

  useTruncationWarning(colorsQuery.data?.pagination, 'Renk');

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

  const inPublicList = useMemo(
    () => colorOptions.some((o) => o.value === value),
    [colorOptions, value],
  );
  const fallbackColorQuery = useQuery({
    queryKey: ['color', value],
    queryFn: () => colorService.getById(value as string),
    enabled: !!value && !inPublicList && !colorsQuery.isLoading,
    staleTime: 10 * 60 * 1000,
  });

  const selectedColorLabel = useMemo(() => {
    if (!value) return null;
    const fromList = colorOptions.find((o) => o.value === value)?.label;
    return fromList ?? fallbackColorQuery.data?.data?.name ?? null;
  }, [value, colorOptions, fallbackColorQuery.data]);

  const effectiveLabel = labelOverride ?? selectedColorLabel;

  useEffect(() => {
    onLabelResolved?.(effectiveLabel);
  }, [effectiveLabel, onLabelResolved]);

  return (
    <>
      <View style={styles.row}>
        <TouchableRipple
          onPress={() => setPickerOpen(true)}
          disabled={disabled}
          style={[styles.field, disabled && styles.fieldLocked]}
          borderless
          rippleColor="rgba(79,70,229,0.12)"
        >
          <Text style={[styles.text, !effectiveLabel && styles.placeholder]} numberOfLines={1}>
            {effectiveLabel ?? 'Renksiz / Ham (seç)'}
          </Text>
        </TouchableRipple>
        {value && !disabled && showClear ? (
          <TouchableRipple onPress={() => onChange(null)} style={styles.clearBtn} borderless>
            <Text style={styles.clearText}>Temizle</Text>
          </TouchableRipple>
        ) : null}
      </View>

      <PickerModal
        visible={pickerOpen}
        title="Hedef Renk Seç"
        options={colorOptions}
        selectedValue={value}
        loading={colorsQuery.isLoading}
        onSelect={(v) => onChange(v)}
        onDismiss={() => setPickerOpen(false)}
        onRefresh={() => colorsQuery.refetch()}
        emptyText="Renk bulunamadı"
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  field: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  fieldLocked: { backgroundColor: colors.surfaceMuted },
  text: { fontSize: 15, color: colors.text, fontWeight: '600' },
  placeholder: { color: colors.textMuted, fontWeight: '400' },
  clearBtn: { paddingHorizontal: spacing.sm, paddingVertical: 10 },
  clearText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
});
