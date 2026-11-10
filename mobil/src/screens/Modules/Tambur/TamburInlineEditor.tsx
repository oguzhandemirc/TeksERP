// Etiket önizlemesinde YERİNDE düzenleme kutusu (2026-11-10; odak perdesi 2026-11-11, kullanıcı): dokunulan alanın
// üstünde yüzen kart açılır, ekranın geri kalanı yavaşça kararır. Yalnız ✓ / klavye "Tamam" kaydeder; perdeye dokunmak
// ya da geri tuşu DEĞİŞİKLİĞİ ATAR. Kart kök portalda çizilir (sağ sütun ve üst bant da kararır); konum, kâğıt
// içindeki görünmez bir çapa noktasının pencere ölçümünden gelir (yakınlaştırma dahil). Sayı → kartın içindeki tuş takımı.
import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Numpad from '../../../components/Numpad';
import { SimplePortal } from '../../../components/SimplePortal';
import { colors, palette, radius, shadow, spacing, typography } from '../../../theme/tokens';
import { durations, easing } from '../../../theme/motion';

/** Elemanın kâğıt üstündeki çapası (px, yakınlaştırmasız kâğıt koordinatı). */
export interface EditAnchor {
  x: number;
  y: number;
  h: number;
  align: 'left' | 'center' | 'right';
}

const PAD = spacing.md;
const LABEL_H = 18;
const GAP = spacing.sm;
const INPUT_H = 56;
const BTN = 56;
const EDGE = spacing.lg;
const DIM = 0.4;

/** Kartın genişliği ve tahmini yüksekliği (ölçüm gelene kadar). */
export function editorCardSize(kind: 'number' | 'text', win: { w: number; h: number }) {
  const w = Math.min(win.w - EDGE * 2, kind === 'number' ? 360 : 460);
  const compactKeys = win.h < 600;
  const keys = kind === 'number' ? (compactKeys ? 4 * 48 : 4 * 68) + 3 * spacing.sm + GAP : 0;
  return { w, h: PAD * 2 + LABEL_H + GAP + INPUT_H + keys, compactKeys };
}

/**
 * Kartın pencere konumu. Saf (birim test). Giriş satırı dokunulan alanın satırına oturur, yazı alanın hizasına
 * yakın başlar; kart pencerede kenar payıyla kalır. Klavye kaydırması ayrıca (canlı) uygulanır.
 */
export function floatingEditorPos(
  a: { x: number; y: number; h: number; align: EditAnchor['align'] },
  card: { w: number; h: number },
  win: { w: number; h: number },
  topInset = 0,
) {
  const textInset = PAD + spacing.md; // kart dolgusu + giriş iç dolgusu
  const rawLeft = a.align === 'right' ? a.x - card.w + textInset + BTN * 2 + GAP * 2 : a.align === 'center' ? a.x - card.w / 2 : a.x - textInset;
  const left = Math.max(EDGE, Math.min(win.w - card.w - EDGE, rawLeft));
  const rawTop = a.y + a.h / 2 - (PAD + LABEL_H + GAP + INPUT_H / 2);
  const minTop = topInset + EDGE;
  const top = Math.max(minTop, Math.min(Math.max(minTop, win.h - card.h - EDGE), rawTop));
  return { left, top };
}

export interface TamburInlineEditorProps {
  kind: 'number' | 'text';
  label: string;
  initial: string;
  placeholder?: string;
  maxLength: number;
  anchor: EditAnchor;
  /** ✓ / "Tamam": değer HEMEN yazılır; kart ardından solarak kapanır. */
  onCommit: (v: string) => void;
  /** Perde / geri tuşu / ✕: değişiklik atılır. */
  onCancel: () => void;
  /** Kapanış animasyonu bitti → çağıran kartı söker. */
  onClosed: () => void;
}

/** Kartın pencere yerleşimi: kâğıttaki çapanın ve portal katmanının pencere ölçümünden. */
function useFloatingPlacement(kind: 'number' | 'text', anchor: EditAnchor) {
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const size = editorCardSize(kind, { w: win.width, h: win.height });
  const [cardH, setCardH] = useState(size.h);
  const [anchorWin, setAnchorWin] = useState<{ x: number; y: number; h: number } | null>(null);
  const [hostOff, setHostOff] = useState({ x: 0, y: 0 });
  const probe = useRef<View>(null);
  const host = useRef<View>(null);
  // Çapa kâğıdın dönüşümlü katmanında → pencere ölçümü yakınlaştırma/kaydırmayı içerir.
  const measure = () =>
    probe.current?.measureInWindow((x, y, _w, h) => {
      if (Number.isFinite(x) && Number.isFinite(y)) setAnchorWin({ x, y, h: Number.isFinite(h) && h > 0 ? h : anchor.h });
    });
  const onHostLayout = () =>
    host.current?.measureInWindow((x, y) => {
      if (Number.isFinite(x) && Number.isFinite(y)) setHostOff({ x, y });
    });
  const a = anchorWin ?? anchor;
  const pos = floatingEditorPos(
    { x: a.x - hostOff.x, y: a.y - hostOff.y, h: a.h, align: anchor.align },
    { w: size.w, h: cardH },
    { w: win.width, h: win.height },
    insets.top,
  );
  return { probe, measure, host, onHostLayout, pos, size, cardH, setCardH, minTop: insets.top + EDGE, bottomLimit: win.height - EDGE };
}

export default function TamburInlineEditor(p: TamburInlineEditorProps) {
  const [draft, setDraft] = useState(p.initial);
  const done = useRef(false);
  // Portal içeriği bir mikrogörev geç tazelenir → düğmeler eski kapanışı tutabilir; taslak ref'ten okunur.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const { probe, measure, host, onHostLayout, pos, size, cardH, setCardH, minTop, bottomLimit } = useFloatingPlacement(p.kind, p.anchor);
  const progress = useSharedValue(0);
  const keyboard = useReanimatedKeyboardAnimation();

  const closedRef = useRef(p.onClosed);
  closedRef.current = p.onClosed;
  const closed = () => closedRef.current();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    progress.value = withTiming(1, { duration: durations.base, easing: easing.decelerate });
    // progress kararlı; yalnız açılışta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) p.onCommit(draftRef.current.trim());
    else p.onCancel();
    progress.value = withTiming(0, { duration: durations.base, easing: easing.accelerate });
    // Söküm JS zamanlayıcısıyla: animasyon geri çağrısı kesilirse (azaltılmış hareket, test) kart asılı kalmasın.
    closeTimer.current = setTimeout(closed, durations.base);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      finishRef.current(false);
      return true;
    });
    return () => sub.remove();
  }, []);

  const dimStyle = useAnimatedStyle(() => ({ opacity: progress.value * DIM }));
  const cardStyle = useAnimatedStyle(() => {
    // Klavye (height negatif akar) kartın altını örtüyorsa kart yukarı kayar; üst kenar güvenli alanda kalır.
    const overlap = pos.top + cardH - (bottomLimit + keyboard.height.value);
    const lift = Math.min(Math.max(0, overlap), Math.max(0, pos.top - minTop));
    return {
      opacity: progress.value,
      transform: [{ translateY: -lift + (1 - progress.value) * 6 }, { scale: 0.97 + progress.value * 0.03 }],
    };
  });

  const change = (v: string) => {
    draftRef.current = v.slice(0, p.maxLength);
    setDraft(draftRef.current);
  };

  return (
    <>
      <View ref={probe} collapsable={false} onLayout={measure} pointerEvents="none" style={[s.probe, { left: p.anchor.x, top: p.anchor.y, height: Math.max(1, p.anchor.h) }]} />
      <SimplePortal>
        <View ref={host} style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={onHostLayout} collapsable={false}>
          <Animated.View style={[StyleSheet.absoluteFill, s.dim, dimStyle]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => finish(false)} accessibilityRole="button" accessibilityLabel="Vazgeç" testID="onizleme-perde" />
          </Animated.View>
          <Animated.View
            style={[s.card, { left: pos.left, top: pos.top, width: size.w }, cardStyle]}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 0 && Math.abs(h - cardH) > 1) setCardH(h);
            }}
            testID="onizleme-yerinde-kutu"
          >
            <EditorBody kind={p.kind} label={p.label} placeholder={p.placeholder} maxLength={p.maxLength} draft={draft} compactKeys={size.compactKeys} onChange={change} onFinish={finish} />
          </Animated.View>
        </View>
      </SimplePortal>
    </>
  );
}

/** Kartın içi: alan adı, giriş + ✕/✓, sayıda tuş takımı. */
function EditorBody(p: {
  kind: 'number' | 'text';
  label: string;
  placeholder?: string;
  maxLength: number;
  draft: string;
  compactKeys: boolean;
  onChange: (v: string) => void;
  onFinish: (save: boolean) => void;
}) {
  return (
    <>
      <Text style={s.label} numberOfLines={1}>
        {p.label}
      </Text>
      <View style={s.row}>
        <View style={s.field}>
          <TextInput
            value={p.draft}
            onChangeText={p.onChange}
            autoFocus
            // Sayıda sistem klavyesi açılmaz: kartın kendi tuş takımı yazar (tablet sözleşmesi).
            showSoftInputOnFocus={p.kind === 'text'}
            keyboardType={p.kind === 'number' ? 'decimal-pad' : 'default'}
            placeholder={p.placeholder}
            placeholderTextColor={palette.slate[400]}
            returnKeyType="done"
            submitBehavior="blurAndSubmit"
            onSubmitEditing={() => p.onFinish(true)}
            selectionColor={colors.brand}
            cursorColor={colors.brand}
            style={s.input}
            accessibilityLabel={p.label}
            testID="onizleme-yerinde"
          />
        </View>
        <TouchableRipple onPress={() => p.onFinish(false)} borderless style={[s.btn, s.cancel]} accessibilityRole="button" accessibilityLabel="Vazgeç" testID="onizleme-vazgec">
          <Icon source="close" size={24} color={palette.slate[700]} />
        </TouchableRipple>
        <TouchableRipple onPress={() => p.onFinish(true)} borderless rippleColor={palette.indigo[200]} style={[s.btn, s.ok]} accessibilityRole="button" accessibilityLabel="Onayla" testID="onizleme-onay">
          <Icon source="check" size={26} color={palette.white} />
        </TouchableRipple>
      </View>
      {p.kind === 'number' ? <Numpad value={p.draft} onChange={p.onChange} allowDecimal maxLength={p.maxLength} compact={p.compactKeys} /> : null}
    </>
  );
}

const s = StyleSheet.create({
  probe: { position: 'absolute', width: 1, opacity: 0 },
  dim: { backgroundColor: palette.black },
  card: {
    position: 'absolute',
    padding: PAD,
    gap: GAP,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadow.lg,
  },
  label: { height: LABEL_H, fontSize: typography.size.xs, fontWeight: typography.weight.semibold, color: colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: GAP },
  field: { flex: 1, height: INPUT_H, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, justifyContent: 'center' },
  input: {
    height: INPUT_H,
    paddingHorizontal: spacing.md,
    paddingVertical: 0,
    fontSize: typography.size.xl,
    fontWeight: typography.weight.semibold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  btn: { width: BTN, height: BTN, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  cancel: { backgroundColor: colors.surfaceMuted },
  ok: { backgroundColor: colors.brand },
});
