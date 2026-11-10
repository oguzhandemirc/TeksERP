// "Etiket önizlemesi" kartı (2026-11-10) — basılacak etiketin canlı kâğıdı + alana dokununca YERİNDE düzenleme.
// Düzenleyiciler kesimin KENDİ state yazıcılarını çağırır; bu dosya yalnız hangi alanın açık olduğunu bilir.
// Ad/renk/parti ve sayılar kâğıdın üstünde (TamburInlineEditor); kalite PickerModal; alıcı/müşteri kendi seçicisi.
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import PickerModal from '../../../components/PickerModal';
import type { TamburLabelPreview } from '../../../services/tambur.service';
import { colors, palette } from '../../../theme/tokens';
import { editorForKey, inlineKind, type InlineEditor, type PreviewEditContext, type PreviewEditor } from './labelPreviewMap';
import TamburInlineEditor, { editorRect, type EditAnchor } from './TamburInlineEditor';
import TamburLabelPaper, { type PaperRow } from './TamburLabelPaper';

export interface PreviewField {
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
  length: PreviewField;
  kg: PreviewField;
  width: PreviewField & { placeholder?: string };
  itemName: PreviewField;
  colorName: PreviewField;
  batch: PreviewField;
  quality: { grades: { code: string; name: string }[]; value: string | null | undefined; pick: (code: string) => void };
  onConsignee?: () => void;
  onCustomer: () => void;
  /** Kartın altına ek (müşterideki ad satırı). */
  footer?: React.ReactNode;
}

const INLINE_META: Record<InlineEditor, { label: string; max: number }> = {
  length: { label: 'Kesim uzunluğu (m) — boş = kalanı kes', max: 8 },
  kg: { label: 'Ağırlık (kg)', max: 8 },
  width: { label: 'Ölçülen en (cm) — boş = atadan', max: 4 },
  itemName: { label: 'Etikette ürün adı', max: 80 },
  colorName: { label: 'Etikette renk', max: 80 },
  batch: { label: 'Parti no', max: 40 },
};

/** Seçicili alanlar kendi penceresini açar; diğerleri yerinde düzenlenir (`open`). */
export function dispatchEdit(
  editor: PreviewEditor,
  p: Pick<TamburLabelPreviewCardProps, 'onConsignee' | 'onCustomer'>,
  open: (e: PreviewEditor) => void,
): void {
  if (editor === 'consignee') p.onConsignee?.();
  else if (editor === 'customer') p.onCustomer();
  else open(editor);
}

export default function TamburLabelPreviewCard(p: TamburLabelPreviewCardProps) {
  const [editing, setEditing] = useState<{ editor: PreviewEditor; anchor: EditAnchor; shown: string } | null>(null);
  const isEditable = (key: string | null) => editorForKey(key, p.ctx) != null && (key !== 'consigneeName' || !!p.onConsignee);
  const onEdit = (key: string, anchor: EditAnchor) => {
    const ed = editorForKey(key, p.ctx);
    const shown = p.preview?.elements?.find((e) => e.type === 'text' && e.bind === key);
    if (ed) dispatchEdit(ed, p, (e) => setEditing({ editor: e, anchor, shown: shown?.type === 'text' ? shown.text : '' }));
  };
  const inline = editing && inlineKind(editing.editor) ? (editing.editor as InlineEditor) : null;
  const close = () => setEditing(null);
  const overlay = (paper: { w: number; h: number }) =>
    inline && editing ? (
      <TamburInlineEditor
        key={`${inline}-${editing.anchor.x}-${editing.anchor.y}`}
        kind={inlineKind(inline) as 'number' | 'text'}
        label={INLINE_META[inline].label}
        initial={p[inline].value}
        placeholder={inline === 'width' ? p.width.placeholder : editing.shown || undefined}
        maxLength={INLINE_META[inline].max}
        rect={editorRect(editing.anchor, paper)}
        onCommit={(v) => {
          p[inline].set(v);
          close();
        }}
        onCancel={close}
      />
    ) : null;
  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.title}>Etiket önizlemesi</Text>
        <Text style={s.meta} numberOfLines={1}>
          {[p.preview?.templateName, `kimin için: ${p.forWhom}`].filter(Boolean).join(' · ')}
        </Text>
        <View style={{ flex: 1 }} />
        <Button mode="contained-tonal" compact icon="swap-horizontal" onPress={p.onOpenInfo} style={s.change} labelStyle={s.changeLabel} testID="tambur-etiket-degistir">
          Değiştir
        </Button>
      </View>
      <TamburLabelPaper preview={p.preview} fallbackRows={p.fallbackRows} isEditable={isEditable} onEdit={onEdit} stale={p.stale} overlay={overlay} />
      {p.footer}
      <PickerModal
        visible={editing?.editor === 'quality'}
        title="Kalite"
        options={p.quality.grades.map((g) => ({ value: g.code, label: g.name }))}
        selectedValue={p.quality.value ?? null}
        disableSort
        onSelect={(code) => {
          p.quality.pick(code);
          close();
        }}
        onDismiss={close}
      />
    </View>
  );
}

const s = StyleSheet.create({
  card: { flex: 1, backgroundColor: palette.white, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 6, gap: 4, borderWidth: 1, borderColor: palette.slate[200] },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  title: { fontSize: 15, fontWeight: '800', color: palette.slate[900] },
  meta: { fontSize: 13, color: colors.textMuted, flexShrink: 1 },
  change: { marginVertical: 0 },
  changeLabel: { marginVertical: 12, fontSize: 13 },
});
