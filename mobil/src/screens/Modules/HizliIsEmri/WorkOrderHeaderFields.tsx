import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TextInput, TouchableRipple, Icon } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import { colorService } from '../../../services/color.service';
import { colors, spacing, radius } from '../../../theme';

// Gelişmiş mod + Düzenle formu ortak alanları (rota/sipariş HARİÇ — onlar New'e özel).
export interface WoHeaderFieldValues {
  targetColorId: string | null;
  width: string;
  targetQuantity: string;
  targetWeight: string;
  foldType: string | null;
  batchNumber: string;
  dyehouseNote: string;
}

export const EMPTY_HEADER_FIELDS: WoHeaderFieldValues = {
  targetColorId: null,
  width: '',
  targetQuantity: '',
  targetWeight: '',
  foldType: null,
  batchNumber: '',
  dyehouseNote: '',
};

const FOLD_OPTIONS = ['2-KAT', '4-KAT'];

interface Props {
  value: WoHeaderFieldValues;
  onChange: (patch: Partial<WoHeaderFieldValues>) => void;
  /** Parti kodu alanı gösterilsin mi (Yeni'de otomatik olduğundan gizli, Düzenle'de açık). */
  showBatchNumber?: boolean;
}

export default function WorkOrderHeaderFields({ value, onChange, showBatchNumber }: Props) {
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  // Hedef metraj/kg nadiren kullanılır → varsayılan kapalı; değer varsa açık gelir.
  const [qtyOpen, setQtyOpen] = useState(() => !!(value.targetQuantity || value.targetWeight));

  // scope=public → müşteriye özel (assigned) renkler listelenmez. Hızlı İş Emri
  // stok üretimidir (müşterisiz); exclusive renkler burada çıkmamalı.
  const colorsQuery = useQuery({
    queryKey: ['colors', 'wo-picker-public'],
    queryFn: () =>
      colorService.listPublicForPicker({ page: 1, pageSize: 300, sortBy: 'name', sortOrder: 'asc' }),
    staleTime: 10 * 60 * 1000,
  });

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

  // Seçili renk public listede mi? Değilse (örn. stok roldan türetilen müşteriye
  // özel renk) tek-renk fallback ile adını çek — yoksa başlık boş ("seç") görünür.
  const inPublicList = useMemo(
    () => colorOptions.some((o) => o.value === value.targetColorId),
    [colorOptions, value.targetColorId],
  );
  const fallbackColorQuery = useQuery({
    queryKey: ['color', value.targetColorId],
    queryFn: () => colorService.getById(value.targetColorId as string),
    enabled: !!value.targetColorId && !inPublicList && !colorsQuery.isLoading,
    staleTime: 10 * 60 * 1000,
  });

  const selectedColorLabel = useMemo(() => {
    if (!value.targetColorId) return null;
    const fromList = colorOptions.find((o) => o.value === value.targetColorId)?.label;
    return fromList ?? fallbackColorQuery.data?.data?.name ?? null;
  }, [value.targetColorId, colorOptions, fallbackColorQuery.data]);

  return (
    <View style={styles.root}>
      {/* Renk */}
      <Text style={styles.label}>Hedef Renk</Text>
      <View style={styles.rowGap}>
        <TouchableRipple
          onPress={() => setColorPickerOpen(true)}
          style={styles.selectField}
          borderless
          rippleColor="rgba(79,70,229,0.12)"
        >
          <Text style={[styles.selectText, !selectedColorLabel && styles.placeholder]} numberOfLines={1}>
            {selectedColorLabel ?? 'Renksiz / Ham (seç)'}
          </Text>
        </TouchableRipple>
        {value.targetColorId ? (
          <TouchableRipple onPress={() => onChange({ targetColorId: null })} style={styles.clearBtn} borderless>
            <Text style={styles.clearText}>Temizle</Text>
          </TouchableRipple>
        ) : null}
      </View>

      {/* En + Kat tipi */}
      <View style={styles.twoCol}>
        <View style={styles.col}>
          <Text style={styles.label}>En (cm)</Text>
          <TextInput
            mode="outlined"
            dense
            keyboardType="numeric"
            value={value.width}
            onChangeText={(t) => onChange({ width: t.replace(',', '.') })}
            placeholder="örn. 150"
            style={styles.input}
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>Kat Tipi</Text>
          <View style={styles.chipsRow}>
            {FOLD_OPTIONS.map((f) => {
              const active = value.foldType === f;
              return (
                <TouchableRipple
                  key={f}
                  onPress={() => onChange({ foldType: active ? null : f })}
                  style={[styles.chip, active && styles.chipActive]}
                  borderless
                  rippleColor="rgba(79,70,229,0.12)"
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{f}</Text>
                </TouchableRipple>
              );
            })}
          </View>
        </View>
      </View>

      {/* Hedef metraj + kg — varsayılan kapalı (nadir kullanılır). */}
      <TouchableRipple onPress={() => setQtyOpen((o) => !o)} style={styles.toggleRow} borderless>
        <View style={styles.toggleInner}>
          <Icon source={qtyOpen ? 'chevron-down' : 'chevron-right'} size={20} color={colors.textSecondary} />
          <Text style={styles.toggleText}>Hedef metraj / kg {qtyOpen ? '' : '(opsiyonel)'}</Text>
        </View>
      </TouchableRipple>
      {qtyOpen ? (
        <View style={styles.twoCol}>
          <View style={styles.col}>
            <Text style={styles.label}>Hedef Metraj (m)</Text>
            <TextInput
              mode="outlined"
              dense
              keyboardType="numeric"
              value={value.targetQuantity}
              onChangeText={(t) => onChange({ targetQuantity: t.replace(',', '.') })}
              placeholder="opsiyonel"
              style={styles.input}
            />
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Hedef Kg</Text>
            <TextInput
              mode="outlined"
              dense
              keyboardType="numeric"
              value={value.targetWeight}
              onChangeText={(t) => onChange({ targetWeight: t.replace(',', '.') })}
              placeholder="opsiyonel"
              style={styles.input}
            />
          </View>
        </View>
      ) : null}

      {showBatchNumber ? (
        <>
          <Text style={styles.label}>Parti Kodu</Text>
          <TextInput
            mode="outlined"
            dense
            value={value.batchNumber}
            onChangeText={(t) => onChange({ batchNumber: t })}
            placeholder="Boş = otomatik (P-YYMMDD-NNN)"
            style={styles.input}
            autoCapitalize="characters"
          />
        </>
      ) : null}

      {/* Boyahane notu */}
      <Text style={styles.label}>Boyahane Notu</Text>
      <TextInput
        mode="outlined"
        dense
        value={value.dyehouseNote}
        onChangeText={(t) => onChange({ dyehouseNote: t })}
        placeholder="Boyahaneye talimat (opsiyonel)"
        multiline
        numberOfLines={2}
        style={[styles.input, styles.noteInput]}
      />

      <PickerModal
        visible={colorPickerOpen}
        title="Hedef Renk Seç"
        options={colorOptions}
        selectedValue={value.targetColorId}
        loading={colorsQuery.isLoading}
        onSelect={(v) => onChange({ targetColorId: v })}
        onDismiss={() => setColorPickerOpen(false)}
        onRefresh={() => colorsQuery.refetch()}
        emptyText="Renk bulunamadı"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs },
  label: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 2 },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  selectField: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  selectText: { fontSize: 15, color: colors.text, fontWeight: '600' },
  placeholder: { color: colors.textMuted, fontWeight: '400' },
  clearBtn: { paddingHorizontal: spacing.sm, paddingVertical: 10 },
  clearText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  twoCol: { flexDirection: 'row', gap: spacing.md },
  col: { flex: 1 },
  toggleRow: { marginTop: spacing.sm, borderRadius: radius.sm, alignSelf: 'flex-start' },
  toggleInner: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 6, paddingRight: spacing.sm },
  toggleText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  input: { backgroundColor: colors.surface },
  noteInput: { minHeight: 56 },
  chipsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: 2 },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.brand, backgroundColor: colors.brandSoft, borderWidth: 2 },
  chipText: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
  chipTextActive: { color: colors.brand },
});
