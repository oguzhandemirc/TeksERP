// Rehberli tanıtma paneli (K30-A2): üstte geçerli adım kartı ("şunun değerine dokunun" + anında okunan değer + Sonraki/Bu belgede
// yok), altında alan listesi — her alan ✓ + belgeden okunan değer (fosforlu vurgu) ya da "Ata"; satıra dokunmak o adıma gider.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import { DocHighlight } from '../../../../components/DocHighlight';
import ModalTextInput from '../../../../components/ModalTextInput';
import TruncatedText from '../../../../components/TruncatedText';
import { colors, radius, spacing, typography } from '../../../../theme';
import type { SuggestResult } from '../../../../types/inboundDocTeach';
import { chipStatus, fieldLabel, fieldReadout, FINISH_STEP, GUIDED_FIELDS, stepField, type ChipStatus, type FieldKey } from './guided';
import { clearField, type TeachState } from './teachDraft';

interface Props {
  state: TeachState;
  onChange: (fn: (s: TeachState) => TeachState) => void;
  step: number;
  onStep: (n: number) => void;
  skipped: readonly FieldKey[];
  onSkip: (k: FieldKey) => void;
  preview: { result: SuggestResult | null; fresh: boolean; error: string | null; blocked?: string | null };
}

export default function GuidedPanel({ state, onChange, step, onStep, skipped, onSkip, preview }: Props) {
  const key = stepField(step);
  const next = () => onStep(Math.min(step + 1, FINISH_STEP));
  const headers = state.identifiers.filter((d) => d.on).map((d) => d.text);
  return (
    <View style={styles.panel} testID="tanit-rehber">
      <View style={styles.stepCard}>
        {step === 0 && (
          <>
            <Text style={styles.ask} testID="tanit-soru">Belgenin başlığına dokunun</Text>
            <Text style={styles.hint}>Her belgede aynı yazan satır (başlık, firma adı). Önerilenler seçili.</Text>
            <Text style={styles.small} testID="tanit-baslik-secili">
              {headers.map((t) => `“${t}”`).join(' · ') || 'Henüz başlık seçilmedi.'}
            </Text>
            {preview.fresh && preview.result?.preview && !preview.result.preview.matched && (
              <Text style={styles.warn} testID="tanit-baslik-tanimiyor">Bu başlıkla tanınmıyor; başlıkta başka bir yazıya da dokunun.</Text>
            )}
          </>
        )}
        {key && (
          <>
            <Text style={styles.ask} testID="tanit-soru">{`${fieldLabel(key)} değerine dokunun`}</Text>
            <Text style={styles.hint}>Yalnız değere dokunun; etiketi kendiliğinden bulunur.</Text>
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
              {GUIDED_FIELDS.map((k) => `${fieldLabel(k)}: ${chipStatus(state, k, skipped) === 'done' ? (fieldValue(state, k, preview) ?? (preview.fresh ? 'okunamadı' : 'işaretli')) : 'yok'}`).join(' · ')}
            </Text>
          </>
        )}
        <View style={styles.actions}>
          {key && (
            <>
              <Button mode="text" icon="tag-off-outline" onPress={() => onChange((s) => clearField(s, key))} disabled={!state.fields[key]?.length} contentStyle={styles.btn} testID="tanit-etiket-degistir">
                Etiketi değiştir
              </Button>
              <Button mode="outlined" icon="close-circle-outline" onPress={() => { onSkip(key); next(); }} contentStyle={styles.btn} testID="tanit-yok">
                Bu belgede yok
              </Button>
            </>
          )}
          {step < FINISH_STEP && (
            <Button mode="contained-tonal" icon="arrow-right" onPress={next} contentStyle={styles.btn} testID="tanit-sonraki">
              Sonraki
            </Button>
          )}
        </View>
      </View>

      <FieldList state={state} step={step} onStep={onStep} skipped={skipped} preview={preview} />
    </View>
  );
}

/** Alan listesi: her satır bir adım; kayıtlı alan ✓ + okunan değer (vurgulu), atanmamış "Ata". */
function FieldList({ state, step, onStep, skipped, preview }: Omit<Props, 'onChange' | 'onSkip'>) {
  const headers = state.identifiers.filter((d) => d.on).map((d) => d.text);
  return (
    <View style={styles.list} testID="tanit-alanlar">
      <StepRow label="Başlık" status={headers.length ? 'done' : 'todo'} value={headers[0] ?? null} doc={false} active={step === 0} onPress={() => onStep(0)} testID="tanit-adim-baslik" />
      {GUIDED_FIELDS.map((k, i) => (
        <StepRow
          key={k}
          k={k}
          label={fieldLabel(k)}
          status={chipStatus(state, k, skipped)}
          value={fieldValue(state, k, preview)}
          doc
          active={step === i + 1}
          onPress={() => onStep(i + 1)}
          testID={`tanit-adim-${k}`}
        />
      ))}
      <StepRow label="Ad ve kaydet" status="todo" value={state.name.trim() || null} doc={false} active={step === FINISH_STEP} onPress={() => onStep(FINISH_STEP)} testID="tanit-adim-bitir" finish />
    </View>
  );
}

/** Listede gösterilecek okunan değer: yalnız okuma kesinse (tazeyse ya da kayıtlı alansa); yoksa null. */
function fieldValue(state: TeachState, k: FieldKey, preview: Props['preview']): string | null {
  const r = fieldReadout(state, k, preview);
  return r.kind === 'ok' ? r.value : null;
}

function FieldResult({ state, k, preview }: { state: TeachState; k: FieldKey; preview: Props['preview'] }) {
  const r = fieldReadout(state, k, preview);
  if (r.kind === 'idle') return null;
  if (r.kind === 'loading') return <Text style={styles.small} testID="tanit-okunan">Okunuyor…</Text>;
  if (r.kind === 'ok') {
    return (
      <View style={styles.result} testID="tanit-okunan">
        <View style={styles.okRow}>
          <Text style={styles.okLabel}>{'Okunan: '}</Text>
          <DocHighlight active style={styles.hl}>
            <TruncatedText style={styles.ok}>{r.value}</TruncatedText>
          </DocHighlight>
        </View>
        <Text style={styles.small}>{r.kept ? 'Kayıtlı — değiştirmek için yeni değere dokunun.' : r.label ? `Etiket: “${r.label}”` : 'Etiket yok; konumundan okunur.'}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.result, styles.warnBox]} testID="tanit-okunan">
      <Text style={styles.warn}>{r.kind === 'empty' ? 'Değer okunamadı — başka bir kutuya dokunun.' : r.text}</Text>
    </View>
  );
}

const STATUS_TEXT = { done: 'kayıtlı', skipped: 'yok', todo: 'atanmadı' } as const;

interface RowProps {
  k?: FieldKey;
  label: string;
  status: ChipStatus;
  value: string | null;
  /** Değer belgeden kendiliğinden okunduysa fosforlu vurgu. */
  doc: boolean;
  active: boolean;
  onPress: () => void;
  testID: string;
  finish?: boolean;
}

function StepRow({ k, label, status, value, doc, active, onPress, testID, finish }: RowProps) {
  const icon = finish ? 'flag-checkered' : status === 'done' ? 'check-circle' : status === 'skipped' ? 'minus-circle-outline' : 'circle-outline';
  const tint = finish ? colors.brand : status === 'done' ? colors.success : colors.textMuted;
  return (
    <TouchableRipple
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={finish ? label : `${label}: ${STATUS_TEXT[status]}`}
      accessibilityState={{ selected: active }}
      style={[styles.row, active && styles.rowActive]}
      testID={testID}
    >
      <View style={styles.rowInner}>
        <Icon source={icon} size={24} color={tint} />
        <Text style={[styles.rowLabel, active && styles.rowLabelActive]}>{label}</Text>
        {value ? (
          <DocHighlight active={doc} style={styles.hl}>
            <TruncatedText style={styles.rowValue} testID={k ? `tanit-deger-${k}` : undefined}>{value}</TruncatedText>
          </DocHighlight>
        ) : !finish && status !== 'done' ? (
          <Text style={status === 'skipped' ? styles.rowMuted : styles.rowAssign}>{status === 'skipped' ? 'Yok' : 'Ata'}</Text>
        ) : null}
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md },
  stepCard: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  ask: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, color: colors.text },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary },
  small: { fontSize: typography.size.sm, color: colors.textSecondary },
  result: { gap: spacing.xs, paddingVertical: spacing.xs },
  okRow: { flexDirection: 'row', alignItems: 'center' },
  okLabel: { fontSize: typography.size.base, color: colors.textSecondary },
  ok: { fontSize: typography.size.xl, fontWeight: typography.weight.semibold, color: colors.text },
  hl: { flexShrink: 1, paddingHorizontal: spacing.xs },
  warnBox: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningContainer },
  warn: { fontSize: typography.size.base, color: colors.warningText },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xs },
  btn: { minHeight: 56 },
  list: { borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden' },
  row: { minHeight: 56, justifyContent: 'center', paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowActive: { backgroundColor: colors.brandContainer },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowLabel: { width: 120, fontSize: typography.size.base, color: colors.text },
  rowLabelActive: { fontWeight: typography.weight.semibold },
  rowValue: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  rowAssign: { marginLeft: 'auto', fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.brand },
  rowMuted: { marginLeft: 'auto', fontSize: typography.size.sm, color: colors.textMuted },
});
