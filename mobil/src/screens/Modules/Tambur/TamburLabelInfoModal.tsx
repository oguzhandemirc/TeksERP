// Etiket bilgisi (Gülkesim 2026-11-09): tamburcu müşteriyi arayıp etikete basılacak kumaş adı / renk /
// parti no'yu öğrenir; değer SONRAKİ toplara gider (topa kesimde yazılır, İE'de saklanmaz). Kumaşın gerçek adı değişmez.
// İE geneli düzeltmenin ad/renk anahtarları burada gösterilmez; kalan anahtarlar (en vb.) sağ sütunda, hep açık (2026-11-10:
// geniş tek pencere, katlanır bölüm yok). Üstteki parti alanı varken İE-geneli `batchNumber` satırı düşer (`visibleOverrideKeys`).
// `mode="fix"`: kesilmiş TEK topun değerini sevk edilene kadar düzeltir (sebep zorunlu, `PATCH /rolls/:id/label-texts`).
import React, { useEffect, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import ModuleSheet from '../../../components/ModuleSheet';
import ModalTextInput from '../../../components/ModalTextInput';
import PickerModal from '../../../components/PickerModal';
import { tamburService } from '../../../services/tambur.service';
import { rollService, type RollLabelTextsFixResult } from '../../../services/roll.service';
import { showScreenError } from '../../../lib/screenToast';
import { colors } from '../../../theme/tokens';
import { overridePatch } from './finalLabel';
import { LABEL_BATCH_MAX } from './labelBatch';
import { LABEL_TEXT_MAX, NAME_OVERRIDE_KEYS, emptyHint, visibleOverrideKeys } from './labelTexts';
import { useTamburLabelSuggestions, type TamburFinalLabelState } from './useTamburFinalLabel';
import { labelTextFixBody, labelTextFixReasonError } from './labelTextFix';
import { LabelFieldRow, OverrideRow, type FieldDraft } from './TamburLabelInfoRows';
import { TERIM } from '../../../lib/terim';
import { s } from './TamburLabelInfoModal.styles';

type OverrideDraft = Record<string, FieldDraft>;
type FieldKey = 'item' | 'color' | 'batch';

interface CommonProps {
  visible: boolean;
  onDismiss: () => void;
  /** Boş kutuda basılacak kaynak değerler — silik ipucu. */
  defaults?: { itemName?: string | null; colorName?: string | null; batchNo?: string | null };
}

/** Düzeltilecek top — liste satırındaki değerler (sunucu yine taze okur). */
export interface LabelFixRoll {
  id: string;
  barcode: string | null;
  labelItemName?: string | null;
  labelColorName?: string | null;
  labelBatchNo?: string | null;
}

export type TamburLabelInfoModalProps = CommonProps &
  (
    | {
        mode?: 'next';
        /** İş emri (Diğer etiket alanları için); yoksa o bölüm çizilmez. */
        workOrderId: string | null;
        /** Etkin kesim akışının etiket durumu (açık kumaş ya da Top Kesme). */
        final: TamburFinalLabelState;
      }
    | {
        mode: 'fix';
        roll: LabelFixRoll;
        /** Kayıt başarılı (değişiklik olduysa) — parent listeyi tazeler ve "yeniden bas" sorar. */
        onSaved: (result: RollLabelTextsFixResult) => void;
      }
  );

const FIELD_META: Record<FieldKey, { label: string; picker: string; generic: string; max: number }> = {
  item: { label: 'Kumaş adı', picker: 'Etikete basılacak kumaş adı', generic: 'kumaşın kendi adı', max: LABEL_TEXT_MAX },
  color: { label: 'Renk', picker: 'Etikete basılacak renk', generic: 'kumaşın kendi rengi', max: LABEL_TEXT_MAX },
  batch: { label: 'Parti no', picker: 'Etikete basılacak parti no', generic: 'bizim parti no', max: LABEL_BATCH_MAX },
};

export default function TamburLabelInfoModal(props: TamburLabelInfoModalProps) {
  const { visible, onDismiss, defaults } = props;
  const fix = props.mode === 'fix' ? props : null;
  const final = props.mode === 'fix' ? null : props.final;
  const workOrderId = props.mode === 'fix' ? null : props.workOrderId;
  const qc = useQueryClient();
  // Düzeltmede parti alanı: müşteri ayarı açıksa ya da topta değer varsa (temizlenebilsin).
  const fixSettings = useQuery({
    queryKey: ['tambur', 'label-settings', fix?.roll.id ?? null, null],
    queryFn: () => tamburService.labelSettings({ rollId: fix?.roll.id ?? null }),
    enabled: visible && !!fix,
    staleTime: 60_000,
    retry: false,
  });
  const batchEnabled = fix
    ? fixSettings.data?.labelBatchEnabled === true || !!fix.roll.labelBatchNo
    : final!.batch.enabled;
  const sugg = useTamburLabelSuggestions(fix ? { rollId: fix.roll.id } : final!.suggestionParams, visible);
  const [draft, setDraft] = useState<Record<FieldKey, string>>({ item: '', color: '', batch: '' });
  const [reason, setReason] = useState('');
  const [picking, setPicking] = useState<FieldKey | null>(null);
  const [freeOpen, setFreeOpen] = useState(false);
  const [freeText, setFreeText] = useState('');
  const [ovDraft, setOvDraft] = useState<OverrideDraft>({});

  // Pencere her açılışta güncel yapışkan değerle başlar; öneriler tazelenir (yeni kesimin değeri listeye girsin).
  useEffect(() => {
    if (!visible) return;
    if (fix) {
      setDraft({ item: fix.roll.labelItemName ?? '', color: fix.roll.labelColorName ?? '', batch: fix.roll.labelBatchNo ?? '' });
      setReason('');
    } else {
      setDraft({ item: final!.texts.itemName, color: final!.texts.colorName, batch: final!.batch.value });
    }
    void sugg.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const ov = useQuery({
    queryKey: ['labels', 'wo-overrides', workOrderId],
    queryFn: () => tamburService.getLabelOverrides(workOrderId as string),
    enabled: visible && !!workOrderId,
  });
  const otherKeys = visibleOverrideKeys(ov.data?.keys ?? [], batchEnabled);
  const { width: winW } = useWindowDimensions();
  // Yatay tablette iki sütun (sonraki toplar | iş emrinin tüm topları); telefonda tek sütun + kaydırma.
  const twoCol = !!workOrderId && winW >= 900;
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

  const fixMutation = useMutation({
    mutationFn: (body: Parameters<typeof rollService.fixLabelTexts>[1]) => rollService.fixLabelTexts(fix!.roll.id, body),
  });
  const reasonError = fix ? labelTextFixReasonError(reason) : null;

  const submitFix = async () => {
    if (!fix) return;
    const body = labelTextFixBody(
      { itemName: fix.roll.labelItemName, colorName: fix.roll.labelColorName, batchNo: fix.roll.labelBatchNo },
      { itemName: draft.item, colorName: draft.color, batchNo: draft.batch },
      batchEnabled,
    );
    if (Object.keys(body).length === 0) {
      Toast.show({ type: 'info', text1: 'Değişiklik yok' });
      onDismiss();
      return;
    }
    if (reasonError) return;
    try {
      const res = await fixMutation.mutateAsync({ ...body, reason: reason.trim() });
      onDismiss();
      if (res.data?.changed) fix.onSaved(res.data);
      else Toast.show({ type: 'info', text1: 'Etiket bilgisi zaten aynı' });
    } catch (err) {
      showScreenError(err as Error, 'Etiket bilgisi düzeltilemedi');
    }
  };

  const submit = async () => {
    if (fix) return submitFix();
    final!.texts.set({ itemName: draft.item, colorName: draft.color });
    if (batchEnabled) final!.batch.setValue(draft.batch);
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
      size={workOrderId ? 'xl' : 'sm'}
      title={fix ? `Etiket bilgisini düzelt${fix.roll.barcode ? ` — ${fix.roll.barcode}` : ''}` : 'Etikete basılacak (sonraki toplar)'}
      subtitle={
        fix
          ? 'Yalnız bu top. Boş kutu: kumaşın kendi adı/rengi basılır. Kaydedince etiketi yeniden basabilirsin.'
          : 'Değer sonraki kesimlerde aynen kalır. Boş kutu: kumaşın kendi adı/rengi basılır.'
      }
      footer={
        <View style={s.footerBar}>
          <Button mode="contained" buttonColor={colors.danger} textColor={colors.textOnDark} onPress={onDismiss} contentStyle={s.btn}
            testID="etiket-bilgisi-vazgec">
            Vazgeç
          </Button>
          <Button
            mode="contained"
            textColor={colors.textOnDark}
            onPress={() => void submit()}
            loading={saveOverrides.isPending || fixMutation.isPending}
            disabled={saveOverrides.isPending || fixMutation.isPending || (!!fix && !!reasonError)}
            contentStyle={s.btn}
            testID="etiket-bilgisi-kaydet"
          >
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
                    <Button mode="contained" buttonColor={colors.textSecondary} textColor={colors.textOnDark} onPress={() => setFreeOpen(false)} contentStyle={s.btn}>Vazgeç</Button>
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
      <View style={twoCol ? s.cols : null}>
        <View style={twoCol ? s.col : null}>
          {workOrderId ? <Text style={s.colTitle}>Sonraki toplar</Text> : null}
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

          {fix ? (
            <View style={s.reasonBox}>
              <ModalTextInput
                mode="outlined"
                label="Düzeltme sebebi (zorunlu)"
                value={reason}
                onChangeText={setReason}
                maxLength={500}
                placeholder="Örn. müşteri adı yanlış söylendi"
                testID="etiket-duzelt-sebep"
              />
              {reason.length > 0 && reasonError ? <Text style={s.err}>{reasonError}</Text> : null}
            </View>
          ) : null}
        </View>

        {workOrderId ? (
          <View style={twoCol ? s.col : s.stacked} testID="etiket-diger-alanlar">
            <Text style={s.colTitle}>{TERIM.terbiyeIsEmri.cumleBasi.ilgi} tüm topları</Text>
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
      </View>
    </ModuleSheet>
  );
}
