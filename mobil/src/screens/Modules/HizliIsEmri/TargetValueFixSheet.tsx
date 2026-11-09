// Hedef değeri değiştir (tablet Düzelt, 2026-11-09): İE'nin kurşun dışı hedef çeşit değeri (ör. brode deseni).
// Seçenekler İE detayından (`targetValues[].property.values`, aktif değerler); seçici `PickerModal`. Kilit sunucuda:
// değerin adımı başladıysa 409 — ekran kalemi zaten çizmez, yarışta tost söyler.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import { useMutation } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import PickerModal from '../../../components/PickerModal';
import TruncatedText from '../../../components/TruncatedText';
import ReasonPresetPicker, { type ReasonPresetValue } from '../../../components/reasonPresets/ReasonPresetPicker';
import { useReasonPresets } from '../../../hooks/useReasonPresets';
import { workOrderGramajService } from '../../../services/workOrderGramaj.service';
import { colors, radius, spacing } from '../../../theme';
import { reasonPayload, reasonReady } from './workOrderFix';
import { errorText, Footer, useAfterSave } from './fixSheetParts';

export interface TargetValueFixInput {
  woId: string;
  workOrderNumber: string;
  propertyId: string;
  propertyName: string;
  valueId: string | null;
  valueName: string | null;
  options: { id: string; name: string }[];
}

export default function TargetValueFixSheet({ target, onDismiss, onDone }: { target: TargetValueFixInput; onDismiss: () => void; onDone: () => void }) {
  const [valueId, setValueId] = useState<string | null>(target.valueId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reason, setReason] = useState<ReasonPresetValue>({ code: null, text: '' });
  const { presets } = useReasonPresets('WORK_ORDER_PLAN_CHANGE');
  const options = target.options.map((o) => ({ value: o.id, label: o.name }));
  const label = options.find((o) => o.value === valueId)?.label ?? target.valueName ?? 'Seçilmedi';
  const changed = !!valueId && valueId !== target.valueId;
  const after = useAfterSave(target.woId, onDone);
  const save = useMutation({
    mutationFn: () => {
      const r = reasonPayload(reason, presets);
      return workOrderGramajService.changeTargetValue(target.woId, { propertyId: target.propertyId, valueId: valueId!, reason: r.reason, reasonCode: r.reasonCode });
    },
    onSuccess: (r) => after(`${target.propertyName} değiştirildi`, r.warnings),
    onError: (err) => Toast.show({ type: 'error', text1: `${target.propertyName} değiştirilemedi`, text2: errorText(err) }),
  });
  return (
    <>
      <ModuleSheet
        visible
        onDismiss={onDismiss}
        title={`${target.propertyName} Değiştir`}
        subtitle={`${target.workOrderNumber} · şu an: ${target.valueName ?? '—'}`}
        footer={<Footer onCancel={onDismiss} onSave={() => save.mutate()} busy={save.isPending} disabled={!changed || !reasonReady(reason, presets)} />}
      >
        <Text style={sheet.label}>Yeni değer</Text>
        <TouchableRipple onPress={() => setPickerOpen(true)} style={styles.field} accessibilityRole="button" accessibilityLabel={`${target.propertyName} seç`} testID="hedef-deger-sec">
          <View style={styles.fieldInner}>
            <TruncatedText style={styles.fieldText}>{label}</TruncatedText>
            <Icon source="chevron-down" size={22} color={colors.textSecondary} />
          </View>
        </TouchableRipple>
        <Text style={sheet.hint}>Refakat kartındaki hedef değişir — kaydettikten sonra "Kartı Yeniden Bas". Değerin adımı başladıktan sonra değiştirilemez.</Text>
        <Text style={sheet.label}>Sebep</Text>
        <ReasonPresetPicker kind="WORK_ORDER_PLAN_CHANGE" value={reason} onChange={setReason} />
      </ModuleSheet>
      <PickerModal
        visible={pickerOpen}
        title={`${target.propertyName} seç`}
        options={options}
        selectedValue={valueId}
        disableSort
        emptyText="Değer tanımlı değil"
        onSelect={(v) => {
          setValueId(v);
          setPickerOpen(false);
        }}
        onDismiss={() => setPickerOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  field: { minHeight: 56, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, justifyContent: 'center' },
  fieldInner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.sm },
  fieldText: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.text },
});
