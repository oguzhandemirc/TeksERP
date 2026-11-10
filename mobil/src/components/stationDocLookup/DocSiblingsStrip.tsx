// Belgeden açılan işin kompakt parti seçicisi (2026-11-10; eski ~150dp "Bu belgede N parti var · diğerine geç" şeridinin
// yerine): `Parti [P009 | P010]` segment, >3 partide "Parti P009 ▾" → PickerModal. Tek partide ya da aktif kart
// belgeden açılan değilse çizilmez; kapatma yok. Seçim ekranın mevcut kart çözümüyle diğer partiyi açar.
import React, { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import type { StationLookupWorkOrder } from '../../services/stationDocLookup.service';
import { colors, spacing, typography } from '../../theme';
import PickerModal from '../PickerModal';
import { partySelectorModel, rowWhere } from './decide';

interface Props {
  siblings: StationLookupWorkOrder[];
  /** Ekrandaki aktif kartın barkodu (belgeden açılan kartla eşleşmezse seçici çizilmez). */
  activeCardBarcode: string | null;
  onSwitch: (workOrder: StationLookupWorkOrder) => void;
  /** Eski şeridin kapat düğmesi kalktı; çağıran ekranlar derlensin diye kabul edilir, kullanılmaz. */
  onDismiss?: () => void;
  /** Konak satırına gömülünce dış boşluğu ezmek için. */
  style?: StyleProp<ViewStyle>;
}

export default function DocSiblingsStrip({ siblings, activeCardBarcode, onSwitch, style }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const model = partySelectorModel(siblings, activeCardBarcode);
  if (!model) return null;
  const pick = (w: StationLookupWorkOrder) => {
    if (w.id !== model.opened.id) onSwitch(w);
  };
  return (
    <View style={[styles.root, style]} testID="belge-parti-secici">
      <Text style={styles.label}>Parti</Text>
      {model.mode === 'segment' ? (
        <View style={styles.segment} accessibilityRole="radiogroup">
          {model.options.map((o, i) => (
            <TouchableRipple
              key={o.workOrder.id}
              onPress={() => pick(o.workOrder)}
              accessibilityRole="radio"
              accessibilityState={{ selected: o.selected }}
              testID={`belge-kardes-${o.workOrder.workOrderNumber}`}
              style={[styles.seg, i > 0 && styles.segDivider, o.selected && styles.segOn]}
            >
              <Text style={[styles.segText, o.selected && styles.segTextOn]} numberOfLines={1}>
                {o.label}
              </Text>
            </TouchableRipple>
          ))}
        </View>
      ) : (
        <TouchableRipple
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Parti ${model.options.find((o) => o.selected)?.label ?? ''}, değiştir`}
          testID="belge-parti-ac"
          style={[styles.seg, styles.segOn, styles.pickerBtn]}
        >
          <View style={styles.pickerInner}>
            <Text style={[styles.segText, styles.segTextOn]} numberOfLines={1}>
              {model.options.find((o) => o.selected)?.label}
            </Text>
            <Icon source="menu-down" size={22} color={colors.textOnDark} />
          </View>
        </TouchableRipple>
      )}
      {model.mode === 'picker' && (
        <PickerModal
          visible={pickerOpen}
          title="Parti seç"
          disableSort
          options={model.options.map((o) => ({
            value: o.workOrder.id,
            label: o.label,
            sublabel: [o.workOrder.processText ?? '', rowWhere(o.workOrder), o.workOrder.workOrderNumber].filter(Boolean).join(' · '),
          }))}
          selectedValue={model.opened.id}
          onSelect={(id) => {
            setPickerOpen(false);
            const w = model.options.find((o) => o.workOrder.id === id)?.workOrder;
            if (w) pick(w);
          }}
          onDismiss={() => setPickerOpen(false)}
        />
      )}
    </View>
  );
}

/** Ekranın seçici durumu: belgeden açılınca kardeşler tutulur. */
export function useDocSiblings() {
  const [siblings, setSiblings] = useState<StationLookupWorkOrder[]>([]);
  return { siblings, setSiblings, clear: () => setSiblings([]) };
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start', marginHorizontal: spacing.md, marginTop: spacing.sm },
  label: { color: colors.textSecondary, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  segment: { flexDirection: 'row', borderWidth: 1, borderColor: colors.brand, borderRadius: 10, overflow: 'hidden' },
  // Eldivenli elde ıskalanmasın: dokunma hedefi 56dp.
  seg: { minHeight: 56, minWidth: 72, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  segDivider: { borderLeftWidth: 1, borderLeftColor: colors.brand },
  segOn: { backgroundColor: colors.brand },
  segText: { color: colors.brand, fontSize: typography.size.base, fontWeight: typography.weight.bold },
  segTextOn: { color: colors.textOnDark },
  pickerBtn: { borderRadius: 10 },
  pickerInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
