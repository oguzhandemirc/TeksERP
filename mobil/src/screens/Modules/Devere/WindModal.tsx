// =============================================================================
// SAR — metre · kg kaynağı · (IN_HOUSE) devere makinesi + brüt çıkış + dip iadesi + kopuş
// =============================================================================
// Alanlar backend `windSchema` ile birebir (`beamPayload.buildWindPayload`). Fason/hazır
// kökende makine ve iplik satırı ÇİZİLMEZ — sunucu 400 verir, form hiç kurmaz.
// Kart iskeleti `DevereSheet`; sayısal alanlar iki sütun (metre | adet · kg kaynağı | makine),
// iplik satırları ve dip iadesi tam genişlik.
// =============================================================================
import React, { useState } from 'react';
import { View } from 'react-native';
import { Text, Button, SegmentedButtons } from 'react-native-paper';
import NumpadInput from '../../../components/NumpadInput';
import ModalTextInput from '../../../components/ModalTextInput';
import PickerModal from '../../../components/PickerModal';
import type { WarpKgSource } from '../../../services/warpBeam.service';
import { KG_SOURCE_LABEL, ORIGIN_LABEL, setCount, theoreticalKg } from './beamPayload';
import DevereSheet, { sheet } from './devereSheet';
import { Field } from './PlanModal';
import YarnLinesEditor from './YarnLinesEditor';
import type { DevereScreenState } from './useDevereScreen';

/** Makine listesi BOŞken alan gizlenmez — kurulum yolu söylenir (fail-soft; 6e'nin "Devere" görev türü inince güncellenir). */
export const NO_DEVERE_MACHINE_HINT = "Tanımlı devere makinesi yok — panelde Tanımlar → Üretim İstasyonları → istasyon kartında 'Levent sarar' + makine.";

type WindForm = NonNullable<DevereScreenState['windForm']>;

/** IN_HOUSE: brüt çıkış · dip iadesi · kopuş — tam genişlik; fason/hazır kökende hiç çizilmez. */
function InHouseYarnSection({ f, set, state, lots, lotRequired }: { f: WindForm; set: (patch: Partial<WindForm>) => void; state: DevereScreenState; lots: NonNullable<DevereScreenState['context']['data']>['yarnLots'] | undefined; lotRequired: boolean }) {
  const warehouses = state.context.data?.warehouses ?? [];
  return (
    <>
      <YarnLinesEditor title={lotRequired ? 'Brüt iplik çıkışı (cağlık) — lot ZORUNLU' : 'Brüt iplik çıkışı (cağlık)'} lines={f.issues} warehouses={warehouses} withReason={false} onChange={(issues) => set({ issues })} disabled={state.busy} lots={lots} lotRequired={lotRequired} />
      <YarnLinesEditor title="Dip iadesi" lines={f.returns} warehouses={warehouses} withReason onChange={(returns) => set({ returns })} disabled={state.busy} lots={lots} />
      <View style={sheet.row}>
        <View style={sheet.col}>
          <Text style={sheet.label}>Kopuş adedi (isteğe bağlı)</Text>
          <NumpadInput value={f.breakCount} onChangeText={(t) => set({ breakCount: t })} allowDecimal={false} numpadMaxLength={5} numpadLabel="Kopuş" placeholder="—" style={sheet.input} />
        </View>
      </View>
    </>
  );
}

type Machine = NonNullable<DevereScreenState['context']['data']>['machines'][number];

function MachinePicker({ visible, machines, selected, loading, onDismiss, onSelect }: { visible: boolean; machines: Machine[]; selected: string; loading: boolean; onDismiss: () => void; onSelect: (id: string) => void }) {
  return (
    <PickerModal
      visible={visible}
      title="Devere makinesi seç"
      options={machines.map((m) => ({ value: m.id, label: m.name, sublabel: `${m.code} · ${m.stationName}` }))}
      selectedValue={selected}
      loading={loading}
      emptyText={NO_DEVERE_MACHINE_HINT}
      onDismiss={onDismiss}
      onSelect={onSelect}
    />
  );
}

export default function WindModal({ state }: { state: DevereScreenState }) {
  const [machinePicker, setMachinePicker] = useState(false);
  const beam = state.modal?.kind === 'wind' ? state.modal.beam : null;
  const f = state.windForm;
  const ctx = state.context.data;
  if (!beam || !f) return null;
  const inHouse = beam.originKind === 'IN_HOUSE';
  const denier = beam.warpSpec.yarnItem.linearDensityDen;
  const nominal = theoreticalKg(beam.warpSpec.endsCount, denier, Number(f.lengthM.replace(',', '.')));
  const machines = ctx?.machines ?? [];
  const machineName = machines.find((m) => m.id === f.machineId)?.name ?? '';
  // Faz 2: lot adayları kartın ipliğine süzülür; sunucu göndermiyorsa (eski) seçici çizilmez. Kapı sunucudan.
  const lots = ctx?.yarnLots ? ctx.yarnLots.filter((l) => l.itemId === beam.warpSpec.yarnItem.id) : undefined;
  const lotRequired = ctx?.lotRequired ?? false;
  const set = (patch: Partial<typeof f>) => state.setWindForm({ ...f, ...patch });

  return (
    <DevereSheet
      visible
      onDismiss={state.closeModal}
      title={`${beam.beamNo} — sar`}
      subtitle={`${beam.warpSpec.code} · ${beam.warpSpec.endsCount} tel · ${ORIGIN_LABEL[beam.originKind]} · plan ${beam.plannedLengthM} m`}
      footer={
        <>
          <Button onPress={state.closeModal} disabled={state.busy}>Vazgeç</Button>
          <Button mode="contained" onPress={state.submitWind} loading={state.busy} disabled={state.busy || !state.isOnline}>Sarımı Kaydet</Button>
        </>
      }
      overlays={<MachinePicker visible={machinePicker} machines={machines} selected={f.machineId ?? ''} loading={state.context.isLoading} onDismiss={() => setMachinePicker(false)} onSelect={(v) => { set({ machineId: v }); setMachinePicker(false); }} />}
    >
      <View style={sheet.row}>
        <View style={sheet.col}>
          <Text style={sheet.label}>Sarılan metre</Text>
          <NumpadInput value={f.lengthM} onChangeText={(t) => set({ lengthM: t })} allowDecimal numpadMaxLength={8} numpadLabel="Sarılan metre" placeholder="m" style={sheet.input} />
          {denier == null ? (
            <Text style={sheet.warn}>İplik kartında denye yok — sunucu nominal kg hesaplayamaz; kaydet 400 verir, kartı düzelttirin.</Text>
          ) : (
            <Text style={sheet.hint}>{`Nominal ≈ ${nominal ?? '—'} kg`}</Text>
          )}
        </View>
        <View style={sheet.col}>
          <Text style={sheet.label}>Adet (raşel takımı — 1 = tek levent)</Text>
          <NumpadInput value={f.count} onChangeText={(t) => set({ count: t })} allowDecimal={false} numpadMaxLength={2} numpadLabel="Adet" placeholder="1" style={sheet.input} />
          {(setCount(f) ?? 1) > 1 ? <Text style={sheet.hint}>{`${setCount(f)} levent birlikte doğar; iplik satırları TOPLAMDIR, levent başına pay ÷ ${setCount(f)}.`}</Text> : null}
        </View>
      </View>
      {(setCount(f) ?? 1) > 1 ? (
        <>
          <Text style={sheet.label}>Gövde no öneki (isteğe bağlı, ör. R7 → R7-1 …)</Text>
          <ModalTextInput value={f.physicalBeamNoPrefix} onChangeText={(t) => set({ physicalBeamNoPrefix: t })} maxLength={28} placeholder="—" style={sheet.input} dense />
        </>
      ) : null}
      <View style={sheet.row}>
        <View style={sheet.col}>
          <Text style={sheet.label}>Kg kaynağı</Text>
          <SegmentedButtons value={f.kgSource} onValueChange={(v) => set({ kgSource: v as WarpKgSource })} buttons={(['WEIGHED', 'THEORETICAL'] as WarpKgSource[]).map((k) => ({ value: k, label: KG_SOURCE_LABEL[k], labelStyle: sheet.segmentLabel }))} />
        </View>
        {inHouse ? (
          <View style={sheet.col}>
            <Field label="Devere makinesi" value={machineName} placeholder={machines.length ? 'Seçilmedi' : 'Makine yok'} onPress={() => setMachinePicker(true)} hint={machines.length ? undefined : NO_DEVERE_MACHINE_HINT} />
          </View>
        ) : null}
      </View>
      {inHouse ? (
        <InHouseYarnSection f={f} set={set} state={state} lots={lots} lotRequired={lotRequired} />
      ) : (
        <Text style={sheet.hint}>Fason/hazır levent: makine ve iplik satırı yazılmaz — iplik tüketimi bizim defterde değil.</Text>
      )}
      {state.formError ? <Text style={sheet.error}>{state.formError}</Text> : null}
    </DevereSheet>
  );
}
