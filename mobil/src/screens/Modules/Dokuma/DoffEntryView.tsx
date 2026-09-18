// =============================================================================
// İNDİR formu — parça sayısı (numpad) · sayaç (tek dokunuş / elle) · koşum · not
// =============================================================================
import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, TouchableRipple, Icon, ActivityIndicator } from 'react-native-paper';
import NumpadInput from '../../../components/NumpadInput';
import { colors, spacing, radius, typography } from '../../../theme';
import type { DoffEntry } from './useDoffEntry';
import type { MachineDataSource } from '../../../types/models';

const SOURCE_LABEL: Record<MachineDataSource, string> = {
  MACHINE: 'Cihazdan okundu',
  INFERRED: 'Türetildi',
  OPERATOR: 'Elle girildi',
  SUPERVISOR: 'Süpervizör',
  SIMULATED: 'SİMÜLASYON — gerçek ölçüm değil',
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableRipple onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </TouchableRipple>
  );
}

function LineChips({ entry }: { entry: DoffEntry }) {
  if (entry.lineCount <= 1) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.label}>Hat</Text>
      <View style={styles.chips}>
        {Array.from({ length: entry.lineCount }, (_, i) => i + 1).map((n) => (
          <Chip key={n} on={entry.lineNo === n} label={`Hat ${n}`} onPress={() => entry.setLineNo(n)} />
        ))}
      </View>
    </View>
  );
}

function RunChips({ entry }: { entry: DoffEntry }) {
  const { form, selectRun, openRuns, runsLoading } = entry;
  if (runsLoading) return <ActivityIndicator />;
  if (openRuns.length === 0) {
    return (
      <View style={styles.amber}>
        <Icon source="alert-outline" size={18} color={colors.warningText} />
        <Text style={styles.amberText}>Bu hatta açık koşum yok — indirme iş emri metresine GİRMEZ (yine kaydedilir).</Text>
      </View>
    );
  }
  return (
    <View style={styles.chips}>
      <Chip on={form.machineRunId === null} label="Koşumsuz" onPress={() => selectRun(null)} />
      {openRuns.map((r) => (
        <Chip
          key={r.id}
          on={form.machineRunId === r.id}
          label={`Koşum ${fmtTime(r.startedAt)}${r.weavingOrderId ? '' : ' (iş emrisiz)'}`}
          onPress={() => selectRun(r.id)}
        />
      ))}
    </View>
  );
}

export default function DoffEntryView({ entry }: { entry: DoffEntry }) {
  const { form, patch, reading, readMeterIntoForm } = entry;
  const counterEmpty = form.counter.trim() === '';
  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <LineChips entry={entry} />

      <Text style={styles.label}>İndirilen parça sayısı</Text>
      <NumpadInput
        value={form.pieceCount}
        onChangeText={(t) => patch({ pieceCount: t })}
        allowDecimal={false}
        numpadMaxLength={4}
        numpadLabel="Parça sayısı"
        placeholder="1"
        style={styles.bigInput}
        autoActivate
      />

      <Text style={styles.label}>Sayaç (tezgah metre/atkı sayacı)</Text>
      <View style={styles.row}>
        <NumpadInput
          value={form.counter}
          onChangeText={(t) => patch({ counter: t, counterSource: 'OPERATOR' })}
          allowDecimal={false}
          numpadMaxLength={9}
          numpadLabel="Sayaç"
          placeholder="okunmadı"
          style={[styles.input, styles.grow]}
        />
        <Button mode="contained-tonal" icon="gauge" onPress={() => void readMeterIntoForm()} disabled={reading} loading={reading}>
          Oku
        </Button>
      </View>
      <Text style={[styles.hint, form.counterSource === 'SIMULATED' && styles.warn]}>
        {counterEmpty ? 'Boş bırakılabilir — "okunmadı" olarak kaydedilir.' : SOURCE_LABEL[form.counterSource]}
      </Text>

      <Text style={styles.label}>Koşum (iş emri bağı)</Text>
      <RunChips entry={entry} />

      <Text style={styles.label}>Not (isteğe bağlı)</Text>
      <NumpadInput value={form.notes} onChangeText={(t) => patch({ notes: t })} useNativeKeyboard placeholder="Kısa not" style={styles.input} maxLength={300} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold, marginTop: spacing.sm },
  hint: { fontSize: typography.size.xs, color: colors.textMuted },
  warn: { color: colors.warningText, fontWeight: typography.weight.semibold },
  bigInput: { fontSize: 36, fontWeight: typography.weight.bold, textAlign: 'center', backgroundColor: colors.surface },
  input: { backgroundColor: colors.surface },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, minHeight: 44, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.brandContainer, borderColor: colors.brand },
  chipText: { color: colors.text },
  chipTextOn: { color: colors.brandDark, fontWeight: typography.weight.semibold },
  amber: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', backgroundColor: colors.warningContainer, borderRadius: radius.md, padding: spacing.md },
  amberText: { flex: 1, color: colors.warningText },
});
