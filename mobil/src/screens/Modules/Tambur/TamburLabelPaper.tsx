// Canlı etiket "kâğıdı" (2026-11-10) — sunucunun HTML render elemanlarını (mm) etiket oranında çizer.
// Düzenlenebilir alanlar mavi zeminli ve dokunulabilir; barkod/tarih/sabit metin düz çizilir.
// Uç yoksa (eski backend) şablonun alan listesinden satır görünümüne düşer.
import React, { createContext, useContext, useEffect, useState } from 'react';
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Text, TouchableRipple, Icon } from 'react-native-paper';
import type { TamburLabelPreview, TamburPreviewElement } from '../../../services/tambur.service';
import { colors, palette, radius, shadow, spacing, typography } from '../../../theme/tokens';
import type { EditAnchor } from './TamburInlineEditor';
import { AUTO_FIELD_TEXT, emptyFieldText, isSystemAssignedField } from './labelPreviewMap';
import { clampPaperPan, clampPaperZoom, doubleTapZoom, fitPaperScale, paperPanLimit, PAPER_ZOOM_MIN } from './labelPaperFit';

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

/** Değişince yakınlaştırma 1×'e döner (iş emri / top değişimi). Sağlayıcı geniş kesim kabında; kart prop taşımaz. */
export const PaperZoomResetContext = createContext<string | null>(null);

/**
 * İki parmakla yakınlaştır (1×–4×), yakınken tek parmakla kaydır (kâğıt kenarıyla sınırlı), çift dokunuş 1× ↔ 2×.
 * Tek dokunuş alanın düzenleyicisine kalır: pinch iki parmak ister, pan yalnız yakınken ve minDistance sonrası etkin.
 */
function usePaperZoom(paper: { w: number; h: number }, area: { w: number; h: number } | null, resetKey: string | null) {
  const zoom = useSharedValue(1);
  const savedZoom = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);
  const aw = area?.w ?? 0;
  const ah = area?.h ?? 0;

  const reset = (animated: boolean) => {
    zoom.value = animated ? withTiming(1) : 1;
    tx.value = animated ? withTiming(0) : 0;
    ty.value = animated ? withTiming(0) : 0;
    savedZoom.value = 1;
    savedTx.value = 0;
    savedTy.value = 0;
    setZoomed(false);
  };
  useEffect(() => {
    reset(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız iş emri / top değişince
  }, [resetKey]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      'worklet';
      const z = clampPaperZoom(savedZoom.value * e.scale);
      zoom.value = z;
      tx.value = clampPaperPan(savedTx.value, paperPanLimit(paper.w, aw, z));
      ty.value = clampPaperPan(savedTy.value, paperPanLimit(paper.h, ah, z));
    })
    .onEnd(() => {
      'worklet';
      savedZoom.value = zoom.value;
      savedTx.value = tx.value;
      savedTy.value = ty.value;
      runOnJS(setZoomed)(zoom.value > PAPER_ZOOM_MIN + 0.01);
    });
  const pan = Gesture.Pan()
    .enabled(zoomed)
    .minDistance(10)
    .maxPointers(1)
    .onUpdate((e) => {
      'worklet';
      tx.value = clampPaperPan(savedTx.value + e.translationX, paperPanLimit(paper.w, aw, zoom.value));
      ty.value = clampPaperPan(savedTy.value + e.translationY, paperPanLimit(paper.h, ah, zoom.value));
    })
    .onEnd(() => {
      'worklet';
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((_e, success) => {
      'worklet';
      if (!success) return;
      const next = doubleTapZoom(zoom.value);
      zoom.value = withTiming(next);
      savedZoom.value = next;
      tx.value = withTiming(0);
      ty.value = withTiming(0);
      savedTx.value = 0;
      savedTy.value = 0;
      runOnJS(setZoomed)(next > PAPER_ZOOM_MIN);
    });
  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: zoom.value }] }));
  return { gesture, style, zoomed, reset: () => reset(true) };
}
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
  // Değersiz alan yalnız önizlemede kırmızı kesikli çerçeve + "… — boş" (kullanıcı 2026-11-11). Sistemin kesimde atadığı
  // alan (barkod metni, tarih) eksik değildir: gri italik "kesimde atanır", dokunulamaz.
  const auto = isSystemAssignedField(el);
  const empty = !!el.empty && !auto;
  const canEdit = editable && !auto;
  const shown = auto ? AUTO_FIELD_TEXT : empty ? emptyFieldText(el.text, el.bind) : el.text;
  const txt = (
    <Text
      style={[
        { fontSize, lineHeight: fontSize * 1.15, fontWeight: el.bold ? '700' : '400', color: palette.black, fontFamily: 'monospace' },
        empty && styles.emptyText,
        auto && styles.autoText,
      ]}
      numberOfLines={1}
      testID={auto ? `onizleme-oto-${el.bind}` : empty ? `onizleme-bos-${el.bind}` : undefined}
    >
      {shown}
    </Text>
  );
  const hitStyle = empty ? styles.emptyHit : styles.editHit;
  return (
    <View style={[{ position: 'absolute', top: el.y * s - fontSize * 0.1 }, pos, el.rot ? { transform: [{ rotate: `${el.rot}deg` }] } : null]}>
      {canEdit ? (
        <TouchableRipple
          onPress={() => onEdit({ x: el.x * s, y: el.y * s, h: fontSize * 1.15, align: el.align })}
          hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
          style={hitStyle}
          accessibilityLabel={`Düzenle: ${shown}`}
          testID={`onizleme-alan-${el.bind}`}
        >
          {txt}
        </TouchableRipple>
      ) : empty ? (
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
  const s = box ? fitPaperScale(box.w, box.h, wMm, hMm) : 0;
  const zoomCtl = usePaperZoom({ w: wMm * s, h: hMm * s }, box, useContext(PaperZoomResetContext));
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
        <GestureDetector gesture={zoomCtl.gesture}>
        <Animated.View style={styles.paperLayer} collapsable={false}>
        {s > 0 && (
          <Animated.View style={[styles.paper, { width: wMm * s, height: hMm * s }, zoomCtl.style]}>
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
          </Animated.View>
        )}
        </Animated.View>
        </GestureDetector>
        {zoomCtl.zoomed && (
          <TouchableRipple
            onPress={zoomCtl.reset}
            style={styles.zoomChip}
            borderless
            accessibilityRole="button"
            accessibilityLabel="Yakınlaştırmayı sıfırla"
            testID="onizleme-zoom-sifirla"
          >
            <Text style={styles.zoomChipText}>1×</Text>
          </TouchableRipple>
        )}
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
  wrap: { flex: 1, minHeight: 0, gap: 4 },
  // minHeight 0: kaydırmasız sol sütunda alan kalan yere küçülebilsin (kâğıt ölçeği onLayout'tan izler).
  area: { flex: 1, minHeight: 0, overflow: 'hidden' },
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
  autoText: { color: palette.slate[400], fontStyle: 'italic' },
  editHit: { backgroundColor: EDIT_BG, borderBottomWidth: 2, borderBottomColor: EDIT_BORDER, borderRadius: 3, paddingHorizontal: 2 },
  rowsPad: { padding: 10, gap: 4 },
  rowHit: { alignSelf: 'flex-start' },
  rowText: { color: palette.black, fontFamily: 'monospace' },
  rowBig: { fontWeight: '800' },
  rowMuted: { color: palette.slate[400] },
  // Yakınken köşede sıfırlama çipi; dokunma alanı 48 dp.
  zoomChip: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    minWidth: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: palette.slate[700],
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.sm,
  },
  zoomChipText: { color: palette.white, fontSize: typography.size.base, fontWeight: typography.weight.bold },
  staleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  staleText: { fontSize: 12, color: colors.warningText },
});
