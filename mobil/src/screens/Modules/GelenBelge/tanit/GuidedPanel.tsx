// Rehberli tanıtma paneli (K30-A2): üstte adım çipleri, ortada "şunun değerine dokunun" + anında okunan değer, altta
// Sonraki · Bu belgede yok · Etiketi değiştir. Sıfırdan kullanan çalışan için: tek soru, tek dokunuş, hemen sonuç.
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Chip, Text } from 'react-native-paper';
import ModalTextInput from '../../../../components/ModalTextInput';
import { colors, radius, spacing, typography } from '../../../../theme';
import type { SuggestResult } from '../../../../types/inboundDocTeach';
import { chipStatus, fieldLabel, fieldReadout, FINISH_STEP, GUIDED_FIELDS, stepField, type FieldKey } from './guided';
import { clearField, type TeachState } from './teachDraft';

interface Props {
  state: TeachState;
  onChange: (fn: (s: TeachState) => TeachState) => void;
  step: number;
  onStep: (n: number) => void;
  skipped: readonly FieldKey[];
  onSkip: (k: FieldKey) => void;
  preview: { result: SuggestResult | null; fresh: boolean; error: string | null };
}

export default function GuidedPanel({ state, onChange, step, onStep, skipped, onSkip, preview }: Props) {
  const key = stepField(step);
  const next = () => onStep(Math.min(step + 1, FINISH_STEP));
  return (
    <View style={styles.panel} testID="tanit-rehber">
      <ScrollView horizontal contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        <StepChip label="Başlık" status={state.identifiers.some((d) => d.on) ? 'done' : 'todo'} active={step === 0} onPress={() => onStep(0)} testID="tanit-adim-baslik" />
        {GUIDED_FIELDS.map((k, i) => (
          <StepChip key={k} label={fieldLabel(k)} status={chipStatus(state, k, skipped)} active={step === i + 1} onPress={() => onStep(i + 1)} testID={`tanit-adim-${k}`} />
        ))}
        <StepChip label="Bitir" status="todo" active={step === FINISH_STEP} onPress={() => onStep(FINISH_STEP)} testID="tanit-adim-bitir" />
      </ScrollView>
      {step === 0 && (
        <>
          <Text style={styles.ask} testID="tanit-soru">Belgenin başlığına dokunun</Text>
          <Text style={styles.hint}>Başlık, firma adı gibi her belgede aynı yazan satırlar bu belge tipini tanıtır. Önerilenler seçili geldi; dokunarak ekleyip çıkarabilirsiniz.</Text>
          <Text style={styles.small} testID="tanit-baslik-secili">
            {state.identifiers.filter((d) => d.on).map((d) => `“${d.text}”`).join(' · ') || 'Henüz başlık seçilmedi.'}
          </Text>
          {preview.fresh && preview.result?.preview && !preview.result.preview.matched && (
            <Text style={styles.warn} testID="tanit-baslik-tanimiyor">Belge bu başlıkla tanınmıyor; başlıkta başka bir yazıya da dokunun.</Text>
          )}
        </>
      )}
      {key && (
        <>
          <Text style={styles.ask} testID="tanit-soru">{`${fieldLabel(key)} değerine dokunun`}</Text>
          <Text style={styles.hint}>Yalnız değere dokunun (ör. 2618733); yanındaki etiket kendiliğinden bulunur. Değer birkaç kelimeyse hepsine dokunun.</Text>
          <FieldResult state={state} k={key} preview={preview} />
        </>
      )}
      {step === FINISH_STEP && (
        <>
          <Text style={styles.ask} testID="tanit-soru">Belge tipine ad verin ve kaydedin</Text>
          <ModalTextInput
            label="Belge tipinin adı"
            mode="outlined"
            value={state.name}
            maxLength={80}
            placeholder="ör. Güleçsoy çeki listesi"
            onChangeText={(name) => onChange((s) => ({ ...s, name }))}
            testID="tanit-rehber-ad"
          />
          <Text style={styles.small} testID="tanit-ozet">
            {GUIDED_FIELDS.map((k) => `${fieldLabel(k)}: ${chipStatus(state, k, skipped) === 'done' ? (preview.fresh ? (preview.result?.preview?.fields[k] ?? 'okunamadı') : 'işaretli') : 'yok'}`).join(' · ')}
          </Text>
        </>
      )}
      <View style={styles.actions}>
        {key && (
          <>
            <Button mode="outlined" icon="tag-off-outline" onPress={() => onChange((s) => clearField(s, key))} disabled={!state.fields[key]?.length} contentStyle={styles.btn} testID="tanit-etiket-degistir">
              Etiketi değiştir
            </Button>
            <Button mode="outlined" icon="close-circle-outline" onPress={() => { onSkip(key); next(); }} contentStyle={styles.btn} testID="tanit-yok">
              Bu belgede yok
            </Button>
          </>
        )}
        {step < FINISH_STEP && (
          <Button mode="contained" icon="arrow-right" onPress={next} contentStyle={styles.btn} testID="tanit-sonraki">
            Sonraki
          </Button>
        )}
      </View>
    </View>
  );
}

function FieldResult({ state, k, preview }: { state: TeachState; k: FieldKey; preview: Props['preview'] }) {
  const r = fieldReadout(state, k, preview);
  if (r.kind === 'idle') return null;
  if (r.kind === 'loading') return <Text style={styles.small} testID="tanit-okunan">Okunuyor…</Text>;
  if (r.kind === 'ok') {
    return (
      <View style={[styles.result, styles.okBox]} testID="tanit-okunan">
        <Text style={styles.ok}>{`Okunan: ${r.value}`}</Text>
        <Text style={styles.small}>{r.label ? `Etiket: “${r.label}”` : 'Etiket bulunamadı; değer sayfadaki konumundan okunur.'}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.result, styles.warnBox]} testID="tanit-okunan">
      <Text style={styles.warn}>{r.kind === 'empty' ? 'Bu seçimle değer okunamadı — etiketi değiştirin (başka bir kutuya dokunun).' : r.text}</Text>
    </View>
  );
}

function StepChip({ label, status, active, onPress, testID }: { label: string; status: 'done' | 'skipped' | 'todo'; active: boolean; onPress: () => void; testID: string }) {
  const icon = status === 'done' ? 'check' : status === 'skipped' ? 'minus' : undefined;
  return (
    <Chip icon={icon} selected={active} showSelectedCheck={false} mode={active ? 'flat' : 'outlined'} onPress={onPress} style={styles.chip} testID={testID} accessibilityState={{ selected: active }}>
      {label}
    </Chip>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.sm },
  chips: { gap: spacing.xs, paddingVertical: spacing.xs },
  chip: { minHeight: 56, justifyContent: 'center' },
  ask: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, color: colors.text },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary },
  small: { fontSize: typography.size.sm, color: colors.textSecondary },
  result: { padding: spacing.md, borderRadius: radius.md, gap: spacing.xs },
  okBox: { backgroundColor: colors.successContainer },
  warnBox: { backgroundColor: colors.warningContainer },
  ok: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: colors.successText },
  warn: { fontSize: typography.size.base, color: colors.warningText },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm },
  btn: { minHeight: 56 },
});
