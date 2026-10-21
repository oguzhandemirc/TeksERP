// =============================================================================
// SAR İSTASYONU — sol sütun: kart · hedef levent · metre (numpad) · kg · gövde · makine · iplik → SAR
// =============================================================================
// İstasyon dili (KK1/Kurşun/Tambur): sol form + büyük ana düğme; okutma bandı ve numpad sağda.
// Metre TEK `autoActivate` alan (açılışta numpad ona bağlı). Seçiciler `PickerModal`; iplik
// satırları `WindYarnSheet` (PagedSheet). Mantık `useWindStation` + `windStation.ts`.
// =============================================================================
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip, SegmentedButtons, Text } from 'react-native-paper';
import NumpadInput from '../../../components/NumpadInput';
import ModalTextInput from '../../../components/ModalTextInput';
import PickerModal from '../../../components/PickerModal';
import StationActionButton from '../../../components/StationActionButton';
import { SheetField, sheet } from '../../../components/ModuleSheet';
import { colors, moduleAccents, spacing, typography } from '../../../theme';
import type { TabletContext, WarpBeam, WarpKgSource } from '../../../services/warpBeam.service';
import { KG_SOURCE_LABEL, linesTotalKg, physicalBeamBusyWarning } from './beamPayload';
import { NO_DEVERE_MACHINE_HINT } from './WindPages';
import WindYarnSheet from './WindYarnSheet';
import { lengthFromWeight, oldestPlannedFor, stationNominalKg, yarnItemIdFor } from './windStation';
import type { WindStationState } from './useWindStation';

interface Props {
  station: WindStationState;
  context: TabletContext | undefined;
  isOnline: boolean;
  /** Gövde çakışması erken uyarısı için canlı leventler (sunucu 409 aynası). */
  busyBeams: readonly WarpBeam[];
  /** Lot süzgecinin iplik kalemi için bilinen leventler. */
  knownBeams: readonly WarpBeam[];
}

type Picker = 'spec' | 'machine' | 'order' | 'yarn' | null;

function TargetChips({ station }: { station: WindStationState }) {
  const { form, target, livePlanned, setTarget } = station;
  if (!form) return null;
  const oldest = oldestPlannedFor(livePlanned, form.warpSpecId);
  return (
    <View style={styles.chips}>
      <Chip selected={form.target.kind !== 'new' && !!target} disabled={!oldest && !target} onPress={() => setTarget({ kind: 'auto' })} icon="clipboard-list-outline">
        {target ? `Planlı ${target.beamNo} · ${target.plannedLengthM} m` : 'Planlı levent yok'}
      </Chip>
      <Chip selected={!target} onPress={() => setTarget({ kind: 'new' })} icon="plus">
        Yeni levent
      </Chip>
    </View>
  );
}

function KgBlock({ station }: { station: WindStationState }) {
  const { form, spec, patch } = station;
  if (!form) return null;
  if (form.issues.length !== 1) {
    return <Text style={sheet.hint}>{`İplik çıkışı ${form.issues.length} satır · ${linesTotalKg(form.issues)} kg — satırlar "İplik satırları"nda.`}</Text>;
  }
  const nominal = stationNominalKg(spec, form.lengthM);
  const weighed = Number(form.weighedKg.replace(',', '.'));
  const fromWeight = spec && weighed > 0 ? lengthFromWeight(weighed, spec.endsCount, spec.denier) : null;
  return (
    <>
      <View>
        <SegmentedButtons value={form.kgSource} onValueChange={(v) => patch({ kgSource: v as WarpKgSource })} buttons={(['WEIGHED', 'THEORETICAL'] as WarpKgSource[]).map((k) => ({ value: k, label: KG_SOURCE_LABEL[k], labelStyle: sheet.segmentLabel }))} />
      </View>
      {form.kgSource === 'WEIGHED' ? (
        <>
          <Text style={sheet.label}>Tartı kg (cağlığa çıkan brüt iplik)</Text>
          <NumpadInput value={form.weighedKg} onChangeText={(t) => patch({ weighedKg: t })} allowDecimal numpadMaxLength={8} numpadLabel="Tartı kg" placeholder="kg" style={sheet.input} />
          <Text style={sheet.hint}>{`Nominal ≈ ${nominal ?? '—'} kg${fromWeight != null ? ` · tartı ≈ ${fromWeight} m karşılığı` : ''}`}</Text>
        </>
      ) : (
        <Text style={styles.nominal} testID="sar-nominal-kg">
          {spec?.denier == null ? 'İplik kartında denye yok — nominal hesaplanamaz; tartın.' : `Nominal ${nominal ?? '—'} kg (tel × m × denye ÷ 9.000.000)`}
        </Text>
      )}
    </>
  );
}

export default function WindStationForm({ station, context, isOnline, busyBeams, knownBeams }: Props) {
  const [picker, setPicker] = useState<Picker>(null);
  const { form, spec, target, patch } = station;
  if (!form) return <Text style={sheet.hint}>Form bağlamı yükleniyor…</Text>;
  const machines = context?.machines ?? [];
  const machine = machines.find((m) => m.id === form.machineId);
  const orders = context?.weavingOrders ?? [];
  const order = orders.find((o) => o.id === form.weavingOrderId);
  const busyWarning = target ? null : physicalBeamBusyWarning(form.physicalBeamNo, busyBeams, null);
  const close = () => setPicker(null);

  return (
    <View style={styles.root}>
      <SheetField label="Çözgü kartı" value={spec ? `${spec.code} — ${spec.name} · ${spec.endsCount} tel` : ''} placeholder="Seçin" onPress={() => setPicker('spec')} />
      <TargetChips station={station} />
      <Text style={sheet.label}>Sarılan metre</Text>
      <NumpadInput value={form.lengthM} onChangeText={(t) => patch({ lengthM: t })} allowDecimal numpadMaxLength={8} numpadLabel="Sarılan metre" placeholder="m" autoActivate style={sheet.input} />
      <KgBlock station={station} />
      {target ? (
        <Text style={sheet.hint}>{`Gövde no: ${target.physicalBeamNo ?? '—'} (planda yazılı)`}</Text>
      ) : (
        <>
          <Text style={sheet.label}>Gövde no (okutun ya da yazın)</Text>
          <ModalTextInput value={form.physicalBeamNo} onChangeText={(t) => patch({ physicalBeamNo: t })} maxLength={32} placeholder="—" style={sheet.input} dense />
          {busyWarning ? <Text style={sheet.warn}>{busyWarning}</Text> : null}
        </>
      )}
      <SheetField label="Devere makinesi" value={machine ? `${machine.code} · ${machine.stationName}` : ''} placeholder={machines.length ? 'Seçin' : 'Makine yok'} onPress={() => setPicker('machine')} hint={machines.length ? undefined : NO_DEVERE_MACHINE_HINT} />
      {!target && orders.length > 0 ? <SheetField label="Dokuma işi" value={order ? `${order.weavingOrderNumber} · ${order.item.code}` : ''} placeholder={context?.beamWeavingLinkRequired ? 'Seçin (zorunlu)' : 'Bağsız'} onPress={() => setPicker('order')} /> : null}
      <SheetField label="İplik satırları" value={`${form.issues.length} çıkış · ${form.returns.length} iade${form.breakCount.trim() ? ` · kopuş ${form.breakCount}` : ''}`} placeholder="—" onPress={() => setPicker('yarn')} />
      {station.error ? <Text style={sheet.error}>{station.error}</Text> : null}
      {!isOnline ? <Text style={sheet.error}>Bağlantı yok — sarım yalnız çevrimiçi (levent no sunucuda doğar).</Text> : null}
      <View style={styles.action}>
        {/* TODO(S3): StationActionButton `size="xl"` (112dp) S3'te ortak bileşene eklenince buraya geçilir; şimdilik `large` (72dp). */}
        <StationActionButton label={target ? `SAR — ${target.beamNo}` : 'PLANLA + SAR'} icon="rotate-right" onPress={station.submit} tint={moduleAccents.Devere.tint} loading={station.busy} loadingLabel="Kaydediliyor…" disabled={!isOnline} large />
      </View>

      <PickerModal visible={picker === 'spec'} title="Çözgü kartı" options={(context?.warpSpecs ?? []).map((s) => ({ value: s.id, label: s.code, sublabel: `${s.name} · ${s.endsCount} tel` }))} selectedValue={form.warpSpecId} onSelect={(v) => { station.selectSpec(v); close(); }} onDismiss={close} emptyText="Tanımlı çözgü kartı yok — panelden ekleyin." />
      <PickerModal visible={picker === 'machine'} title="Devere makinesi" options={machines.map((m) => ({ value: m.id, label: m.code, sublabel: m.stationName }))} selectedValue={form.machineId} onSelect={(v) => { patch({ machineId: v }); close(); }} onDismiss={close} emptyText={NO_DEVERE_MACHINE_HINT} />
      <PickerModal visible={picker === 'order'} title="Dokuma işi" options={orders.map((o) => ({ value: o.id, label: o.weavingOrderNumber, sublabel: o.item.code }))} selectedValue={form.weavingOrderId} onSelect={(v) => { patch({ weavingOrderId: v }); close(); }} onDismiss={close} />
      <WindYarnSheet visible={picker === 'yarn'} form={form} spec={spec} context={context} yarnItemId={target?.warpSpec.yarnItem.id ?? yarnItemIdFor(form.warpSpecId, knownBeams)} onApply={patch} onDismiss={close} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  nominal: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text, marginTop: spacing.xs },
  action: { marginTop: spacing.md },
});
