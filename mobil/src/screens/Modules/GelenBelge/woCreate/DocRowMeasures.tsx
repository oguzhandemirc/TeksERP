// Belge satırının ölçü alanları: gelen metre kutusu (+ doğrulama / düzeltme), metre düzeltme sayfası ve kurşun gramajı.
// `DocRowCard.tsx` 300 satır tavanında olduğundan ayrı dosya; `GramajField` tek formda "Diğer alanlar"da da çizilir.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, Text } from 'react-native-paper';
import ModuleSheet from '../../../../components/ModuleSheet';
import NumpadInput from '../../../../components/NumpadInput';
import { ChoiceChips } from '../../../../components/form/ChoiceChips';
import { defaultChoiceText } from '../../../../components/form/defaultChoice';
import { colors, spacing, typography } from '../../../../theme';
import { meterChoices, parseMeters } from '../approvalGate';
import type { DocRow, WoRowsState } from './useWoRows';
import { InlineField } from './InlineField';
import { DeclaredField, declaredLayout } from './DeclaredField';
import { NoticeStrip } from '../../../../components/form/NoticeStrip';

interface MeterProps {
  row: DocRow;
  wo: WoRowsState;
  meterText: string | null;
  locked: boolean;
  onEdit: () => void;
}

/** "Gelen metre" beyan kutusu: belgeden geldiyse sarı, doğrulama bekliyorsa amber kenar + "Doğru", yoksa kırmızı; dokununca düzeltme. */
export function MeterField({ row, wo, meterText, locked, onEdit }: MeterProps) {
  const f = row.form!;
  // Okunan metre elle düzeltilmediyse sarı vurgu (belgeden geldi).
  const read = row.detail?.kursunMeters != null && row.detail.kursunMeters !== '' ? Number(row.detail.kursunMeters) : null;
  const fromDoc = read !== null && f.meters === read;
  const value = meterText?.replace(/ m$/, '') ?? null;
  return (
    <View style={styles.wrap} testID={`belge-satir-metre-${row.noteNo}`}>
      <View style={declaredLayout.row}>
        <DeclaredField label="Gelen metre" value={value} unit="m" fromDoc={fromDoc} review={f.metersReview} missing={!value} emptyText="Yok — dokunun"
          onPress={onEdit} disabled={locked} testID={`belge-satir-metre-kutu-${row.noteNo}`} />
        {f.metersReview && (
          <Button mode="contained-tonal" icon="check" onPress={() => wo.updateForm(row.noteId, { metersReview: false })} disabled={locked}
            buttonColor={colors.warningContainer} textColor={colors.warningText} contentStyle={styles.btn} testID={`belge-satir-dogrula-${row.noteNo}`}>
            Doğru
          </Button>
        )}
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
        options={wo.catalog.options.map((o) => ({ value: o.id, ...defaultChoiceText(o.name, o.isDefault), testID: `belge-satir-gramaj-${no}-${o.name}` }))}
        value={f.gramajValueId ?? null}
        onChange={(v) => wo.updateForm(row.noteId, { gramajValueId: v === f.gramajValueId ? null : v })}
        disabled={locked}
        testID={`belge-satir-gramaj-${no}`}
      />
    </InlineField>
  );
}

/** Kat tipi — gramajın altında aynı satır biçimiyle (tambur adımının üretim bilgisi; kurşun gramajı gibi baştan sorulur). */
export function FoldField(p: { values: readonly { code: string; name: string; isDefault?: boolean }[]; value: string | null; locked: boolean; onChange: (code: string) => void }) {
  // Kat kataloğu boş (özellik pasif): seçilecek değer yok, kayıt engellenmez — yalnız bilgi.
  if (p.values.length === 0) return <NoticeStrip tone="warn" text="Kat değeri tanımlı değil (seçmeden de kaydedilir) — panelden Kumaş Özellikleri → KAT ekleyin." testID="ie-form-kat-bos" />;
  return (
    <InlineField label="Kat tipi" testID="ie-form-kat-satir">
      <ChoiceChips
        options={p.values.map((f) => ({ value: f.code, ...defaultChoiceText(f.name, f.isDefault), testID: `ie-form-kat-${f.code}` }))}
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
      title="Gelen metre"
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
  wrap: { gap: spacing.xs, flexGrow: 1, flexBasis: 150, minWidth: 150 },
  help: { fontSize: typography.size.sm, color: colors.warningText },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 56, justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  btn: { minHeight: 56 },
});
