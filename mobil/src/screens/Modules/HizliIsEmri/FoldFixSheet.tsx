// Kat Tipini Değiştir (tablet Düzelt, "Eni Değiştir" ikizi): seçenekler KAT kataloğundan (`useFoldValues`), seçici `PickerModal`.
// Kat kolondur (`WorkOrder.foldType`), hedef çeşit değeri değil → ayrı uç `PATCH /work-orders/:id/fold-type`; Tambur başladıysa sunucu 409.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import { useMutation } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import PickerModal from '../../../components/PickerModal';
import ReasonPresetPicker, { type ReasonPresetValue } from '../../../components/reasonPresets/ReasonPresetPicker';
import { useReasonPresets } from '../../../hooks/useReasonPresets';
import { useFoldValues } from '../../../hooks/useFoldValues';
import { workOrderGramajService } from '../../../services/workOrderGramaj.service';
import { colors, radius, spacing } from '../../../theme';
import { reasonPayload, reasonReady } from './workOrderFix';
import { errorText, Footer, useAfterSave, type FixWo } from './fixSheetParts';

export default function FoldFixSheet({ wo, onDismiss, onDone }: { wo: FixWo; onDismiss: () => void; onDone: () => void }) {
  const current = wo.foldType ?? null;
  const [fold, setFold] = useState<string | null>(current);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reason, setReason] = useState<ReasonPresetValue>({ code: null, text: '' });
  const { presets } = useReasonPresets('WORK_ORDER_PLAN_CHANGE');
  const { values, isLoading, isEmpty } = useFoldValues();
  // Pasif değer yeni seçimde çıkmaz; mevcut (pasif olsa da) listede kalır ki ekran yalan söylemesin.
  const options = values.filter((v) => v.isActive || v.code === current).map((v) => ({ value: v.code, label: v.name || v.code }));
  const label = options.find((o) => o.value === fold)?.label ?? fold ?? 'Seçilmedi';
  const changed = !!fold && fold !== current;
  const after = useAfterSave(wo.id, onDone);
  const save = useMutation({
    mutationFn: () => {
      const r = reasonPayload(reason, presets);
      return workOrderGramajService.changeFoldType(wo.id, { foldType: fold, reason: r.reason, reasonCode: r.reasonCode });
    },
    onSuccess: () => after('Kat tipi değiştirildi'),
    onError: (err) => Toast.show({ type: 'error', text1: 'Kat tipi değiştirilemedi', text2: errorText(err) }),
  });
  return (
    <>
      <ModuleSheet
        visible
        onDismiss={onDismiss}
        title="Kat Tipini Değiştir"
        subtitle={`${wo.workOrderNumber} · şu an: ${current ?? '—'}`}
        footer={<Footer onCancel={onDismiss} onSave={() => save.mutate()} busy={save.isPending} disabled={!changed || !reasonReady(reason, presets)} />}
      >
        <Text style={sheet.label}>Yeni kat tipi</Text>
        <TouchableRipple onPress={() => setPickerOpen(true)} style={styles.field} accessibilityLabel="Kat tipi seç" testID="kat-sec">
          <View style={styles.fieldInner}>
            <Text style={styles.fieldText}>{label}</Text>
            <Icon source="chevron-down" size={22} color={colors.textSecondary} />
          </View>
        </TouchableRipple>
        {isEmpty ? <Text style={sheet.error}>Kat değeri tanımlı değil — panelden Kumaş Özellikleri → KAT ekleyin.</Text> : null}
        <Text style={sheet.hint}>Refakat kartındaki kat değişir — kaydettikten sonra "Kartı Yeniden Bas". Tambur başladıktan sonra kat değiştirilemez.</Text>
        <Text style={sheet.label}>Sebep</Text>
        <ReasonPresetPicker kind="WORK_ORDER_PLAN_CHANGE" value={reason} onChange={setReason} />
      </ModuleSheet>
      <PickerModal
        visible={pickerOpen}
        title="Kat tipi seç"
        options={options}
        selectedValue={fold}
        loading={isLoading}
        disableSort
        emptyText="Kat değeri tanımlı değil"
        onSelect={(v) => {
          setFold(v);
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
