// =============================================================================
// İPLİK SATIRLARI — brüt çıkış (depo + kg) · dip iadesi (+ sebep, `WARP_RETURN` kataloğu)
// =============================================================================
// Depo seçici yalnız birden çok aktif depo varsa çizilir; tek depoda satır o depoyla
// doğar (panel `YarnLinesEditor` `multiWarehouse` deseni). Sebep KODU katalogdan seçilir,
// uydurulmaz (`ReasonPresetPicker`, kind metin saklamaz).
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, IconButton, TouchableRipple } from 'react-native-paper';
import NumpadInput from '../../../components/NumpadInput';
import PickerModal from '../../../components/PickerModal';
import ReasonPresetPicker from '../../../components/reasonPresets/ReasonPresetPicker';
import { colors, spacing, radius, typography } from '../../../theme';
import type { YarnLotQualityStatus } from '../../../types/models';
import { YARN_QUALITY_LABEL, yarnQualityWarning, type YarnLineDraft } from './beamPayload';

// Rozet rengi: Serbest yeşil · Bekletmede amber · Bloke kırmızı (yalnız `qualityHold` açıkken çizilir).
const QUALITY_BADGE_COLOR: Record<YarnLotQualityStatus, string> = {
  RELEASED: colors.success,
  ON_HOLD: colors.warning,
  BLOCKED: colors.danger,
};

interface Props {
  title: string;
  lines: YarnLineDraft[];
  warehouses: { id: string; name: string }[];
  withReason: boolean;
  onChange: (lines: YarnLineDraft[]) => void;
  disabled?: boolean;
  /** Faz 2: kartın ipliğine ait aktif lotlar; `undefined` = eski sunucu, lot seçici ÇİZİLMEZ (form birebir eski). */
  lots?: { id: string; lotNo: string; balanceKg: number; qualityStatus?: YarnLotQualityStatus }[];
  /** `devere.lotRequired` (sunucudan): "Lot yok" seçeneği çizilmez. */
  lotRequired?: boolean;
  /** `yarnQualityHold` (sunucudan): kalite bekletme etkin — lot seçicide durum rozeti + ON_HOLD/BLOCKED uyarısı. Kapalıysa rozet/uyarı yok. */
  qualityHold?: boolean;
}

const NO_LOT = '__no_lot__';

let seq = 1;
const nextKey = (): string => `l${Date.now().toString(36)}-${seq++}`;

export default function YarnLinesEditor({ title, lines, warehouses, withReason, onChange, disabled, lots, lotRequired, qualityHold }: Props) {
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [lotPickerFor, setLotPickerFor] = useState<string | null>(null);
  const lotLabel = (id: string | null) => (id ? (lots?.find((l) => l.id === id)?.lotNo ?? '?') : 'Lot yok');
  // Seçili lotun kalite durumu (yalnız `qualityHold` açıkken anlamlı) → satır altı uyarı.
  const lotStatus = (id: string | null): YarnLotQualityStatus | undefined => (id ? lots?.find((l) => l.id === id)?.qualityStatus : undefined);
  const multi = warehouses.length > 1;
  const defaultWarehouseId = warehouses[0]?.id ?? null;
  const update = (key: string, patch: Partial<YarnLineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => onChange(lines.filter((l) => l.key !== key));
  const add = () => onChange([...lines, { key: nextKey(), warehouseId: defaultWarehouseId, qtyKg: '', reasonCode: null, lotId: null }]);
  const warehouseName = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? 'Depo seç';

  return (
    <View style={styles.block}>
      <View style={styles.head}>
        <Text style={styles.title}>{title}</Text>
        <Button compact icon="plus" onPress={add} disabled={disabled}>Satır</Button>
      </View>
      {lines.map((l) => (
        <View key={l.key} style={styles.line}>
          <View style={styles.row}>
            {multi ? (
              <TouchableRipple onPress={() => setPickerFor(l.key)} style={styles.field} accessibilityRole="button" disabled={disabled}>
                <Text style={l.warehouseId ? styles.fieldText : styles.fieldPlaceholder}>{warehouseName(l.warehouseId)}</Text>
              </TouchableRipple>
            ) : null}
            {lots ? (
              <TouchableRipple onPress={() => setLotPickerFor(l.key)} style={styles.field} accessibilityRole="button" disabled={disabled}>
                <Text style={l.lotId ? styles.fieldText : styles.fieldPlaceholder}>{lotLabel(l.lotId)}</Text>
              </TouchableRipple>
            ) : null}
            <NumpadInput value={l.qtyKg} onChangeText={(t) => update(l.key, { qtyKg: t })} allowDecimal numpadMaxLength={8} numpadLabel={`${title} kg`} placeholder="kg" style={styles.kg} editable={!disabled} />
            <IconButton icon="close" onPress={() => remove(l.key)} disabled={disabled} accessibilityLabel="Satırı kaldır" />
          </View>
          {qualityHold && yarnQualityWarning(lotStatus(l.lotId)) ? (
            <Text style={styles.warn}>⚠ {yarnQualityWarning(lotStatus(l.lotId))}</Text>
          ) : null}
          {withReason ? (
            <ReasonPresetPicker kind="WARP_RETURN" value={{ code: l.reasonCode, text: '' }} onChange={(v) => update(l.key, { reasonCode: v.code })} placeholder="Dip iade sebebi" disabled={disabled} />
          ) : null}
        </View>
      ))}
      {lines.length === 0 ? <Text style={styles.empty}>{withReason ? 'Dip iadesi yok.' : 'Satır ekleyin — cağlığa yüklenen brüt kg.'}</Text> : null}
      {/* Lot seçici: "Lot yok" AÇIK bir seçenektir (sessiz lotsuz yazım olmasın); lotRequired açıkken çizilmez. */}
      <PickerModal
        visible={lotPickerFor !== null}
        title="İplik lotu seç"
        options={[
          ...(lotRequired ? [] : [{ value: NO_LOT, label: 'Lot yok', sublabel: 'lotsuz çıkış — levent lot izlemesine girmez' }]),
          ...(lots ?? []).map((lot) => ({
            value: lot.id,
            label: lot.lotNo,
            sublabel: `${lot.balanceKg} kg`,
            // Kalite rozeti yalnız `qualityHold` açıkken (Serbest/Bekletmede/Bloke).
            badge: qualityHold && lot.qualityStatus ? { text: YARN_QUALITY_LABEL[lot.qualityStatus], color: QUALITY_BADGE_COLOR[lot.qualityStatus] } : undefined,
          })),
        ]}
        selectedValue={lines.find((l) => l.key === lotPickerFor)?.lotId ?? NO_LOT}
        emptyText="Bu ipliğin aktif lotu yok — mal kabulde lot numarası yazılınca doğar."
        onDismiss={() => setLotPickerFor(null)}
        onSelect={(v) => {
          if (lotPickerFor) update(lotPickerFor, { lotId: v === NO_LOT ? null : v });
          setLotPickerFor(null);
        }}
      />
      <PickerModal
        visible={pickerFor !== null}
        title="Depo seç"
        options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
        selectedValue={lines.find((l) => l.key === pickerFor)?.warehouseId ?? ''}
        onDismiss={() => setPickerFor(null)}
        onSelect={(v) => {
          if (pickerFor) update(pickerFor, { warehouseId: v });
          setPickerFor(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: spacing.sm, gap: spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold },
  line: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, gap: spacing.xs, backgroundColor: colors.surfaceMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  field: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface, minHeight: 48, justifyContent: 'center' },
  fieldText: { color: colors.text },
  fieldPlaceholder: { color: colors.textMuted },
  kg: { flex: 1, backgroundColor: colors.surface },
  empty: { fontSize: typography.size.sm, color: colors.textMuted },
  warn: { fontSize: typography.size.sm, color: colors.danger, fontWeight: typography.weight.medium },
});
