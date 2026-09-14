// =============================================================================
// TEZGAHA TAK — hazır leventi tezgah yuvasına bağla (Faz 3 E3; devere ekranı "Tezgahta" sekmesi)
// =============================================================================
// Makine listesi bağlam ucundan (`loomMachines`, yuva sayısıyla); yuva 1..slots; yöntem
// `mountTrackingRequired` açıkken zorunlu (başlangıç saati "şimdi" gider). Kural `tezgahPayload`ta.
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, SegmentedButtons } from 'react-native-paper';
import AppModal from '../../../components/AppModal';
import NumpadInput from '../../../components/NumpadInput';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import { colors, spacing, typography } from '../../../theme';
import type { WarpBeamMountMethod } from '../../../services/warpBeam.service';
import { Field } from './PlanModal';
import { MOUNT_METHOD_LABEL } from './tezgahPayload';
import type { MountFormState } from './useMountForm';

interface Props {
  state: MountFormState;
  loomMachines: { id: string; code: string; name: string; stationName: string; warpBeamSlots: number }[];
  methodRequired: boolean;
  isOnline: boolean;
}

const NONE = '__none__';

export default function MountModal({ state, loomMachines, methodRequired, isOnline }: Props) {
  const [picker, setPicker] = useState(false);
  const beam = state.beam;
  if (!beam) return null;
  const f = state.form;
  const machine = loomMachines.find((m) => m.id === f.machineId) ?? null;
  const options: PickerOption[] = loomMachines.map((m) => ({ value: m.id, label: m.name, sublabel: `${m.code} · ${m.stationName} · ${m.warpBeamSlots} yuva` }));
  return (
    <AppModal visible onDismiss={state.close} position="center">
      <Text style={styles.title}>{`${beam.beamNo} — tezgaha tak`}</Text>
      <Text style={styles.body}>{`${beam.warpSpec.code} · kalan ${beam.remainingM} m. Levent seçilen makinenin yuvasına bağlanır; dolu yuva reddedilir.`}</Text>
      <Field label="Tezgah / makine" value={machine ? `${machine.code} — ${machine.name}` : ''} placeholder={loomMachines.length ? 'Seçilmedi' : 'Levent tüketen istasyonda makine yok'} onPress={() => setPicker(true)} />
      <Text style={styles.label}>{`Yuva (1..${state.slots ?? '?'})`}</Text>
      <NumpadInput value={f.position} onChangeText={(t) => state.setForm({ ...f, position: t })} numpadMaxLength={2} numpadLabel="Yuva" placeholder="1" style={styles.input} />
      <Text style={styles.label}>{`Bağlama yöntemi${methodRequired ? ' (zorunlu)' : ' (isteğe bağlı)'}`}</Text>
      <SegmentedButtons
        value={f.mountMethod ?? NONE}
        onValueChange={(v) => state.setForm({ ...f, mountMethod: v === NONE ? null : (v as WarpBeamMountMethod) })}
        buttons={[{ value: NONE, label: '—' }, ...(Object.keys(MOUNT_METHOD_LABEL) as WarpBeamMountMethod[]).map((k) => ({ value: k, label: MOUNT_METHOD_LABEL[k] }))]}
      />
      <Text style={styles.label}>Tezgah sayacı (m, isteğe bağlı)</Text>
      <NumpadInput value={f.machineCounter} onChangeText={(t) => state.setForm({ ...f, machineCounter: t })} allowDecimal numpadMaxLength={9} numpadLabel="Tezgah sayacı" placeholder="—" style={styles.input} />
      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
      <View style={styles.actions}>
        <Button onPress={state.close} disabled={state.pending}>Vazgeç</Button>
        <Button mode="contained" onPress={state.submit} loading={state.pending} disabled={state.pending || !isOnline}>TAK</Button>
      </View>
      <PickerModal visible={picker} title="Tezgah seç" options={options} selectedValue={f.machineId ?? ''} emptyText="Levent tüketen istasyonda aktif makine yok — istasyon kartında 'levent tüketir' işaretlenir." onDismiss={() => setPicker(false)} onSelect={(v) => { state.setForm({ ...f, machineId: v, position: '1' }); setPicker(false); }} />
    </AppModal>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text, marginBottom: spacing.sm },
  body: { color: colors.textSecondary, marginBottom: spacing.sm },
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold, marginTop: spacing.sm },
  input: { backgroundColor: colors.surface },
  error: { color: colors.dangerText, marginTop: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
});
