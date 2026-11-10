// Canlı etiket "kâğıdı" (2026-11-10) — sunucunun HTML render elemanlarını (mm) etiket oranında çizer.
// Düzenlenebilir alanlar mavi zeminli ve dokunulabilir; barkod/tarih/sabit metin düz çizilir.
// Uç yoksa (eski backend) şablonun alan listesinden satır görünümüne düşer.
import React, { useState } from 'react';
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { Text, TouchableRipple, Icon } from 'react-native-paper';
import type { TamburLabelPreview, TamburPreviewElement } from '../../../services/tambur.service';
import { colors, palette } from '../../../theme/tokens';
import type { EditAnchor } from './TamburInlineEditor';
import { emptyFieldText } from './labelPreviewMap';

export interface PaperRow {
  key: string | null;
  text: string;
  /** Başlık satırı (ürün adı) büyük. */
  big?: boolean;
  muted?: boolean;
}

export interface TamburLabelPaperProps {
  preview: TamburLabelPreview | null;
  /** Önizleme yokken (eski backend / ilk yükleme) gösterilecek satırlar. */
  fallbackRows: PaperRow[];
  isEditable: (key: string | null) => boolean;
  /** Çapa: dokunulan elemanın kâğıt üstündeki yeri (yerinde düzenleme kutusu oraya açılır). */
  onEdit: (key: string, anchor: EditAnchor) => void;
  stale: boolean;
  /** Kâğıdın üstüne çizilen yerinde düzenleme kutusu (kâğıt px boyutu verilir). */
  overlay?: (paper: { w: number; h: number }) => React.ReactNode;
}

const FALLBACK_MM = { w: 100, h: 60 };
const EDIT_BG = 'rgba(37,99,235,0.12)';
const EDIT_BORDER = palette.blue[600];

/** Deterministik çubuk deseni — yer tutucu barkod (gerçek kod kesimde doğar). */
const BAR_PATTERN = [2, 1, 1, 2, 3, 1, 1, 1, 2, 2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2];

function Barcode({ widthPx, heightPx, humanPx, human }: { widthPx: number; heightPx: number; humanPx: number; human: boolean }) {
  const unit = widthPx / 120;
  const bars: React.ReactNode[] = [];
  let x = 0;
  let i = 0;
  while (x < widthPx - unit) {
    const w = BAR_PATTERN[i % BAR_PATTERN.length] * unit;
    if (i % 2 === 0) bars.push(<View key={i} style={{ position: 'absolute', left: x, top: 0, width: w, height: heightPx, backgroundColor: palette.black }} />);
    x += w;
    i++;
  }
  return (
    <View style={{ width: widthPx }}>
      <View style={{ width: widthPx, height: heightPx }}>{bars}</View>
      {human && (
        <Text style={{ fontSize: Math.max(8, humanPx), textAlign: 'center', color: colors.textMuted, fontStyle: 'italic' }} numberOfLines={1}>
          yeni barkod — kesimde verilir
        </Text>
      )}
    </View>
  );
}

type TextEl = Extract<TamburPreviewElement, { type: 'text' }>;
function TextElementView({ el, s, paperW, editable, onEdit }: { el: TextEl; s: number; paperW: number; editable: boolean; onEdit: (a: EditAnchor) => void }) {
  const fontSize = Math.max(7, el.hMm * s);
  // Çapa x: left → sol kenar; right → sağ kenar; center → orta (geniş kutu + ortalı metin).
  const pos =
    el.align === 'right'
      ? { right: (paperW - el.x) * s }
      : el.align === 'center'
        ? { left: el.x * s - paperW * s, width: paperW * s * 2, alignItems: 'center' as const }
        : { left: el.x * s };
  // Değersiz alan yalnız önizlemede kırmızı kesikli çerçeve + "… — boş" (kullanıcı 2026-11-11).
  const txt = (
    <Text
      style={[
        { fontSize, lineHeight: fontSize * 1.15, fontWeight: el.bold ? '700' : '400', color: palette.black, fontFamily: 'monospace' },
        el.empty && styles.emptyText,
      ]}
      numberOfLines={1}
      testID={el.empty ? `onizleme-bos-${el.bind}` : undefined}
    >
      {el.empty ? emptyFieldText(el.text, el.bind) : el.text}
    </Text>
  );
  const hitStyle = el.empty ? styles.emptyHit : styles.editHit;
  return (
    <View style={[{ position: 'absolute', top: el.y * s - fontSize * 0.1 }, pos, el.rot ? { transform: [{ rotate: `${el.rot}deg` }] } : null]}>
      {editable ? (
        <TouchableRipple
          onPress={() => onEdit({ x: el.x * s, y: el.y * s, h: fontSize * 1.15, align: el.align })}
          hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
          style={hitStyle}
          accessibilityLabel={`Düzenle: ${el.empty ? emptyFieldText(el.text, el.bind) : el.text}`}
          testID={`onizleme-alan-${el.bind}`}
        >
          {txt}
        </TouchableRipple>
      ) : el.empty ? (
        <View style={styles.emptyHit}>{txt}</View>
      ) : (
        txt
      )}
    </View>
  );
}

function ElementView({ el, s, paperW, editable, onEdit }: { el: TamburPreviewElement; s: number; paperW: number; editable: boolean; onEdit: (a: EditAnchor) => void }) {
  switch (el.type) {
    case 'line':
      return <View style={{ position: 'absolute', left: el.x * s, top: el.y * s, width: el.wMm * s, height: Math.max(1, el.hMm * s), backgroundColor: palette.black }} />;
    case 'box':
      return (
        <View
          style={{ position: 'absolute', left: el.x * s, top: el.y * s, width: el.wMm * s, height: el.hMm * s, borderWidth: Math.max(1, el.thickMm * s), borderColor: palette.black }}
        />
      );
    case 'qr':
      return (
        <View style={{ position: 'absolute', left: el.x * s, top: el.y * s, width: el.sizeMm * s, height: el.sizeMm * s, borderWidth: Math.max(2, s), borderColor: palette.black, alignItems: 'center', justifyContent: 'center' }}>
          <Icon source="qrcode" size={el.sizeMm * s * 0.7} color={palette.black} />
        </View>
      );
    case 'code128':
      return (
        <View style={{ position: 'absolute', left: el.x * s, top: el.y * s }}>
          <Barcode widthPx={el.wMm * s} heightPx={el.hMm * s} humanPx={el.humanHMm * s} human={el.human} />
        </View>
      );
    case 'banner': {
      const vertical = el.rot === 90 || el.rot === 270;
      const body = (
        <View style={{ width: el.wMm * s, height: el.hMm * s, backgroundColor: palette.black, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <Text style={{ color: palette.white, fontWeight: '700', fontSize: (vertical ? el.wMm : el.hMm) * s * 0.6, transform: [{ rotate: `${el.rot}deg` }] }} numberOfLines={1}>
            {el.text}
          </Text>
        </View>
      );
      return (
        <View style={{ position: 'absolute', left: el.x * s, top: el.y * s }}>
          {editable ? (
            <TouchableRipple onPress={() => onEdit({ x: el.x * s, y: el.y * s, h: el.hMm * s, align: 'left' })} accessibilityLabel={`Düzenle: ${el.text}`} style={{ borderWidth: 2, borderColor: EDIT_BORDER }}>
              {body}
            </TouchableRipple>
          ) : (
            body
          )}
        </View>
      );
    }
    case 'text':
      return <TextElementView el={el} s={s} paperW={paperW} editable={editable} onEdit={onEdit} />;
  }
}

export default function TamburLabelPaper({ preview, fallbackRows, isEditable, onEdit, stale, overlay }: TamburLabelPaperProps) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!box || Math.abs(box.w - width) > 1 || Math.abs(box.h - height) > 1) setBox({ w: width, h: height });
  };
  const wMm = preview?.widthMm || FALLBACK_MM.w;
  const hMm = preview?.heightMm || FALLBACK_MM.h;
  const s = box ? Math.min(box.w / wMm, box.h / hMm) : 0;
  const rows: PaperRow[] | null = preview?.elements
    ? null
    : preview?.rows
      ? preview.rows.map((r, i) => ({ key: r.key, text: r.text, big: r.size === 'lg' || (i === 0 && r.size !== 'sm') }))
      : fallbackRows;
  return (
    <View style={styles.wrap}>
      <View style={styles.area} onLayout={onLayout} testID="tambur-etiket-onizleme">
        {/* Kâğıt MUTLAK katmanda: alanın yüksekliğini kâğıt belirlemesin (aksi hâlde kâğıt büyüyünce alan da büyür,
            kaydırma içeriği alt şeridin altına taşar — cihaz 2026-11-11). Alan = kalan yer; kâğıt ona sığar. */}
        <View style={styles.paperLayer} pointerEvents="box-none">
        {s > 0 && (
          <View style={[styles.paper, { width: wMm * s, height: hMm * s }]}>
            {preview?.elements
              ? preview.elements.map((el, i) => {
                  const key = el.type === 'text' || el.type === 'banner' ? el.bind : null;
                  const editable = isEditable(key);
                  return <ElementView key={i} el={el} s={s} paperW={wMm} editable={editable} onEdit={(a) => key && onEdit(key, a)} />;
                })
              : (
                <View style={styles.rowsPad}>
                  {(rows ?? []).map((r, i) => {
                    const editable = isEditable(r.key);
                    const rowH = (r.big ? 5 : 3.4) * s * 1.3 + 4;
                    const t = (
                      <Text style={[styles.rowText, r.big && styles.rowBig, r.muted && styles.rowMuted, { fontSize: (r.big ? 5 : 3.4) * s }]} numberOfLines={1}>
                        {r.text}
                      </Text>
                    );
                    return editable && r.key ? (
                      <TouchableRipple key={i} onPress={() => onEdit(r.key as string, { x: 10, y: 10 + i * rowH, h: rowH, align: 'left' })} style={[styles.editHit, styles.rowHit]} testID={`onizleme-alan-${r.key}`}>
                        {t}
                      </TouchableRipple>
                    ) : (
                      <View key={i} style={styles.rowHit}>{t}</View>
                    );
                  })}
                </View>
              )}
            {overlay?.({ w: wMm * s, h: hMm * s })}
          </View>
        )}
        </View>
      </View>
      {stale && (
        <View style={styles.staleRow}>
          <Icon source="wifi-alert" size={14} color={colors.warningText} />
          <Text style={styles.staleText}>Önizleme güncellenemedi — son görüntü. Kesim etkilenmez.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: 4 },
  area: { flex: 1, minHeight: 120 },
  paperLayer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  paper: {
    backgroundColor: palette.white,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.slate[300],
    overflow: 'hidden',
    shadowColor: palette.black,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  emptyHit: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: palette.red[600], borderRadius: 3, paddingHorizontal: 3, backgroundColor: palette.red[50] },
  emptyText: { color: palette.red[700], fontStyle: 'italic' },
  editHit: { backgroundColor: EDIT_BG, borderBottomWidth: 2, borderBottomColor: EDIT_BORDER, borderRadius: 3, paddingHorizontal: 2 },
  rowsPad: { padding: 10, gap: 4 },
  rowHit: { alignSelf: 'flex-start' },
  rowText: { color: palette.black, fontFamily: 'monospace' },
  rowBig: { fontWeight: '800' },
  rowMuted: { color: palette.slate[400] },
  staleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  staleText: { fontSize: 12, color: colors.warningText },
});
