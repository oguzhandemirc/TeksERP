// Belge satırının ölçü alanları: gelen metre kutusu (+ doğrulama / düzeltme), metre düzeltme sayfası ve kurşun gramajı.
// `DocRowCard.tsx` 300 satır tavanında olduğundan ayrı dosya; `GramajField` tek formda "Diğer alanlar"da da çizilir.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ModuleSheet from '../../../../components/ModuleSheet';
import NumpadInput from '../../../../components/NumpadInput';
import { ChoiceChips } from '../../../../components/form/ChoiceChips';
import { DOC_HIGHLIGHT_BG } from '../../../../components/DocHighlight';
import { colors, radius, spacing, typography } from '../../../../theme';
import { meterChoices, parseMeters } from '../approvalGate';
import type { DocRow, WoRowsState } from './useWoRows';
import { InlineField } from './InlineField';
import { NoticeStrip } from '../../../../components/form/NoticeStrip';

interface MeterProps {
  row: DocRow;
  wo: WoRowsState;
  meterText: string | null;
  locked: boolean;
  onEdit: () => void;
}

/** Salt okunur "Gelen metre" kutusu: belgeden geldiyse sarı + belge ikonu, doğrulama bekliyorsa amber kenar, yoksa kırmızı. */
export function MeterField({ row, wo, meterText, locked, onEdit }: MeterProps) {
  const f = row.form!;
  // Okunan metre elle düzeltilmediyse sarı vurgu (belgeden geldi).
  const read = row.detail?.kursunMeters != null && row.detail.kursunMeters !== '' ? Number(row.detail.kursunMeters) : null;
  const fromDoc = read !== null && f.meters === read;
  const value = meterText?.replace(/ m$/, '') ?? null;
  return (
    <View style={styles.wrap} testID={`belge-satir-metre-${row.noteNo}`}>
      <View style={styles.row}>
        <View
          testID={fromDoc ? `belgeden-metre-${row.noteNo}` : undefined}
          style={[styles.box, fromDoc && styles.boxDoc, f.metersReview && styles.boxReview, !value && styles.boxMissing]}
        >
          <View style={styles.boxHead}>
            <Text style={styles.boxLabel}>Gelen metre</Text>
            {fromDoc ? <MaterialCommunityIcons name="file-document-check-outline" size={16} color={colors.textSecondary} /> : null}
          </View>
          {value ? (
            <Text style={styles.value}>
              {value}
              <Text style={styles.unit}> m</Text>
            </Text>
          ) : (
            <Text style={styles.missing}>Metre yok</Text>
          )}
        </View>
        {f.metersReview && (
          <Button mode="contained-tonal" icon="check" onPress={() => wo.updateForm(row.noteId, { metersReview: false })} disabled={locked}
            buttonColor={colors.warningContainer} textColor={colors.warningText} contentStyle={styles.btn} testID={`belge-satir-dogrula-${row.noteNo}`}>
            Doğru
          </Button>
        )}
        <Button mode="outlined" icon="pencil" onPress={onEdit} disabled={locked} contentStyle={styles.btn} testID={`belge-satir-duzelt-${row.noteNo}`}>
          {meterText ? 'Düzelt' : 'Metre gir'}
        </Button>
      </View>
      {f.metersReview && <Text style={styles.help}>Metreyi belgeyle karşılaştırın.</Text>}
    </View>
  );
}

/** Gramaj yalnız rotada kurşun adımı ve katalogda değer varsa çizilir; varsayılan ön seçili gelir (sözleşme 5). */
export function GramajField({ row, wo, locked }: { row: DocRow; wo: WoRowsState; locked: boolean }) {
  const f = row.form!;
  if (!wo.showGramaj || wo.catalog.options.length === 0) return null;
  const no = row.noteNo;
  return (
    <InlineField label="Gramaj" testID={`belge-serit-gramaj-${no}`}>
      <ChoiceChips
        options={wo.catalog.options.map((o) => ({ value: o.id, label: o.isDefault ? `${o.name} ★` : o.name, a11y: o.isDefault ? `${o.name}, varsayılan` : o.name, testID: `belge-satir-gramaj-${no}-${o.name}` }))}
        value={f.gramajValueId ?? null}
        onChange={(v) => wo.updateForm(row.noteId, { gramajValueId: v === f.gramajValueId ? null : v })}
        disabled={locked}
        testID={`belge-satir-gramaj-${no}`}
      />
    </InlineField>
  );
}

/** Kat tipi — gramajın altında aynı satır biçimiyle (tambur adımının üretim bilgisi; kurşun gramajı gibi baştan sorulur). */
export function FoldField(p: { values: readonly { code: string; name: string }[]; value: string | null; locked: boolean; onChange: (code: string) => void }) {
  // Kat kataloğu boş (özellik pasif): seçilecek değer yok, kayıt engellenmez — yalnız bilgi.
  if (p.values.length === 0) return <NoticeStrip tone="warn" text="Kat değeri tanımlı değil (seçmeden de kaydedilir) — panelden Kumaş Özellikleri → KAT ekleyin." testID="ie-form-kat-bos" />;
  return (
    <InlineField label="Kat tipi" testID="ie-form-kat-satir">
      <ChoiceChips
        options={p.values.map((f) => ({ value: f.code, label: f.name, testID: `ie-form-kat-${f.code}` }))}
        value={p.value}
        onChange={(v) => v && p.onChange(v)}
        disabled={p.locked}
        testID="ie-form-kat"
      />
    </InlineField>
  );
}

interface SheetProps {
  choices: ReturnType<typeof meterChoices>;
  current: string | null;
  onDismiss: () => void;
  onSave: (m: number) => void;
}

export function MeterSheet({ choices, current, onDismiss, onSave }: SheetProps) {
  const [text, setText] = useState('');
  const entered = parseMeters(text);
  return (
    <ModuleSheet
      visible
      onDismiss={onDismiss}
      title="Kurşun metresi"
      subtitle={current ? `Okunan: ${current}` : 'Belgeden okunamadı'}
      size="sm"
      footer={
        <View style={styles.actions}>
          <Button onPress={onDismiss} contentStyle={styles.btn}>
            Vazgeç
          </Button>
          <Button mode="contained" disabled={entered === null} onPress={() => entered !== null && onSave(entered)} contentStyle={styles.btn} testID="belge-satir-metre-kaydet">
            Kaydet
          </Button>
        </View>
      }
    >
      <View style={styles.chips}>
        {choices.map((m) => (
          <Chip key={m.role} onPress={() => onSave(m.value)} style={styles.chip}>
            {`${m.label}: ${m.text}`}
          </Chip>
        ))}
      </View>
      <NumpadInput value={text} onChangeText={setText} label="Metre" mode="outlined" useNativeKeyboard allowDecimal testID="belge-satir-metre-giris" />
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  box: {
    minWidth: 180,
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  boxDoc: { backgroundColor: DOC_HIGHLIGHT_BG },
  boxReview: { borderWidth: 2, borderColor: colors.warning },
  boxMissing: { borderWidth: 2, borderColor: colors.danger, backgroundColor: colors.dangerContainer },
  boxHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  boxLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  value: { fontSize: 24, fontWeight: '700', color: colors.text },
  unit: { fontSize: 16, fontWeight: '600', color: colors.textSecondary },
  missing: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.dangerText },
  help: { fontSize: typography.size.sm, color: colors.warningText },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 56, justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  btn: { minHeight: 56 },
});
