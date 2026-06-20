import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TextInput, TouchableRipple, Icon } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import { colorService } from '../../../services/color.service';
import { useTruncationWarning } from '../../../hooks/useTruncationWarning';
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
  // Kat tipi her iş emrinde belirli olmalı (kumaş 2 veya 4 kat sarılır).
  // Varsayılan 2-KAT; operatör değiştirebilir ama boş bırakamaz.
  foldType: '2-KAT',
  batchNumber: '',
  dyehouseNote: '',
};

const FOLD_OPTIONS = ['2-KAT', '4-KAT'];

interface Props {
  value: WoHeaderFieldValues;
  onChange: (patch: Partial<WoHeaderFieldValues>) => void;
  /** Parti kodu alanı gösterilsin mi (Yeni'de otomatik olduğundan gizli, Düzenle'de açık). */
  showBatchNumber?: boolean;
  /** Seçili hedef renk adı çözümlendiğinde üst bileşene bildir (özet satırı için). */
  onColorLabelResolved?: (label: string | null) => void;
  /** Sipariş bağlıyken renk + en sipariş kaleminden gelir ve kilitlenir (backend
   *  bağlı siparişte farklı spec kabul etmiyor). */
  lockColorWidth?: boolean;
  /** Renk adını dışarıdan dayat (sipariş kaleminden gelen ad) — public picker'da
   *  olmayan müşteri-özel renkte de doğru ad görünsün, round-trip beklenmesin. */
  colorLabelOverride?: string | null;
}

export default function WorkOrderHeaderFields({
  value,
  onChange,
  showBatchNumber,
  onColorLabelResolved,
  lockColorWidth,
  colorLabelOverride,
}: Props) {
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

  // Dışarıdan dayatılan ad (sipariş kalemi) öncelikli; yoksa picker/fallback çözümü.
  const effectiveColorLabel = colorLabelOverride ?? selectedColorLabel;

  // Özet satırı için üst bileşene çözümlenen renk adını bildir.
  useEffect(() => {
    onColorLabelResolved?.(effectiveColorLabel);
  }, [effectiveColorLabel, onColorLabelResolved]);

  return (
    <View style={styles.root}>
      {lockColorWidth ? (
        <View style={styles.lockHint}>
          <Icon source="lock" size={13} color={colors.textMuted} />
          <Text style={styles.lockHintText}>
            Renk ve en sipariş kaleminden gelir, değiştirilemez.
          </Text>
        </View>
      ) : null}

      {/* Renk */}
      <Text style={styles.label}>Hedef Renk</Text>
      <View style={styles.rowGap}>
        <TouchableRipple
          onPress={() => setColorPickerOpen(true)}
          disabled={lockColorWidth}
          style={[styles.selectField, lockColorWidth && styles.fieldLocked]}
          borderless
          rippleColor="rgba(79,70,229,0.12)"
        >
          <Text style={[styles.selectText, !effectiveColorLabel && styles.placeholder]} numberOfLines={1}>
            {effectiveColorLabel ?? 'Renksiz / Ham (seç)'}
          </Text>
        </TouchableRipple>
        {value.targetColorId && !lockColorWidth ? (
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
            disabled={lockColorWidth}
            style={styles.input}
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>
            Kat Tipi <Text style={styles.req}>*</Text>
          </Text>
          {/* Zorunlu — bir tanesi mutlaka seçili olmalı; aktif çipe tekrar basınca seçim
              kaldırılmaz (sarım tipi boş bırakılamaz). */}
          <View style={styles.chipsRow}>
            {FOLD_OPTIONS.map((f) => {
              const active = value.foldType === f;
              return (
                <TouchableRipple
                  key={f}
                  onPress={() => onChange({ foldType: f })}
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
  req: { color: colors.danger },
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
  fieldLocked: { backgroundColor: colors.surfaceMuted },
  lockHint: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs },
  lockHintText: { fontSize: 11, color: colors.textMuted, fontWeight: '600', flex: 1 },
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
