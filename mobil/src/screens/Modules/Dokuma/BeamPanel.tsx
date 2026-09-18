// =============================================================================
// LEVENT PANELİ (Faz 3 E3) — bu tezgahtaki bağlı leventler: SÖK · TÜKET · BİTİR
// =============================================================================
// Yalnız devere + `devere.mountTracking` açıkken çizilir; Tak devere ekranındadır (yuva seçimi
// orada). Kalan sunucuda türetilir; tüketim kalanı aşamaz (form önden kilitler, sunucu 409).
// =============================================================================
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, ActivityIndicator, SegmentedButtons } from 'react-native-paper';
import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import NumpadInput from '../../../components/NumpadInput';
import { colors, spacing, radius, typography } from '../../../theme';
import type { WarpLengthSource } from '../../../services/warpBeam.service';
import { LENGTH_SOURCE_LABEL } from '../Devere/tezgahPayload';
import type { DoffEntry } from './useDoffEntry';
import { useBeamPanel, type BeamPanelState } from './useBeamPanel';

const SOURCES = (Object.keys(LENGTH_SOURCE_LABEL) as WarpLengthSource[]).filter((k) => k !== 'WEIGHED');

/** Ölçüm kaynağı — segment tam genişlik, etiket KESİLMEZ (`sheet.segmentLabel`; sığmazsa PickerModal'a döner). */
function SourcePicker({ value, onChange }: { value: WarpLengthSource; onChange: (v: WarpLengthSource) => void }) {
  return <SegmentedButtons value={value} onValueChange={(v) => onChange(v as WarpLengthSource)} buttons={SOURCES.map((k) => ({ value: k, label: LENGTH_SOURCE_LABEL[k], labelStyle: sheet.segmentLabel }))} />;
}

function BeamModal({ state }: { state: BeamPanelState }) {
  const m = state.modal;
  if (!m) return null;
  const { kind, beam } = m;
  const title = kind === 'dismount' ? `${beam.beamNo} — tezgahtan sök` : kind === 'consume' ? `${beam.beamNo} — tüketim yaz` : `${beam.beamNo} — bitir (levent dibi)`;
  const confirm = kind === 'dismount' ? 'SÖK' : kind === 'consume' ? 'YAZ' : 'BİTİR';
  return (
    <ModuleSheet
      visible
      onDismiss={state.close}
      title={title}
      subtitle={`${beam.warpSpecCode} · yuva ${beam.position ?? '—'} · kalan ${beam.remainingM} m`}
      size="sm"
      footer={
        <>
          <Button onPress={state.close} disabled={state.pending}>Vazgeç</Button>
          <Button mode="contained" buttonColor={kind === 'exhaust' ? colors.danger : undefined} onPress={state.submit} loading={state.pending} disabled={state.pending || !state.isOnline}>{confirm}</Button>
        </>
      }
    >
      {kind === 'dismount' ? (
        <>
          <Text style={sheet.label}>Ölçülen kalan (m, isteğe bağlı — boşsa defterdeki kalan)</Text>
          <NumpadInput value={state.dismountForm.remainingM} onChangeText={(t) => state.setDismountForm({ ...state.dismountForm, remainingM: t })} allowDecimal numpadMaxLength={9} numpadLabel="Ölçülen kalan" placeholder="—" style={sheet.input} />
          <Text style={sheet.label}>Ölçüm kaynağı</Text>
          <SourcePicker value={state.dismountForm.lengthSource} onChange={(v) => state.setDismountForm({ ...state.dismountForm, lengthSource: v })} />
          <Text style={sheet.hint}>Levent hazır stoğa döner; açık koşum varken son levent sökülemez.</Text>
        </>
      ) : kind === 'consume' ? (
        <>
          <Text style={sheet.label}>Tüketilen metre</Text>
          <NumpadInput value={state.consumeForm.lengthM} onChangeText={(t) => state.setConsumeForm({ ...state.consumeForm, lengthM: t })} allowDecimal numpadMaxLength={9} numpadLabel="Tüketilen metre" placeholder="ör. 250" style={sheet.input} />
          <Text style={sheet.label}>Ölçüm kaynağı</Text>
          <SourcePicker value={state.consumeForm.lengthSource} onChange={(v) => state.setConsumeForm({ ...state.consumeForm, lengthSource: v })} />
        </>
      ) : (
        <>
          <Text style={sheet.label}>Artık (m, isteğe bağlı — boşsa 0 sayılır)</Text>
          <NumpadInput value={state.exhaustForm.residualM} onChangeText={(t) => state.setExhaustForm({ ...state.exhaustForm, residualM: t })} allowDecimal numpadMaxLength={9} numpadLabel="Artık" placeholder="0" style={sheet.input} />
          <Text style={sheet.label}>Ölçüm kaynağı</Text>
          <SourcePicker value={state.exhaustForm.lengthSource} onChange={(v) => state.setExhaustForm({ ...state.exhaustForm, lengthSource: v })} />
          <Text style={sheet.hint}>Bitiş son kayıttır: kalan sıfırlanır, yuva boşalır. Tartı ve dispozisyon panelden.</Text>
        </>
      )}
      {state.error ? <Text style={sheet.error}>{state.error}</Text> : null}
    </ModuleSheet>
  );
}

export default function BeamPanel({ entry }: { entry: DoffEntry }) {
  const state = useBeamPanel({ machineId: entry.machine?.id ?? null, isOnline: entry.isOnline });
  if (!state.enabled) return null;
  const locked = !entry.isOnline || state.pending;
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.heading}>{`Levent · ${state.beams.length} bağlı`}</Text>
        <Button compact icon="refresh" onPress={() => void state.refetch()}>Yenile</Button>
      </View>
      {state.loading ? <ActivityIndicator /> : null}
      {state.isError ? <Text style={styles.error}>Levent listesi alınamadı.</Text> : null}
      {!state.loading && state.beams.length === 0 ? <Text style={styles.meta}>Bu tezgahta bağlı levent yok — takma Levent Sarım ekranından.</Text> : null}
      {state.beams.map((b) => (
        <View key={b.id} style={styles.beamRow}>
          <View style={styles.grow}>
            <Text style={styles.code}>{`${b.beamNo} · yuva ${b.position ?? '—'}`}</Text>
            <Text style={styles.meta}>{`${b.warpSpecCode} · kalan ${b.remainingM} m`}</Text>
          </View>
          <Button compact icon="scissors-cutting" disabled={locked} onPress={() => state.open('consume', b)}>Tüket</Button>
          <Button compact icon="flag-checkered" disabled={locked} onPress={() => state.open('exhaust', b)}>Bitir</Button>
          <Button compact mode="contained-tonal" icon="connection" disabled={locked} onPress={() => state.open('dismount', b)}>Sök</Button>
        </View>
      ))}
      <BeamModal state={state} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { margin: spacing.md, marginTop: 0, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.text },
  beamRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs, borderTopWidth: 1, borderColor: colors.border },
  grow: { flex: 1 },
  code: { fontWeight: typography.weight.semibold, color: colors.text },
  meta: { fontSize: typography.size.sm, color: colors.textSecondary },
  error: { color: colors.dangerText, marginTop: spacing.sm },
});
