// =============================================================================
// LEVENT PLANLA — çözgü kartı · planlanan metre · köken (üçü de, §11 D1) · taraf · metal levent no
// =============================================================================
// Alanlar backend `createSchema` ile birebir (`beamPayload.buildPlanPayload`). Plan
// DÜZENLEME tablette yok: yanlış plan silinir (④ sınıfı) ve yeniden açılır.
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, TouchableRipple, SegmentedButtons } from 'react-native-paper';
import AppModal from '../../../components/AppModal';
import NumpadInput from '../../../components/NumpadInput';
import ModalTextInput from '../../../components/ModalTextInput';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import { colors, spacing, radius, typography } from '../../../theme';
import type { WarpBeamOrigin } from '../../../services/warpBeam.service';
import { ORIGIN_LABEL, theoreticalKg } from './beamPayload';
import type { DevereScreenState } from './useDevereScreen';

type PickerKind = 'spec' | 'subcontractor' | 'supplier' | null;

export function Field({ label, value, placeholder, onPress }: { label: string; value: string; placeholder: string; onPress: () => void }) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TouchableRipple onPress={onPress} style={styles.field} accessibilityRole="button">
        <Text style={value ? styles.fieldText : styles.fieldPlaceholder}>{value || placeholder}</Text>
      </TouchableRipple>
    </View>
  );
}

export default function PlanModal({ state }: { state: DevereScreenState }) {
  const [picker, setPicker] = useState<PickerKind>(null);
  const f = state.planForm;
  const ctx = state.context.data;
  const specOptions: PickerOption[] = (ctx?.warpSpecs ?? []).map((s) => ({
    value: s.id,
    label: s.name,
    sublabel: `${s.code} · ${s.endsCount} tel${s.denier == null ? ' · denye YOK' : ''}`,
  }));
  const subOptions: PickerOption[] = (ctx?.subcontractors ?? []).map((s) => ({ value: s.id, label: s.name }));
  const supOptions: PickerOption[] = (ctx?.suppliers ?? []).map((c) => ({ value: c.id, label: c.name, sublabel: c.type === 'CUSTOMER' ? 'müşteri kartı' : 'tedarikçi' }));
  const spec = ctx?.warpSpecs.find((s) => s.id === f.warpSpecId) ?? null;
  const subName = ctx?.subcontractors.find((s) => s.id === f.subcontractorId)?.name ?? '';
  const supName = ctx?.suppliers.find((s) => s.id === f.supplierId)?.name ?? '';
  const nominal = spec ? theoreticalKg(spec.endsCount, spec.denier, Number(f.plannedLengthM.replace(',', '.'))) : null;

  return (
    <AppModal visible={state.modal?.kind === 'plan'} onDismiss={state.closeModal} position="center">
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Yeni levent planla</Text>
        <Field label="Çözgü kartı" value={spec ? `${spec.code} — ${spec.name}` : ''} placeholder="Seçilmedi" onPress={() => setPicker('spec')} />
        {spec && spec.denier == null ? <Text style={styles.warn}>Bu kartın ipliğinde denye yok — sarımda nominal kg hesaplanamaz (kartı düzelttirin).</Text> : null}
        <Text style={styles.label}>Planlanan metre</Text>
        <NumpadInput value={f.plannedLengthM} onChangeText={(t) => state.setPlanForm({ ...f, plannedLengthM: t })} allowDecimal numpadMaxLength={8} numpadLabel="Planlanan metre" placeholder="ör. 1200" style={styles.input} />
        {nominal != null ? <Text style={styles.hint}>{`Nominal ≈ ${nominal} kg (tel × denye × m / 9.000.000)`}</Text> : null}
        <Text style={styles.label}>Köken</Text>
        <View>
          <SegmentedButtons
            value={f.originKind}
            onValueChange={(v) => state.setPlanForm({ ...f, originKind: v as WarpBeamOrigin, subcontractorId: null, supplierId: null })}
            buttons={(['IN_HOUSE', 'SUBCONTRACT', 'PURCHASED'] as WarpBeamOrigin[]).map((k) => ({ value: k, label: ORIGIN_LABEL[k] }))}
          />
        </View>
        {f.originKind !== 'IN_HOUSE' ? (
          <Field label={f.originKind === 'PURCHASED' ? 'Fasoncu (tedarikçi yerine)' : 'Fasoncu'} value={subName} placeholder="Seçilmedi" onPress={() => setPicker('subcontractor')} />
        ) : null}
        {f.originKind === 'PURCHASED' ? <Field label="Tedarikçi (cari)" value={supName} placeholder="Seçilmedi" onPress={() => setPicker('supplier')} /> : null}
        <Text style={styles.label}>Metal levent no (isteğe bağlı)</Text>
        <ModalTextInput value={f.physicalBeamNo} onChangeText={(t) => state.setPlanForm({ ...f, physicalBeamNo: t })} maxLength={32} placeholder="ör. L-12" style={styles.input} dense />
        <Text style={styles.label}>Not (isteğe bağlı)</Text>
        <ModalTextInput value={f.notes} onChangeText={(t) => state.setPlanForm({ ...f, notes: t })} maxLength={500} placeholder="—" style={styles.input} dense />
        {state.formError ? <Text style={styles.error}>{state.formError}</Text> : null}
        <View style={styles.actions}>
          <Button onPress={state.closeModal} disabled={state.busy}>Vazgeç</Button>
          <Button mode="contained" onPress={state.submitPlan} loading={state.busy} disabled={state.busy || !state.isOnline}>Planla</Button>
        </View>
      </ScrollView>

      <PickerModal visible={picker === 'spec'} title="Çözgü kartı seç" options={specOptions} selectedValue={f.warpSpecId ?? ''} loading={state.context.isLoading} emptyText="Aktif çözgü kartı yok — panelden tanımlanır." onDismiss={() => setPicker(null)} onSelect={(v) => { state.setPlanForm({ ...f, warpSpecId: v }); setPicker(null); }} />
      <PickerModal visible={picker === 'subcontractor'} title="Fasoncu seç" options={subOptions} selectedValue={f.subcontractorId ?? ''} loading={state.context.isLoading} onDismiss={() => setPicker(null)} onSelect={(v) => { state.setPlanForm({ ...f, subcontractorId: v, supplierId: null }); setPicker(null); }} />
      <PickerModal visible={picker === 'supplier'} title="Tedarikçi seç" options={supOptions} selectedValue={f.supplierId ?? ''} loading={state.context.isLoading} onDismiss={() => setPicker(null)} onSelect={(v) => { state.setPlanForm({ ...f, supplierId: v, subcontractorId: null }); setPicker(null); }} />
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
  hint: { fontSize: typography.size.sm, color: colors.textSecondary, marginTop: spacing.xs },
  warn: { fontSize: typography.size.sm, color: colors.warningText, marginTop: spacing.xs },
  error: { color: colors.dangerText, marginTop: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
});
