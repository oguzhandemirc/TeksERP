// "Etiket önizlemesi" kartı (2026-11-10) — basılacak etiketin canlı kâğıdı + alana dokununca YERİNDE düzenleme.
// Düzenleyiciler kesimin KENDİ state yazıcılarını çağırır; bu dosya yalnız hangi alanın açık olduğunu bilir.
// Ad/renk/parti ve sayılar kâğıdın üstünde (TamburInlineEditor); kalite PickerModal; alıcı/müşteri kendi seçicisi.
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import PickerModal from '../../../components/PickerModal';
import TruncatedText from '../../../components/TruncatedText';
import type { TamburLabelPreview } from '../../../services/tambur.service';
import { colors, palette } from '../../../theme/tokens';
import { editorForKey, inlineKind, type InlineEditor, type PreviewEditContext, type PreviewEditor } from './labelPreviewMap';
import TamburInlineEditor, { type EditAnchor } from './TamburInlineEditor';
import TamburLabelPaper, { type PaperRow } from './TamburLabelPaper';
import { templateButtonMode, templatePickerOptions, type TemplateOffer } from './labelTemplateChoice';
import { ACTION_BUTTON_RADIUS } from './CutActionBar';

export interface PreviewField {
  value: string;
  set: (v: string) => void;
}

export interface TamburLabelPreviewCardProps {
  preview: TamburLabelPreview | null;
  stale: boolean;
  fallbackRows: PaperRow[];
  ctx: PreviewEditContext;
  /** Seçilebilir şablonlar; null = eski backend → "Şablon Değiştir" eski işini (etiket bilgisi penceresi) yapar. */
  templateOffer: TemplateOffer | null;
  /** Seçicide işaretli şablon (seçim ya da varsayılan). */
  selectedTemplateId: string | null;
  onPickTemplate: (templateId: string) => void;
  /** Eski backend yedeği: etiket bilgisi penceresi (yeni backend'de "Diğer → Etiket bilgisi"). */
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

const noop = () => {};

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
    if (ed) dispatchEdit(ed, p, (e) => setEditing({ editor: e, anchor, shown: shown?.type === 'text' && !shown.empty ? shown.text : '' }));
  };
  const inline = editing && inlineKind(editing.editor) ? (editing.editor as InlineEditor) : null;
  const close = () => setEditing(null);
  // Kâğıt katmanına yalnız görünmez çapa düşer; kart + odak perdesi kök portalda çizilir (TamburInlineEditor).
  const overlay = () =>
    inline && editing ? (
      <TamburInlineEditor
        key={`${inline}-${editing.anchor.x}-${editing.anchor.y}`}
        kind={inlineKind(inline) as 'number' | 'text'}
        label={INLINE_META[inline].label}
        initial={p[inline].value}
        placeholder={inline === 'width' ? p.width.placeholder : editing.shown || undefined}
        maxLength={INLINE_META[inline].max}
        anchor={editing.anchor}
        onCommit={(v) => p[inline].set(v)}
        onCancel={noop}
        onClosed={close}
      />
    ) : null;
  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.title}>Etiket önizlemesi</Text>
        <TruncatedText style={s.meta}>
          {p.preview?.templateName ?? ''}
        </TruncatedText>
        <View style={{ flex: 1 }} />
        <TemplateChange offer={p.templateOffer} selectedId={p.selectedTemplateId} onPick={p.onPickTemplate} onOpenInfo={p.onOpenInfo} />
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

/** "Şablon Değiştir": seçici (≥2), pasif (tek, K4) ya da eski backend'de etiket bilgisi penceresi. */
function TemplateChange(p: {
  offer: TemplateOffer | null;
  selectedId: string | null;
  onPick: (templateId: string) => void;
  onOpenInfo: () => void;
}) {
  const [open, setOpen] = useState(false);
  const mode = templateButtonMode(p.offer);
  return (
    <>
      {mode === 'single' ? (
        <Text style={s.hint} testID="tambur-etiket-tek-sablon">
          Tek şablon atanmış
        </Text>
      ) : null}
      <Button
        mode="contained"
        compact
        icon="swap-horizontal"
        onPress={mode === 'legacy' ? p.onOpenInfo : () => setOpen(true)}
        disabled={mode === 'single'}
        buttonColor={mode === 'single' ? palette.slate[300] : CHANGE_BG}
        textColor={palette.white}
        style={s.change}
        contentStyle={s.changeContent}
        labelStyle={s.changeLabel}
        accessibilityLabel="Etiket şablonunu değiştir"
        accessibilityHint={mode === 'single' ? 'Tek şablon atanmış' : undefined}
        testID="tambur-etiket-degistir"
      >
        Şablon Değiştir
      </Button>
      {p.offer ? (
        <PickerModal
          visible={open}
          title="Etiket şablonu"
          options={templatePickerOptions(p.offer)}
          selectedValue={p.selectedId}
          disableSort
          onSelect={(id) => {
            setOpen(false);
            p.onPick(id);
          }}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

// Dolu indigo: Bitir yeşilinden ve METRE/KG grisinden ayrışır (2026-11-11).
const CHANGE_BG = palette.indigo[700];

const s = StyleSheet.create({
  card: { flex: 1, minHeight: 0, backgroundColor: palette.white, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 6, gap: 4, borderWidth: 1, borderColor: palette.slate[200] },
  head: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  title: { fontSize: 15, fontWeight: '800', color: palette.slate[900] },
  meta: { fontSize: 13, color: colors.textMuted, flexShrink: 1 },
  hint: { fontSize: 12, color: colors.textMuted },
  change: { marginVertical: 0, borderRadius: ACTION_BUTTON_RADIUS },
  changeContent: { minHeight: 44 },
  changeLabel: { marginVertical: 0, fontSize: 14, fontWeight: '800', color: palette.white },
});
