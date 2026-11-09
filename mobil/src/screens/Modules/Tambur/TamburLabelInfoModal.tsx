// Etiket bilgisi (Gülkesim 2026-11-09): tamburcu müşteriyi arayıp etikete basılacak kumaş adı / renk /
// parti no'yu öğrenir; değer SONRAKİ toplara gider (topa kesimde yazılır, İE'de saklanmaz). Kumaşın gerçek adı değişmez.
// İE geneli düzeltmenin ad/renk anahtarları burada gösterilmez; kalan anahtarlar (en vb.) "Diğer etiket alanları"nda.
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Checkbox, Icon, IconButton, Text, TouchableRipple } from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import ModuleSheet from '../../../components/ModuleSheet';
import ModalTextInput from '../../../components/ModalTextInput';
import PickerModal from '../../../components/PickerModal';
import { tamburService } from '../../../services/tambur.service';
import { showScreenError } from '../../../lib/screenToast';
import { colors, spacing } from '../../../theme/tokens';
import { overridePatch } from './finalLabel';
import { LABEL_BATCH_MAX } from './labelBatch';
import { LABEL_TEXT_MAX, NAME_OVERRIDE_KEYS, emptyHint } from './labelTexts';
import { useTamburLabelSuggestions, type TamburFinalLabelState } from './useTamburFinalLabel';

type OverrideDraft = Record<string, { text: string; blank: boolean }>;
type FieldKey = 'item' | 'color' | 'batch';

export interface TamburLabelInfoModalProps {
  visible: boolean;
  onDismiss: () => void;
  /** İş emri (Diğer etiket alanları için); yoksa o bölüm çizilmez. */
  workOrderId: string | null;
  /** Etkin kesim akışının etiket durumu (açık kumaş ya da Top Kesme). */
  final: TamburFinalLabelState;
  /** Boş kutuda basılacak kaynak değerler — silik ipucu. */
  defaults?: { itemName?: string | null; colorName?: string | null; batchNo?: string | null };
}

const FIELD_META: Record<FieldKey, { label: string; picker: string; generic: string; max: number }> = {
  item: { label: 'Kumaş adı', picker: 'Etikete basılacak kumaş adı', generic: 'kumaşın kendi adı', max: LABEL_TEXT_MAX },
  color: { label: 'Renk', picker: 'Etikete basılacak renk', generic: 'kumaşın kendi rengi', max: LABEL_TEXT_MAX },
  batch: { label: 'Parti no', picker: 'Etikete basılacak parti no', generic: 'bizim parti no', max: LABEL_BATCH_MAX },
};

export default function TamburLabelInfoModal({ visible, onDismiss, workOrderId, final, defaults }: TamburLabelInfoModalProps) {
  const qc = useQueryClient();
  const batchEnabled = final.batch.enabled;
  const sugg = useTamburLabelSuggestions(final.suggestionParams, visible);
  const [draft, setDraft] = useState<Record<FieldKey, string>>({ item: '', color: '', batch: '' });
  const [picking, setPicking] = useState<FieldKey | null>(null);
  const [freeOpen, setFreeOpen] = useState(false);
  const [freeText, setFreeText] = useState('');
  const [othersOpen, setOthersOpen] = useState(false);
  const [ovDraft, setOvDraft] = useState<OverrideDraft>({});

  // Pencere her açılışta güncel yapışkan değerle başlar; öneriler tazelenir (yeni kesimin değeri listeye girsin).
  useEffect(() => {
    if (!visible) return;
    setDraft({ item: final.texts.itemName, color: final.texts.colorName, batch: final.batch.value });
    setOthersOpen(false);
    void sugg.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const ov = useQuery({
    queryKey: ['labels', 'wo-overrides', workOrderId],
    queryFn: () => tamburService.getLabelOverrides(workOrderId as string),
    enabled: visible && othersOpen && !!workOrderId,
  });
  const otherKeys = (ov.data?.keys ?? []).filter((k) => !NAME_OVERRIDE_KEYS.has(k.key));
  useEffect(() => {
    if (!ov.data) return;
    const d: OverrideDraft = {};
    for (const k of ov.data.keys) {
      if (NAME_OVERRIDE_KEYS.has(k.key)) continue;
      const v = ov.data.overrides[k.key];
      d[k.key] = { text: v ?? '', blank: v === '' };
    }
    setOvDraft(d);
  }, [ov.data]);

  const saveOverrides = useMutation({
    mutationFn: (patch: Record<string, string | null>) =>
      tamburService.putLabelOverrides(workOrderId as string, { overrides: patch, updatedAt: ov.data?.updatedAt ?? null }),
    onSuccess: (res) => qc.setQueryData(['labels', 'wo-overrides', workOrderId], res),
  });

  const submit = async () => {
    final.texts.set({ itemName: draft.item, colorName: draft.color });
    if (batchEnabled) final.batch.setValue(draft.batch);
    if (ov.data && workOrderId) {
      const patch = overridePatch(ov.data.overrides, ovDraft);
      if (Object.keys(patch).length > 0) {
        try {
          await saveOverrides.mutateAsync(patch);
        } catch (err) {
          showScreenError(err as Error, 'Diğer etiket alanları kaydedilemedi');
          return;
        }
      }
    }
    Toast.show({ type: 'success', text1: 'Etiket bilgisi kaydedildi', text2: 'Sonraki toplara basılır.' });
    onDismiss();
  };

  const options = (key: FieldKey): string[] =>
    key === 'item' ? (sugg.data?.itemNames ?? []) : key === 'color' ? (sugg.data?.colorNames ?? []) : (sugg.data?.batchNos ?? []);
  const fallback: Record<FieldKey, string | null | undefined> = { item: defaults?.itemName, color: defaults?.colorName, batch: defaults?.batchNo };
  const closePicker = () => {
    setPicking(null);
    setFreeOpen(false);
  };
  const choose = (key: FieldKey, value: string) => {
    setDraft((d) => ({ ...d, [key]: value.slice(0, FIELD_META[key].max) }));
    closePicker();
  };
  const fields: FieldKey[] = batchEnabled ? ['item', 'color', 'batch'] : ['item', 'color'];

  return (
    <ModuleSheet
      visible={visible}
      onDismiss={onDismiss}
      size="sm"
      title="Etikete basılacak (sonraki toplar)"
      subtitle="Değer sonraki kesimlerde aynen kalır. Boş kutu: kumaşın kendi adı/rengi basılır."
      footer={
        <View style={s.actions}>
          <Button mode="text" onPress={onDismiss} contentStyle={s.btn}>Vazgeç</Button>
          <Button mode="contained" onPress={() => void submit()} loading={saveOverrides.isPending} disabled={saveOverrides.isPending} contentStyle={s.btn} testID="etiket-bilgisi-kaydet">
            Kaydet
          </Button>
        </View>
      }
      overlays={
        picking ? (
          <PickerModal
            visible
            title={FIELD_META[picking].picker}
            options={options(picking).map((v) => ({ value: v, label: v }))}
            selectedValue={draft[picking] || null}
            numColumns={1}
            disableSort
            loading={sugg.isLoading}
            emptyText="Bu müşteride önceki değer yok — kendin yaz"
            leadingAction={{
              label: 'Kendim yazayım',
              sublabel: 'Listede olmayan bir değer',
              icon: 'pencil-outline',
              onPress: () => {
                setFreeText(draft[picking]);
                setFreeOpen(true);
              },
            }}
            quickAddSlot={
              freeOpen ? (
                <View style={s.freeBox}>
                  <ModalTextInput
                    mode="outlined"
                    autoFocus
                    value={freeText}
                    onChangeText={setFreeText}
                    maxLength={FIELD_META[picking].max}
                    autoCapitalize="characters"
                    placeholder={FIELD_META[picking].label}
                    onSubmitEditing={() => choose(picking, freeText)}
                    testID="etiket-serbest-input"
                  />
                  <View style={s.actions}>
                    <Button mode="outlined" onPress={() => setFreeOpen(false)} contentStyle={s.btn}>Vazgeç</Button>
                    <Button mode="contained" onPress={() => choose(picking, freeText)} contentStyle={s.btn} testID="etiket-serbest-kullan">Kullan</Button>
                  </View>
                </View>
              ) : null
            }
            onSelect={(v) => choose(picking, v)}
            onDismiss={closePicker}
          />
        ) : null
      }
    >
      {fields.map((key) => (
        <LabelFieldRow
          key={key}
          label={FIELD_META[key].label}
          value={draft[key]}
          hint={emptyHint(fallback[key], FIELD_META[key].generic)}
          onPress={() => setPicking(key)}
          onClear={() => setDraft((d) => ({ ...d, [key]: '' }))}
          testID={`etiket-${key}`}
        />
      ))}

      {workOrderId ? (
        <TouchableRipple onPress={() => setOthersOpen((o) => !o)} style={s.othersToggle} testID="etiket-diger-alanlar">
          <View style={s.row}>
            <Icon source={othersOpen ? 'chevron-up' : 'chevron-down'} size={22} color={colors.textSecondary} />
            <Text style={s.othersLabel}>Diğer etiket alanları (iş emrinin tüm topları)</Text>
          </View>
        </TouchableRipple>
      ) : null}
      {othersOpen && workOrderId ? (
        <View>
          {ov.isLoading ? <Text style={s.sub}>Yükleniyor…</Text> : null}
          {ov.isError ? <Text style={s.err}>Etiket alanları okunamadı.</Text> : null}
          {otherKeys.map((k) => (
            <OverrideRow
              key={k.key}
              field={k}
              value={ovDraft[k.key] ?? { text: '', blank: false }}
              onChange={(v) => setOvDraft((d) => ({ ...d, [k.key]: v }))}
            />
          ))}
        </View>
      ) : null}
    </ModuleSheet>
  );
}

function LabelFieldRow({ label, value, hint, onPress, onClear, testID }: {
  label: string; value: string; hint: string; onPress: () => void; onClear: () => void; testID: string;
}) {
  const filled = value.trim() !== '';
  return (
    <View style={s.fieldRow}>
      <TouchableRipple onPress={onPress} style={s.field} testID={testID} accessibilityRole="button" accessibilityLabel={`${label}: ${filled ? value : hint}`}>
        <View>
          <Text style={s.fieldLabel}>{label}</Text>
          <Text style={filled ? s.fieldValue : s.fieldHint} testID={`${testID}-deger`}>{filled ? value : hint}</Text>
        </View>
      </TouchableRipple>
      {filled ? <IconButton icon="close-circle-outline" size={26} onPress={onClear} style={s.clear} accessibilityLabel={`${label} temizle`} testID={`${testID}-temizle`} /> : null}
    </View>
  );
}

type FieldDraft = { text: string; blank: boolean };

function OverrideRow({ field, value: v, onChange }: { field: { key: string; label: string; type: 'text' | 'number' }; value: FieldDraft; onChange: (v: FieldDraft) => void }) {
  return (
    <View style={s.row}>
      <View style={s.input}>
        <ModalTextInput
          mode="outlined"
          dense
          label={field.label}
          value={v.text}
          disabled={v.blank}
          keyboardType={field.type === 'number' ? 'decimal-pad' : 'default'}
          maxLength={120}
          onChangeText={(text) => onChange({ ...v, text })}
          testID={`etiket-bilgisi-${field.key}`}
        />
      </View>
      <TouchableRipple onPress={() => onChange({ text: '', blank: !v.blank })} testID={`etiket-bilgisi-bos-${field.key}`} style={s.blankHit}>
        <View style={s.row}>
          <Checkbox.Android status={v.blank ? 'checked' : 'unchecked'} />
          <Text>Boş bas</Text>
        </View>
      </TouchableRipple>
    </View>
  );
}

const s = StyleSheet.create({
  sub: { color: colors.textSecondary, marginBottom: spacing.sm },
  err: { color: colors.dangerText, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  field: {
    flex: 1,
    minHeight: 64,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  fieldLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  fieldValue: { fontSize: 20, fontWeight: '800', color: colors.text },
  fieldHint: { fontSize: 16, color: colors.textMuted, fontStyle: 'italic' },
  clear: { margin: 0, width: 56, height: 56 },
  othersToggle: { minHeight: 56, justifyContent: 'center', marginTop: spacing.sm },
  othersLabel: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  input: { flex: 1 },
  blankHit: { minHeight: 56, justifyContent: 'center', paddingRight: spacing.sm },
  freeBox: { gap: spacing.sm, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  btn: { minHeight: 56 },
});
