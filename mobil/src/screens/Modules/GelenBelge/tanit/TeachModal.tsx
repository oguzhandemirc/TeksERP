// BELGE TİPİ TANITMA — tablet (S1b, fabrika cevabı 16/18/38; panel `TanitPage` ikizi). Tam ekran: okunmuş sayfa fotoğrafı +
// OCR kelime kutuları (iki parmakla yakınlaştır, serbest kaydır) + yan/alt panel. Varsayılan ÜÇ AŞAMA (2026-11-09: ① Tanıma ·
// ② Eşleme · ③ Kurallar); "Serbest işaretleme" eski serbest kip. Düzen `teachLayout`; şerit ve Kaydet çubuğu kaydırmadan bağımsız.
import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator, Button, IconButton, Text } from 'react-native-paper';
import AppModal from '../../../../components/AppModal';
import TruncatedText from '../../../../components/TruncatedText';
import { colors, radius, spacing, typography } from '../../../../theme';
import type { ScanWords } from '../../../../types/inboundDocTeach';
import SimilarDialog from './SimilarDialog';
import { canAdvance, stageMarks, stageTap } from './stages';
import { teachMarks, toggleWord, type ScanMark } from './teachDraft';
import { teachLayout } from './teachLayout';
import { photoSize, type TeachPage } from './teachPages';
import { normTurns, rotateBox, rotatedSize } from './rotateBox';
import TeachSide from './TeachSide';
import { useStageNav } from './useStageNav';
import { useTeachModal, type TeachSaved } from './useTeachModal';

interface Props {
  visible: boolean;
  pages: readonly TeachPage[];
  /** Güncellenecek kullanıcı şablonu (`u-…`); null → yeni belge tipi. */
  code: string | null;
  onDismiss: () => void;
  /** Kayıt sonrası (kapanıştan önce): çağıran belgeyi yeni şablonla yeniden doldurur. */
  onSaved?: (r: TeachSaved) => void;
}

const MAX_ZOOM = 6;
// Kenar jetondan; dolgu yarı saydam (altındaki yazı okunur kalsın).
const TONE: Record<ScanMark['tone'], { border: string; bg: string }> = {
  word: { border: colors.info, bg: 'transparent' },
  selected: { border: colors.warning, bg: 'rgba(245,158,11,0.30)' },
  field: { border: colors.success, bg: 'rgba(16,185,129,0.25)' },
  column: { border: colors.brand, bg: 'rgba(79,70,229,0.22)' },
  section: { border: colors.danger, bg: 'rgba(239,68,68,0.22)' },
  identifier: { border: colors.brand, bg: 'rgba(79,70,229,0.30)' },
};

/** Kaydırma payı: büyütülmüş içerik bölmeden taşan kadar kayar, boşluk açılmaz. */
function clampShift(t: number, zoom: number, content: number, frame: number) {
  'worklet';
  const room = Math.max(0, (content * zoom - frame) / 2);
  return Math.min(room, Math.max(-room, t));
}

/** İki parmak yakınlaştırma + tek parmak serbest kaydırma; `zoomed` hareket bitince güncellenen (React) yakınlık. */
function usePinchPan(frame: { width: number; height: number }, cw: number, ch: number) {
  const [zoomed, setZoomed] = useState(1);
  const zoom = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const start = useSharedValue({ zoom: 1, tx: 0, ty: 0, fx: 0, fy: 0 });
  const reset = (animate: boolean) => {
    zoom.value = animate ? withTiming(1) : 1;
    tx.value = animate ? withTiming(0) : 0;
    ty.value = animate ? withTiming(0) : 0;
    setZoomed(1);
  };
  // Dönüşte bölme ölçüsü değişir; eski kaydırma payı geçersiz kalır.
  useEffect(() => reset(false), [frame.width, frame.height]); // eslint-disable-line react-hooks/exhaustive-deps

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      'worklet';
      start.value = { zoom: zoom.value, tx: tx.value, ty: ty.value, fx: e.focalX - frame.width / 2, fy: e.focalY - frame.height / 2 };
    })
    .onUpdate((e) => {
      'worklet';
      const s0 = start.value;
      const next = Math.min(MAX_ZOOM, Math.max(1, s0.zoom * e.scale));
      const r = next / s0.zoom;
      tx.value = clampShift(e.focalX - frame.width / 2 - r * (s0.fx - s0.tx), next, cw, frame.width);
      ty.value = clampShift(e.focalY - frame.height / 2 - r * (s0.fy - s0.ty), next, ch, frame.height);
      zoom.value = next;
    })
    .onEnd(() => {
      'worklet';
      runOnJS(setZoomed)(zoom.value);
    });
  // Tek parmak; ikinci parmak inince kaydırma biter, yakınlaştırma devralır.
  const pan = Gesture.Pan()
    .maxPointers(1)
    .onStart(() => {
      'worklet';
      start.value = { ...start.value, tx: tx.value, ty: ty.value };
    })
    .onUpdate((e) => {
      'worklet';
      tx.value = clampShift(start.value.tx + e.translationX, zoom.value, cw, frame.width);
      ty.value = clampShift(start.value.ty + e.translationY, zoom.value, ch, frame.height);
    });
  const moved = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: zoom.value }] }));
  return { gesture: Gesture.Simultaneous(pinch, pan), moved, zoomed, reset };
}

// Fotoğraf galerisi gibi: sayfa bölmeye sığar, iki parmakla yakınlaşır (parmakların altındaki nokta yerinde kalır), tek parmakla
// her yöne kayar. İç içe ScrollView'lar yalnız dik/yatay kaydırıyordu (2026-11-05 kullanıcı denemesi).
// Döndür yalnız GÖRÜNTÜDÜR: kutular `photoRect`ten dönmüş çerçeveye çevrilip çizilir, dokunma kelime sırasıyla çalışır; öneri ucuna
// `rect` (OCR dik çerçevesi) gider — kaydedilen şablon döndürmeden bağımsızdır (`rotateBox.ts`).
function ScanPane({ uri, scan, marks, size, turns, onRotate, onToggle }: { uri: string; scan: ScanWords; marks: ScanMark[]; size: ViewStyle; turns: number; onRotate: () => void; onToggle: (i: number) => void }) {
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const photo = photoSize(scan);
  const q = normTurns(turns);
  const view = rotatedSize(photo.width, photo.height, q);
  const k = frame.width > 0 && view.width > 0 && view.height > 0 ? Math.min(frame.width / view.width, frame.height / view.height) : 0;
  const cw = view.width * k;
  const ch = view.height * k;
  // Görüntü dönmeden önceki ölçüsüyle çizilip merkezinden döndürülür; dönmüş hâli tam (cw × ch) kabını doldurur.
  const iw = photo.width * k;
  const ih = photo.height * k;
  const { gesture, moved, zoomed, reset } = usePinchPan(frame, cw, ch);
  useEffect(() => reset(false), [q]); // eslint-disable-line react-hooks/exhaustive-deps
  // Kenar kalınlığı yakınlıkla büyümesin (yazıyı örtmesin); hareket bitince bir kez güncellenir.
  const border = 2 / zoomed;
  return (
    <View style={[styles.scanPane, size]}>
      <GestureDetector gesture={gesture}>
        <View style={styles.frame} collapsable={false} onLayout={(e) => setFrame({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })} testID="tanit-foto-cerceve">
          <Animated.View style={[{ width: cw, height: ch }, moved]}>
            {/* Tam çözünürlük (scale): yakınlaşınca küçük yazı bulanıklaşmasın. */}
            <Image
              source={{ uri }}
              style={{ position: 'absolute', left: (cw - iw) / 2, top: (ch - ih) / 2, width: iw, height: ih, transform: [{ rotate: `${q * 90}deg` }] }}
              resizeMode="stretch"
              resizeMethod="scale"
              testID="tanit-foto"
            />
            {marks.map((m, i) => {
              const b = rotateBox(m.box, photo.width, photo.height, q);
              return (
              <Pressable
                key={m.key}
                onPress={() => onToggle(i)}
                accessibilityLabel={m.label}
                hitSlop={4}
                style={[
                  styles.mark,
                  { left: b.x * k, top: b.y * k, width: Math.max(b.width * k, 8), height: Math.max(b.height * k, 8), borderWidth: border },
                  { borderColor: TONE[m.tone].border, backgroundColor: TONE[m.tone].bg },
                ]}
                testID={`tanit-kutu-${i}`}
              />
              );
            })}
          </Animated.View>
        </View>
      </GestureDetector>
      <IconButton icon="rotate-right" mode="contained-tonal" size={28} style={[styles.iconBtn, styles.rotate]} onPress={onRotate} accessibilityLabel="Fotoğrafı döndür" testID="tanit-dondur" />
      {/* Yakınlaşınca görünür: ipucu yazısı yerine tek düğme (az yazı). */}
      {zoomed > 1.01 && (
        <IconButton icon="fit-to-screen-outline" mode="contained-tonal" size={28} style={[styles.iconBtn, styles.fit]} onPress={() => reset(true)} accessibilityLabel="Sığdır" testID="tanit-sigdir" />
      )}
    </View>
  );
}

/** Sayfa başına görüntü dönüşü (çeyrek); yalnız bu tanıtma oturumu — kapanınca sıfırlanır, fotoğraf dosyasına dokunulmaz. */
function usePageTurns(visible: boolean) {
  const [turns, setTurns] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!visible) setTurns({});
  }, [visible]);
  return {
    of: (scanId: string) => turns[scanId] ?? 0,
    rotate: (scanId: string) => setTurns((m) => ({ ...m, [scanId]: normTurns((m[scanId] ?? 0) + 1) })),
  };
}

/** Yanlış tanınmış belgeden çıkış: kayıt X'i değiştirir; "Yeni tip olarak tanıt" X'e dokunmadan baştan tanıtır. */
function NotThisType({ name, onNew }: { name: string; onNew: () => void }) {
  return (
    <View style={styles.notThis} testID="tanit-bu-degil">
      <Text style={styles.notThisText}>{`Bu belge "${name}" değil mi? Kaydetmek o tanımı değiştirir — yeni tip olarak tanıtın.`}</Text>
      <Button mode="outlined" icon="file-plus-outline" onPress={onNew} contentStyle={styles.btn} testID="tanit-yeni-tip">
        Yeni tip olarak tanıt
      </Button>
    </View>
  );
}

export default function TeachModal({ visible, pages, code, onDismiss, onSaved }: Props) {
  const { width, height } = useWindowDimensions();
  const layout = teachLayout(width, height);
  const insets = useSafeAreaInsets();
  const [pageIdx, setPageIdx] = useState(0);
  const turns = usePageTurns(visible);
  const nav = useStageNav(visible);
  const { advanced, stage } = nav;
  const page = pages[Math.min(pageIdx, Math.max(0, pages.length - 1))] ?? null;
  const t = useTeachModal(
    visible ? (page?.scanId ?? null) : null,
    visible ? code : null,
    (r) => {
      onSaved?.(r);
      onDismiss();
    },
    { auto: !advanced },
  );
  const title = t.existing ? `Tanımı düzenle — ${t.existing.name}` : 'Bu belgeyi tanıt';
  const startNew = () => {
    t.startNew();
    nav.goTo('TANIMA', null);
  };
  // Bölme oranla (flex 58/42) değil ölçüyle: tablette fotoğraf bölmesi tüm alanı yutup paneli 32 px'e sıkıştırıyordu (2026-11-05 cihaz ölçümü).
  const paneSize: ViewStyle = layout.mode === 'side' ? { width: layout.imageWidth - spacing.md } : { height: layout.imageHeight };
  const words = t.words.data?.words ?? [];
  const marks = t.state ? (advanced ? teachMarks(t.state, words, t.located) : stageMarks(t.state, words, { stage, target: nav.target }, t.located)) : [];
  const onTap = (i: number) => t.setState((s) => (advanced ? toggleWord(s, i) : stageTap(s, words, { stage, target: nav.target }, i)));
  // Düzenlemede kimlik ve ad zaten hazır: ① temizse doğrudan ② Eşleme'den başlanır (açılış başına bir kez).
  const opened = useRef(false);
  useEffect(() => {
    if (!visible) opened.current = false;
    else if (!opened.current && t.state && words.length > 0) {
      opened.current = true;
      if (t.existing && canAdvance(t.state, words, 'TANIMA')) nav.goTo('ESLEME', t.state);
    }
  }, [visible, t.state, t.existing, words]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    // Kaydırma (yakınlaştırılmış fotoğraf) ile çakışmasın diye sürükleyip kapatma kapalı; kapat düğmesi + geri tuşu var.
    <AppModal visible={visible} onDismiss={onDismiss} position="right" contentStyle={{ width, height }} swipeToDismiss={false}>
      <View style={[styles.page, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.sm }]} testID="tanit-modal">
        <View style={styles.header}>
          <TruncatedText style={styles.title} revealOnTap testID="tanit-baslik">{title}</TruncatedText>
          {t.existing && (
            <Text style={styles.version} accessibilityLabel={`sürüm ${t.existing.version} → ${t.existing.version + 1}`} testID="tanit-surum">
              {`v${t.existing.version} → ${t.existing.version + 1}`}
            </Text>
          )}
          <Button mode="text" icon={advanced ? 'school-outline' : 'gesture-tap-box'} onPress={nav.toggleAdvanced} contentStyle={styles.btn} testID="tanit-gelismis">
            {advanced ? 'Adım adım' : 'Serbest işaretleme'}
          </Button>
          <IconButton icon="close" size={32} style={styles.iconBtn} onPress={onDismiss} accessibilityLabel="Tanıtmayı kapat" testID="tanit-kapat" />
        </View>
        {t.existing && <NotThisType name={t.existing.name} onNew={startNew} />}
        {pages.length > 1 && (
          <View style={styles.pages}>
            {pages.map((p, i) => (
              <Button key={p.scanId} mode={p.scanId === page?.scanId ? 'contained' : 'outlined'} compact onPress={() => setPageIdx(i)} contentStyle={styles.btn} testID={`tanit-sayfa-${p.pageNo}`}>
                {`Sayfa ${p.pageNo}`}
              </Button>
            ))}
          </View>
        )}
        {t.existingError || t.words.isError ? (
          <Text style={styles.error} testID="tanit-hata">Bu sayfanın okunan yazıları alınamadı.</Text>
        ) : !page || !t.state || !t.words.data ? (
          <View style={styles.loading}>
            <ActivityIndicator />
            <Text>Okunan yazılar yükleniyor…</Text>
          </View>
        ) : (
          <View style={[styles.body, layout.mode === 'stack' && styles.bodyStack]} testID={layout.mode === 'side' ? 'tanit-duzen-yan' : 'tanit-duzen-ust'}>
            <ScanPane key={page.scanId} uri={page.uri} scan={t.words.data} marks={marks} size={paneSize} turns={turns.of(page.scanId)} onRotate={() => turns.rotate(page.scanId)} onToggle={onTap} />
            <TeachSide t={t} nav={nav} />
          </View>
        )}
      </View>
      <SimilarDialog similar={t.similar} currentName={t.existing?.name ?? null} onSame={t.chooseSimilar} onNew={t.saveAsNew} onDismiss={t.dismissSimilar} />
    </AppModal>
  );
}


const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.appBg, paddingHorizontal: spacing.lg, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56 },
  title: { flex: 1, fontSize: typography.size.xl, fontWeight: typography.weight.bold, color: colors.text },
  version: { fontSize: typography.size.sm, color: colors.textSecondary, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken },
  iconBtn: { width: 56, height: 56, margin: 0 },
  fit: { position: 'absolute', top: spacing.sm, right: spacing.sm },
  rotate: { position: 'absolute', top: spacing.sm, left: spacing.sm },
  pages: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  notThis: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  notThisText: { flexShrink: 1, fontSize: typography.size.sm, color: colors.textSecondary },
  body: { flex: 1, flexDirection: 'row', gap: spacing.lg },
  bodyStack: { flexDirection: 'column', gap: spacing.md },
  scanPane: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceSunken },
  frame: { flex: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  mark: { position: 'absolute', borderRadius: 2 },
  btn: { minHeight: 56 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  error: { fontSize: typography.size.base, color: colors.dangerText },
});
