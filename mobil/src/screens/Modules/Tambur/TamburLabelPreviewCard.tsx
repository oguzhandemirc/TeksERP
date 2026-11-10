// "Etiket önizlemesi" kartı (2026-11-10) — basılacak etiketin canlı kâğıdı + alana dokununca düzenleme.
// Düzenleyiciler kesimin KENDİ state yazıcılarını çağırır (`setters`); bu dosya state tutmaz, yalnız hangi
// pencerenin açık olduğunu bilir. Sayı alanları modalda NumpadInput (sistem klavyesi), kalite PickerModal.
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, Icon } from 'react-native-paper';
import ModuleSheet from '../../../components/ModuleSheet';
import NumpadInput from '../../../components/NumpadInput';
import PickerModal from '../../../components/PickerModal';
import type { TamburLabelPreview } from '../../../services/tambur.service';
import { colors, palette } from '../../../theme/tokens';
import { editorForKey, type PreviewEditContext, type PreviewEditor } from './labelPreviewMap';
import TamburLabelPaper, { type PaperRow } from './TamburLabelPaper';

export interface PreviewNumberField {
  value: string;
  set: (v: string) => void;
}

export interface TamburLabelPreviewCardProps {
  preview: TamburLabelPreview | null;
  stale: boolean;
  fallbackRows: PaperRow[];
  ctx: PreviewEditContext;
  /** Etiket kimin için (müşteri / Stok / sahip). */
  forWhom: string;
  /** "Değiştir": mevcut etiket bilgisi penceresi. */
  onOpenInfo: () => void;
  length: PreviewNumberField;
  kg: PreviewNumberField & { onTart?: () => void };
  width: PreviewNumberField & { placeholder?: string };
  quality: { grades: { code: string; name: string }[]; value: string | null | undefined; pick: (code: string) => void };
  onConsignee?: () => void;
  onCustomer: () => void;
  /** Kartın altına ek (müşterideki ad satırı). */
  footer?: React.ReactNode;
}

const NUMBER_META: Record<'length' | 'kg' | 'width', { title: string; label: string; max: number }> = {
  length: { title: 'Metre', label: 'Kesim uzunluğu (m) — boş = kalanı kes', max: 8 },
  kg: { title: 'Kg', label: 'Ağırlık (kg)', max: 8 },
  width: { title: 'En (cm)', label: 'Ölçülen en (cm) — boş = atadan', max: 4 },
};

export function dispatchEdit(
  editor: PreviewEditor,
  p: Pick<TamburLabelPreviewCardProps, 'onOpenInfo' | 'onConsignee' | 'onCustomer'>,
  open: (e: 'length' | 'kg' | 'width' | 'quality') => void,
): void {
  switch (editor) {
    case 'texts':
      p.onOpenInfo();
      return;
    case 'consignee':
      p.onConsignee?.();
      return;
    case 'customer':
      p.onCustomer();
      return;
    default:
      open(editor);
  }
}

function NumberSheet(p: {
  field: 'length' | 'kg' | 'width' | null;
  draft: string;
  setDraft: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
  onTart?: () => void;
  widthPlaceholder?: string;
}) {
  const { field } = p;
  return (
    <ModuleSheet
      visible={field != null}
      onDismiss={p.onClose}
      size="sm"
      title={field ? NUMBER_META[field].title : ''}
      footer={
        <View style={s.footer}>
          {field === 'kg' && p.onTart ? (
            <Button
              mode="outlined"
              icon="scale"
              onPress={() => {
                p.onClose();
                p.onTart?.();
              }}
            >
              Tart
            </Button>
          ) : null}
          <View style={{ flex: 1 }} />
          <Button mode="text" onPress={p.onClose}>
            Vazgeç
          </Button>
          <Button mode="contained" onPress={p.onSave} testID="onizleme-kaydet">
            Kaydet
          </Button>
        </View>
      }
    >
      {field ? (
        <NumpadInput
          mode="outlined"
          label={NUMBER_META[field].label}
          value={p.draft}
          onChangeText={p.setDraft}
          allowDecimal
          numpadMaxLength={NUMBER_META[field].max}
          useNativeKeyboard
          autoFocus
          placeholder={field === 'width' ? p.widthPlaceholder : undefined}
          testID="onizleme-sayi"
        />
      ) : null}
    </ModuleSheet>
  );
}

export default function TamburLabelPreviewCard(p: TamburLabelPreviewCardProps) {
  const [open, setOpen] = useState<'length' | 'kg' | 'width' | 'quality' | null>(null);
  const [draft, setDraft] = useState('');
  const isEditable = (key: string | null) => editorForKey(key, p.ctx) != null && (key !== 'consigneeName' || !!p.onConsignee);
  const openNumber = (e: 'length' | 'kg' | 'width' | 'quality') => {
    if (e !== 'quality') setDraft(p[e].value);
    setOpen(e);
  };
  const onEdit = (key: string) => {
    const ed = editorForKey(key, p.ctx);
    if (ed) dispatchEdit(ed, p, openNumber);
  };
  const numberField = open && open !== 'quality' ? open : null;
  const save = () => {
    if (numberField) p[numberField].set(draft.trim());
    setOpen(null);
  };
  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.title}>Etiket önizlemesi</Text>
        {!!p.preview?.templateName && (
          <Text style={s.template} numberOfLines={1}>
            {p.preview.templateName}
          </Text>
        )}
        <View style={{ flex: 1 }} />
        <Button mode="contained-tonal" icon="swap-horizontal" onPress={p.onOpenInfo} testID="tambur-etiket-degistir">
          Değiştir
        </Button>
      </View>
      <TamburLabelPaper preview={p.preview} fallbackRows={p.fallbackRows} isEditable={isEditable} onEdit={onEdit} stale={p.stale} />
      <View style={s.metaRow}>
        <Icon source="account-outline" size={16} color={colors.textMuted} />
        <Text style={s.meta}>Etiket kimin için:</Text>
        <Text style={s.metaStrong} numberOfLines={1}>
          {p.forWhom}
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={s.hint}>Mavi alana dokun: düzenle</Text>
      </View>
      {p.footer}

      <NumberSheet
        field={numberField}
        draft={draft}
        setDraft={setDraft}
        onSave={save}
        onClose={() => setOpen(null)}
        onTart={p.kg.onTart}
        widthPlaceholder={p.width.placeholder}
      />
      <PickerModal
        visible={open === 'quality'}
        title="Kalite"
        options={p.quality.grades.map((g) => ({ value: g.code, label: g.name }))}
        selectedValue={p.quality.value ?? null}
        disableSort
        onSelect={(code) => {
          p.quality.pick(code);
          setOpen(null);
        }}
        onDismiss={() => setOpen(null)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  card: { flex: 1, backgroundColor: palette.white, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: palette.slate[200] },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 17, fontWeight: '800', color: palette.slate[900] },
  template: { fontSize: 13, color: colors.textMuted, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { fontSize: 14, color: colors.textMuted },
  metaStrong: { fontSize: 14, fontWeight: '800', color: palette.slate[900], flexShrink: 1 },
  hint: { fontSize: 12, color: palette.blue[600] },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
});
