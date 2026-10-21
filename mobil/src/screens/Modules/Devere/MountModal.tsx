// =============================================================================
// TEZGAHA TAK — hazır leventi tezgah yuvasına bağla (Faz 3 E3; devere ekranı "Tezgahta" sekmesi)
// =============================================================================
// Makine listesi bağlam ucundan (`loomMachines`, yuva sayısıyla); yuva 1..slots; yöntem
// `mountTrackingRequired` açıkken zorunlu (başlangıç saati "şimdi" gider). Kural `tezgahPayload`ta.
// TEK KART (`ModuleSheet`). S3c: tezgah etiketi okutulur (liste yedek), oturum makinesi varsa
// tezgah adımı yok; yuva yalnız çok yuvalıda sorulur; TAK 112dp istasyon düğmesi.
// =============================================================================
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, Button, SegmentedButtons } from 'react-native-paper';
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import StationActionButton from '../../../components/StationActionButton';
import TruncatedText from '../../../components/TruncatedText';
import { moduleAccents, spacing } from '../../../theme';
import { slotNeedsInput } from './beamScan';
import NumpadInput from '../../../components/NumpadInput';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import ModuleSheet, { SheetField, sheet } from '../../../components/ModuleSheet';
import type { WarpBeamMountMethod } from '../../../services/warpBeam.service';
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
  const [camera, setCamera] = useState(false);
  const [code, setCode] = useState('');
  const beam = state.beam;
  if (!beam) return null;
  const f = state.form;
  const machine = loomMachines.find((m) => m.id === f.machineId) ?? null;
  const options: PickerOption[] = loomMachines.map((m) => ({ value: m.id, label: m.name, sublabel: `${m.code} · ${m.stationName} · ${m.warpBeamSlots} yuva` }));
  return (
    <ModuleSheet
      visible
      onDismiss={state.close}
      title={`${beam.beamNo} — tezgaha tak`}
      subtitle={`${beam.warpSpec.code} · kalan ${beam.remainingM} m · levent seçilen makinenin yuvasına bağlanır; dolu yuva reddedilir.`}
      footer={<Button onPress={state.close} disabled={state.pending}>Vazgeç</Button>}
      overlays={
        <>
        <BarcodeScannerModal visible={camera} title="Tezgah etiketini okut" trigger="auto" onDismiss={() => setCamera(false)} onScan={(c) => { setCamera(false); state.scanMachine(c); }} />
        <PickerModal visible={picker} title="Tezgah seç" options={options} selectedValue={f.machineId ?? ''} emptyText="Levent tüketen istasyonda aktif makine yok — istasyon kartında 'levent tüketir' işaretlenir." onDismiss={() => setPicker(false)} onSelect={(v) => { state.setForm({ ...f, machineId: v, position: '1' }); setPicker(false); }} />
        </>
      }
    >
      {state.presetMachineId ? (
        <TruncatedText style={sheet.label}>{`Tezgah: ${machine ? `${machine.code} — ${machine.name}` : 'bu tezgah'} (oturum)`}</TruncatedText>
      ) : (
        <>
          <ScannerEntryBar value={code} onChangeText={setCode} placeholder="Tezgah etiketi okut/yaz…" onResolve={() => { state.scanMachine(code); setCode(''); }} onScan={() => setCamera(true)} scanCtaLabel="Tezgah etiketini okut" tone="indigo" />
          <SheetField label="Tezgah / makine (listeden)" value={machine ? `${machine.code} — ${machine.name}` : ''} placeholder={loomMachines.length ? 'Okutun ya da seçin' : 'Levent tüketen istasyonda makine yok'} onPress={() => setPicker(true)} />
        </>
      )}
      {slotNeedsInput(state.slots) ? (
        <View style={sheet.row}>
          <View style={sheet.col}>
            <Text style={sheet.label}>{`Yuva (1..${state.slots ?? '?'})`}</Text>
            <NumpadInput value={f.position} onChangeText={(t) => state.setForm({ ...f, position: t })} numpadMaxLength={2} numpadLabel="Yuva" placeholder="1" style={sheet.input} />
          </View>
        </View>
      ) : null}
      <Text style={sheet.label}>{`Bağlama yöntemi${methodRequired ? ' (zorunlu)' : ' (isteğe bağlı)'}`}</Text>
      <SegmentedButtons
        value={f.mountMethod ?? NONE}
        onValueChange={(v) => state.setForm({ ...f, mountMethod: v === NONE ? null : (v as WarpBeamMountMethod) })}
        buttons={[{ value: NONE, label: '—', labelStyle: sheet.segmentLabel }, ...(Object.keys(MOUNT_METHOD_LABEL) as WarpBeamMountMethod[]).map((k) => ({ value: k, label: MOUNT_METHOD_LABEL[k], labelStyle: sheet.segmentLabel }))]}
      />
      <View style={sheet.row}>
        <View style={sheet.col}>
          <Text style={sheet.label}>Tezgah sayacı (m, isteğe bağlı)</Text>
          <NumpadInput value={f.machineCounter} onChangeText={(t) => state.setForm({ ...f, machineCounter: t })} allowDecimal numpadMaxLength={9} numpadLabel="Tezgah sayacı" placeholder="—" style={sheet.input} />
        </View>
      </View>
      {state.error ? <Text style={sheet.error}>{state.error}</Text> : null}
      <View style={styles.action}>
        <StationActionButton label={machine ? `TAK — ${machine.code}` : 'TAK'} icon="connection" onPress={state.submit} tint={moduleAccents.Devere.tint} loading={state.pending} loadingLabel="Takılıyor…" disabled={!isOnline} size="xl" testID="mount-tak" />
      </View>
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({ action: { marginTop: spacing.md } });
