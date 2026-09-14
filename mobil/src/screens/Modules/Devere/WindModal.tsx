// =============================================================================
// SAR — metre · kg kaynağı · (IN_HOUSE) devere makinesi + brüt çıkış + dip iadesi + kopuş
// =============================================================================
// Alanlar backend `windSchema` ile birebir (`beamPayload.buildWindPayload`). Fason/hazır
// kökende makine ve iplik satırı ÇİZİLMEZ — sunucu 400 verir, form hiç kurmaz.
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, SegmentedButtons } from 'react-native-paper';
import AppModal from '../../../components/AppModal';
import NumpadInput from '../../../components/NumpadInput';
import PickerModal from '../../../components/PickerModal';
import { colors, spacing, typography } from '../../../theme';
import type { WarpKgSource } from '../../../services/warpBeam.service';
import { KG_SOURCE_LABEL, ORIGIN_LABEL, theoreticalKg } from './beamPayload';
import { Field } from './PlanModal';
import YarnLinesEditor from './YarnLinesEditor';
import type { DevereScreenState } from './useDevereScreen';

export default function WindModal({ state }: { state: DevereScreenState }) {
  const [machinePicker, setMachinePicker] = useState(false);
  const beam = state.modal?.kind === 'wind' ? state.modal.beam : null;
  const f = state.windForm;
  const ctx = state.context.data;
  if (!beam || !f) return null;
  const inHouse = beam.originKind === 'IN_HOUSE';
  const denier = beam.warpSpec.yarnItem.linearDensityDen;
  const nominal = theoreticalKg(beam.warpSpec.endsCount, denier, Number(f.lengthM.replace(',', '.')));
  const machineName = ctx?.machines.find((m) => m.id === f.machineId)?.name ?? '';
  const warehouses = ctx?.warehouses ?? [];
  const set = (patch: Partial<typeof f>) => state.setWindForm({ ...f, ...patch });

  return (
    <AppModal visible onDismiss={state.closeModal} position="center">
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{`${beam.beamNo} — sar`}</Text>
        <Text style={styles.sub}>{`${beam.warpSpec.code} · ${beam.warpSpec.endsCount} tel · ${ORIGIN_LABEL[beam.originKind]} · plan ${beam.plannedLengthM} m`}</Text>
        <Text style={styles.label}>Sarılan metre</Text>
        <NumpadInput value={f.lengthM} onChangeText={(t) => set({ lengthM: t })} allowDecimal numpadMaxLength={8} numpadLabel="Sarılan metre" placeholder="m" style={styles.input} />
        {denier == null ? (
          <Text style={styles.warn}>İplik kartında denye yok — sunucu nominal kg hesaplayamaz; kaydet 400 verir, kartı düzelttirin.</Text>
        ) : (
          <Text style={styles.hint}>{`Nominal ≈ ${nominal ?? '—'} kg`}</Text>
        )}
        <Text style={styles.label}>Kg kaynağı</Text>
        <View>
          <SegmentedButtons value={f.kgSource} onValueChange={(v) => set({ kgSource: v as WarpKgSource })} buttons={(['WEIGHED', 'THEORETICAL'] as WarpKgSource[]).map((k) => ({ value: k, label: KG_SOURCE_LABEL[k] }))} />
        </View>
        {inHouse ? (
          <>
            <Field label="Devere makinesi" value={machineName} placeholder="Seçilmedi" onPress={() => setMachinePicker(true)} />
            <YarnLinesEditor title="Brüt iplik çıkışı (cağlık)" lines={f.issues} warehouses={warehouses} withReason={false} onChange={(issues) => set({ issues })} disabled={state.busy} />
            <YarnLinesEditor title="Dip iadesi" lines={f.returns} warehouses={warehouses} withReason onChange={(returns) => set({ returns })} disabled={state.busy} />
            <Text style={styles.label}>Kopuş adedi (isteğe bağlı)</Text>
            <NumpadInput value={f.breakCount} onChangeText={(t) => set({ breakCount: t })} allowDecimal={false} numpadMaxLength={5} numpadLabel="Kopuş" placeholder="—" style={styles.input} />
          </>
        ) : (
          <Text style={styles.hint}>Fason/hazır levent: makine ve iplik satırı yazılmaz — iplik tüketimi bizim defterde değil.</Text>
        )}
        {state.formError ? <Text style={styles.error}>{state.formError}</Text> : null}
        <View style={styles.actions}>
          <Button onPress={state.closeModal} disabled={state.busy}>Vazgeç</Button>
          <Button mode="contained" onPress={state.submitWind} loading={state.busy} disabled={state.busy || !state.isOnline}>Sarımı Kaydet</Button>
        </View>
      </ScrollView>
      <PickerModal
        visible={machinePicker}
        title="Devere makinesi seç"
        options={(ctx?.machines ?? []).map((m) => ({ value: m.id, label: m.name, sublabel: `${m.code} · ${m.stationName}` }))}
        selectedValue={f.machineId ?? ''}
        loading={state.context.isLoading}
        emptyText="Devere makinesi tanımlı değil — istasyon kataloğunda 'levent üretir' işareti gerekir."
        onDismiss={() => setMachinePicker(false)}
        onSelect={(v) => {
          set({ machineId: v });
          setMachinePicker(false);
        }}
      />
    </AppModal>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text },
  sub: { fontSize: typography.size.sm, color: colors.textSecondary, marginBottom: spacing.sm },
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold, marginTop: spacing.sm },
  input: { backgroundColor: colors.surface },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary, marginTop: spacing.xs },
  warn: { fontSize: typography.size.sm, color: colors.warningText, marginTop: spacing.xs },
  error: { color: colors.dangerText, marginTop: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
});
