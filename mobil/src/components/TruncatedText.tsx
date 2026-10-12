// =============================================================================
// TruncatedText — ad metninin TEK kaynağı: tek satır "…", tam ad balonda
// =============================================================================
// Kullanıcı kararı: uzun tezgah/ürün/müşteri/iş emri/cari adı sığmazsa tek
// satırda kısalır; basılı tutunca (salt gösterge yüzeyde dokununca da) tam ad
// balonda görünür. Ekranlar bu davranışı elle kopyalamaz (bekçi
// `test/ad-metni.guard.test.ts`).
//
// Basılı tutma RNGH `LongPress` ile: RN `Text onLongPress` dokunuşu yutar ve
// satırın kendi `onPress`ini öldürürdü. Kısa dokunuş jest'i hiç aktive etmez
// (satır davranışı aynen kalır); aktive olunca RNGH JS yanıtlayıcısını iptal
// eder. Kısalma, aynı stilde gizli ölçü kopyasının satır sayısıyla anlaşılır;
// kısalmamış adda jest kapalıdır (balon yok, satıra sıfır etki).
// =============================================================================

import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextLayoutEventData,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Text } from 'react-native-paper';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { colors, radius, spacing, typography } from '../theme';
import { computeBalloonLayout, type BalloonPoint } from './truncatedTextLayout';

type TextPart = string | number | null | undefined | false;

export interface TruncatedTextProps {
  children: TextPart | TextPart[];
  style?: StyleProp<TextStyle>;
  variant?: React.ComponentProps<typeof Text>['variant'];
  /** Salt gösterge yüzey (başlık, çip): tek dokunuş da balon açar. Basılabilir satırda VERME. */
  revealOnTap?: boolean;
  testID?: string;
}

export const LONG_PRESS_MS = 400;

/** Sarmalayıcıya giden yerleşim anahtarları; gerisi metin stilidir. */
const LAYOUT_KEYS = new Set<string>([
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf',
  'width', 'minWidth', 'maxWidth',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'marginHorizontal', 'marginVertical', 'marginStart', 'marginEnd',
  'position', 'top', 'bottom', 'left', 'right', 'zIndex',
]);

export function splitTruncatedStyle(style: StyleProp<TextStyle>): { box: ViewStyle; text: TextStyle } {
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const box: Record<string, unknown> = {};
  const text: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) (LAYOUT_KEYS.has(k) ? box : text)[k] = v;
  return { box: box as ViewStyle, text: text as TextStyle };
}

export function flattenTextParts(children: TextPart | TextPart[]): string {
  const parts = Array.isArray(children) ? children : [children];
  return parts.filter((p) => p !== null && p !== undefined && p !== false).join('');
}

export default function TruncatedText({ children, style, variant, revealOnTap = false, testID }: TruncatedTextProps) {
  const full = flattenTextParts(children);
  const { box, text } = useMemo(() => splitTruncatedStyle(style), [style]);
  const [truncated, setTruncated] = useState(false);
  const [balloonAt, setBalloonAt] = useState<BalloonPoint | null>(null);
  const { width: vw, height: vh } = useWindowDimensions();

  const onMeasure = useCallback((e: NativeSyntheticEvent<TextLayoutEventData>) => {
    const next = e.nativeEvent.lines.length > 1;
    setTruncated((prev) => (prev === next ? prev : next));
  }, []);

  const open = useCallback((x: number, y: number) => setBalloonAt({ x, y }), []);
  const close = useCallback(() => setBalloonAt(null), []);

  const gesture = useRevealGesture(truncated, revealOnTap, open, testID);

  return (
    <>
      <GestureDetector gesture={gesture}>
        <View style={box} collapsable={false}>
          <Text
            variant={variant}
            style={text}
            numberOfLines={1}
            ellipsizeMode="tail"
            testID={testID}
            accessibilityLabel={full}
            accessibilityHint={truncated ? 'Tam adı görmek için basılı tutun' : undefined}
            accessibilityActions={truncated ? [{ name: 'longpress', label: 'Tam adı göster' }] : undefined}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === 'longpress') open(vw / 2, vh / 2);
            }}
          >
            {full}
          </Text>
          <Text
            variant={variant}
            style={[text, styles.measure]}
            onTextLayout={onMeasure}
            testID={testID ? `${testID}-olcu` : 'tam-ad-olcu'}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
          >
            {full}
          </Text>
        </View>
      </GestureDetector>
      {balloonAt ? <NameBalloon text={full} at={balloonAt} onClose={close} /> : null}
    </>
  );
}

/** Basılı tutma (+ revealOnTap'te tek dokunuş) jest'i; kısalmamış adda kapalı. */
function useRevealGesture(truncated: boolean, revealOnTap: boolean, open: (x: number, y: number) => void, testID?: string) {
  return useMemo(() => {
    const id = testID ?? 'tam-ad';
    const longPress = Gesture.LongPress()
      .minDuration(LONG_PRESS_MS)
      .enabled(truncated)
      .runOnJS(true)
      .withTestId(`${id}-basili`)
      .onStart((e) => open(e.absoluteX, e.absoluteY));
    if (!revealOnTap) return longPress;
    const tap = Gesture.Tap()
      .enabled(truncated)
      .runOnJS(true)
      .withTestId(`${id}-dokunus`)
      .onEnd((e, success) => {
        if (success) open(e.absoluteX, e.absoluteY);
      });
    return Gesture.Exclusive(longPress, tap);
  }, [truncated, revealOnTap, open, testID]);
}

/** Tam ad balonu — dokunma noktasından konumlanır, dokununca kapanır. */
function NameBalloon({ text, at, onClose }: { text: string; at: BalloonPoint; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const layout = computeBalloonLayout(at, { width, height });
  return (
    <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Tam adı kapat" />
      <View
        pointerEvents="none"
        style={[
          styles.balloonBox,
          { left: layout.left, width: layout.width, maxHeight: layout.maxHeight },
          layout.above ? { bottom: layout.bottom } : { top: layout.top },
        ]}
      >
        <View style={styles.balloon} testID="tam-ad-balonu">
          <Text style={styles.balloonText}>{text}</Text>
        </View>
      </View>
    </Modal>
  );
}


const styles = StyleSheet.create({
  measure: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
  balloonBox: { position: 'absolute', alignItems: 'center' },
  balloon: {
    backgroundColor: colors.headerBg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    elevation: 6,
  },
  balloonText: { color: colors.textOnDark, fontSize: typography.size.lg, fontWeight: typography.weight.semibold },
});
