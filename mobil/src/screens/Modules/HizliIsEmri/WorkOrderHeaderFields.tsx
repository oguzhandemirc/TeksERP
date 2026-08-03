import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TextInput, TouchableRipple, Icon } from 'react-native-paper';
import ColorSelectField from '../../../components/ColorSelectField';
import { colors, spacing, radius } from '../../../theme';

// İş emri "Düzenle" formunun ortak alanları. (Hızlı İş Emri sihirbazı bu bileşeni
// KULLANMAZ — orada alanlar rotaya göre koşullu çıkar; bkz. wizard/StepProduction.)
export interface WoHeaderFieldValues {
  targetColorId: string | null;
  width: string;
  targetQuantity: string;
  targetWeight: string;
  foldType: string | null;
  batchNumber: string;
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
};

export const FOLD_OPTIONS = ['2-KAT', '4-KAT'];

interface Props {
  value: WoHeaderFieldValues;
  onChange: (patch: Partial<WoHeaderFieldValues>) => void;
  /** Parti kodu alanı gösterilsin mi. */
  showBatchNumber?: boolean;
}

export default function WorkOrderHeaderFields({ value, onChange, showBatchNumber }: Props) {
  // Hedef metraj/kg nadiren kullanılır → varsayılan kapalı; değer varsa açık gelir.
  const [qtyOpen, setQtyOpen] = useState(() => !!(value.targetQuantity || value.targetWeight));

  return (
    <View style={styles.root}>
      {/* Renk */}
      <Text style={styles.label}>Hedef Renk</Text>
      <ColorSelectField
        value={value.targetColorId}
        onChange={(id) => onChange({ targetColorId: id })}
      />

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
          <Text style={styles.label}>İş Emri No</Text>
          <TextInput
            mode="outlined"
            dense
            value={value.batchNumber}
            onChangeText={(t) => onChange({ batchNumber: t })}
            placeholder="Boş = otomatik (İE-GGAAYY-NNNN)"
            style={styles.input}
            autoCapitalize="characters"
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs },
  label: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 2 },
  req: { color: colors.danger },
  twoCol: { flexDirection: 'row', gap: spacing.md },
  col: { flex: 1 },
  toggleRow: { marginTop: spacing.sm, borderRadius: radius.sm, alignSelf: 'flex-start' },
  toggleInner: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 6, paddingRight: spacing.sm },
  toggleText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  input: { backgroundColor: colors.surface },
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
