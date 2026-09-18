// =============================================================================
// LEVENT PLANLA — çözgü kartı · planlanan metre · köken (üçü de, §11 D1) · taraf · metal levent no
// =============================================================================
// Alanlar backend `createSchema` ile birebir (`beamPayload.buildPlanPayload`). Plan
// DÜZENLEME tablette yok: yanlış plan silinir (④ sınıfı) ve yeniden açılır.
// TEK KART (`ModuleSheet`): gövde kısa, sayfalamaya gerek yok. Gövde no yazılırken canlı
// leventlere karşı ERKEN uyarı (sunucu 409 aynası) — Planla kilitlenmez, uyarır.
// =============================================================================
import React, { useState } from 'react';
import { View } from 'react-native';
import { Text, Button, SegmentedButtons } from 'react-native-paper';
import NumpadInput from '../../../components/NumpadInput';
import ModalTextInput from '../../../components/ModalTextInput';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import ModuleSheet, { SheetField, sheet } from '../../../components/ModuleSheet';
import type { WarpBeamOrigin } from '../../../services/warpBeam.service';
import { ORIGIN_LABEL, physicalBeamBusyWarning, theoreticalKg } from './beamPayload';
import type { DevereScreenState } from './useDevereScreen';
import { partnerRoleLabel } from '../../../lib/partnerRole';

type PickerKind = 'spec' | 'subcontractor' | 'supplier' | null;

/** Üç seçici — kartın DIŞINDA portalda (`overlays`); seçim formu yazar ve kapanır. */
function PlanPickers({ picker, setPicker, state, specOptions, subOptions, supOptions }: { picker: PickerKind; setPicker: (k: PickerKind) => void; state: DevereScreenState; specOptions: PickerOption[]; subOptions: PickerOption[]; supOptions: PickerOption[] }) {
  const f = state.planForm;
  return (
    <>
      <PickerModal visible={picker === 'spec'} title="Çözgü kartı seç" options={specOptions} selectedValue={f.warpSpecId ?? ''} loading={state.context.isLoading} emptyText="Aktif çözgü kartı yok — panelden tanımlanır." onDismiss={() => setPicker(null)} onSelect={(v) => { state.setPlanForm({ ...f, warpSpecId: v }); setPicker(null); }} />
      <PickerModal visible={picker === 'subcontractor'} title="Fasoncu seç" options={subOptions} selectedValue={f.subcontractorId ?? ''} loading={state.context.isLoading} onDismiss={() => setPicker(null)} onSelect={(v) => { state.setPlanForm({ ...f, subcontractorId: v, supplierId: null }); setPicker(null); }} />
      <PickerModal visible={picker === 'supplier'} title="Tedarikçi seç" options={supOptions} selectedValue={f.supplierId ?? ''} loading={state.context.isLoading} onDismiss={() => setPicker(null)} onSelect={(v) => { state.setPlanForm({ ...f, supplierId: v, subcontractorId: null }); setPicker(null); }} />
    </>
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
  // Alt etiket ROLLERDEN (D1): tip türetilmiş ve fasonu taşımaz; fasoncu kart burada "+ Fason" ile görünür.
  const supOptions: PickerOption[] = (ctx?.suppliers ?? []).map((c) => ({ value: c.id, label: c.name, sublabel: partnerRoleLabel(c) }));
  const spec = ctx?.warpSpecs.find((s) => s.id === f.warpSpecId) ?? null;
  const subName = ctx?.subcontractors.find((s) => s.id === f.subcontractorId)?.name ?? '';
  const supName = ctx?.suppliers.find((s) => s.id === f.supplierId)?.name ?? '';
  const nominal = spec ? theoreticalKg(spec.endsCount, spec.denier, Number(f.plannedLengthM.replace(',', '.'))) : null;
  const busyWarning = physicalBeamBusyWarning(f.physicalBeamNo, state.physicalBusyBeams);

  return (
    <ModuleSheet
      visible={state.modal?.kind === 'plan'}
      onDismiss={state.closeModal}
      title="Yeni levent planla"
      subtitle="Plan tablette düzenlenmez — yanlış plan silinir, yeniden açılır."
      footer={
        <>
          <Button onPress={state.closeModal} disabled={state.busy}>Vazgeç</Button>
          <Button mode="contained" onPress={state.submitPlan} loading={state.busy} disabled={state.busy || !state.isOnline}>Planla</Button>
        </>
      }
      overlays={<PlanPickers picker={picker} setPicker={setPicker} state={state} specOptions={specOptions} subOptions={subOptions} supOptions={supOptions} />}
    >
      <View style={sheet.row}>
        <View style={sheet.col}>
          <SheetField label="Çözgü kartı" value={spec ? `${spec.code} — ${spec.name}` : ''} placeholder="Seçilmedi" onPress={() => setPicker('spec')} />
          {spec && spec.denier == null ? <Text style={sheet.warn}>Bu kartın ipliğinde denye yok — sarımda nominal kg hesaplanamaz (kartı düzelttirin).</Text> : null}
        </View>
        <View style={sheet.col}>
          <Text style={sheet.label}>Planlanan metre</Text>
          <NumpadInput value={f.plannedLengthM} onChangeText={(t) => state.setPlanForm({ ...f, plannedLengthM: t })} allowDecimal numpadMaxLength={8} numpadLabel="Planlanan metre" placeholder="ör. 1200" style={sheet.input} />
          {nominal != null ? <Text style={sheet.hint}>{`Nominal ≈ ${nominal} kg (tel × denye × m / 9.000.000)`}</Text> : null}
        </View>
      </View>
      <Text style={sheet.label}>Köken</Text>
      {/* Tam genişlik + küçük yazı: üç etiket kesilmez ("İçeri… Fas… Haz…" yasak). */}
      <SegmentedButtons
        value={f.originKind}
        onValueChange={(v) => state.setPlanForm({ ...f, originKind: v as WarpBeamOrigin, subcontractorId: null, supplierId: null })}
        buttons={(['IN_HOUSE', 'SUBCONTRACT', 'PURCHASED'] as WarpBeamOrigin[]).map((k) => ({ value: k, label: ORIGIN_LABEL[k], labelStyle: sheet.segmentLabel }))}
      />
      {f.originKind !== 'IN_HOUSE' ? (
        <View style={sheet.row}>
          <View style={sheet.col}>
            <SheetField label={f.originKind === 'PURCHASED' ? 'Fasoncu (tedarikçi yerine)' : 'Fasoncu'} value={subName} placeholder="Seçilmedi" onPress={() => setPicker('subcontractor')} />
          </View>
          {f.originKind === 'PURCHASED' ? (
            <View style={sheet.col}>
              <SheetField label="Tedarikçi (cari)" value={supName} placeholder="Seçilmedi" onPress={() => setPicker('supplier')} />
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={sheet.row}>
        <View style={sheet.col}>
          <Text style={sheet.label}>Metal levent no (isteğe bağlı)</Text>
          <ModalTextInput value={f.physicalBeamNo} onChangeText={(t) => state.setPlanForm({ ...f, physicalBeamNo: t })} maxLength={32} placeholder="ör. L-12" style={sheet.input} dense />
          {busyWarning ? <Text style={sheet.warn} testID="plan-govde-uyari">{busyWarning}</Text> : null}
        </View>
        <View style={sheet.col}>
          <Text style={sheet.label}>Not (isteğe bağlı)</Text>
          <ModalTextInput value={f.notes} onChangeText={(t) => state.setPlanForm({ ...f, notes: t })} maxLength={500} placeholder="—" style={sheet.input} dense />
        </View>
      </View>
      {state.formError ? <Text style={sheet.error}>{state.formError}</Text> : null}
    </ModuleSheet>
  );
}
