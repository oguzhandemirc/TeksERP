// BELGE TİPİ TANITMA — tablet (S1b, fabrika cevabı 16/18/38; panel `TanitPage` ikizi). Tam ekran: okunmuş sayfa fotoğrafı +
// OCR kelime kutuları (iki parmakla yakınlaştır, serbest kaydır) + yan/alt panel. Varsayılan REHBERLİ kip (K30-A2: başlık → alanlar
// sırayla → ad + kaydet); "Gelişmiş" eski serbest kip (tablo/bölüm). Yatay tablette yan yana, dikey telefonda alt alta. Yalnız JS.
import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator, Button, IconButton, Text } from 'react-native-paper';
import AppModal from '../../../../components/AppModal';
import { colors, spacing, typography } from '../../../../theme';
import type { ScanWords } from '../../../../types/inboundDocTeach';
import { FINISH_STEP, guidedMarks, stepField, toggleFieldWord, toggleHeaderWord, type FieldKey } from './guided';
import GuidedPanel from './GuidedPanel';
import SimilarDialog from './SimilarDialog';
import { clearField, teachMarks, toggleWord, type ScanMark } from './teachDraft';
import { photoSize, type TeachPage } from './teachPages';
import { useTeachModal, type TeachModalState, type TeachSaved } from './useTeachModal';
import TeachPanel from './TeachPanel';
import TeachPreview from './TeachPreview';

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
function ScanPane({ uri, scan, marks, size, onToggle }: { uri: string; scan: ScanWords; marks: ScanMark[]; size: ViewStyle; onToggle: (i: number) => void }) {
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const photo = photoSize(scan);
  const k = frame.width > 0 && photo.width > 0 && photo.height > 0 ? Math.min(frame.width / photo.width, frame.height / photo.height) : 0;
  const cw = photo.width * k;
  const ch = photo.height * k;
  const { gesture, moved, zoomed, reset } = usePinchPan(frame, cw, ch);
  // Kenar kalınlığı yakınlıkla büyümesin (yazıyı örtmesin); hareket bitince bir kez güncellenir.
  const border = 2 / zoomed;
  return (
    <View style={[styles.scanPane, size]}>
      <View style={styles.zoomRow}>
        <Text style={styles.zoomHint}>Yazıya dokunun · iki parmakla yakınlaştırın · tek parmakla kaydırın</Text>
        <Button mode="outlined" compact icon="fit-to-screen-outline" disabled={zoomed <= 1.01} onPress={() => reset(true)} contentStyle={styles.btn} testID="tanit-sigdir">
          Sığdır
        </Button>
      </View>
      <GestureDetector gesture={gesture}>
        <View style={styles.frame} collapsable={false} onLayout={(e) => setFrame({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })} testID="tanit-foto-cerceve">
          <Animated.View style={[{ width: cw, height: ch }, moved]}>
            {/* Tam çözünürlük (scale): yakınlaşınca küçük yazı bulanıklaşmasın. */}
            <Image source={{ uri }} style={{ width: cw, height: ch }} resizeMode="stretch" resizeMethod="scale" testID="tanit-foto" />
            {marks.map((m, i) => (
              <Pressable
                key={m.key}
                onPress={() => onToggle(i)}
                accessibilityLabel={m.label}
                hitSlop={4}
                style={[
                  styles.mark,
                  { left: m.box.x * k, top: m.box.y * k, width: Math.max(m.box.width * k, 8), height: Math.max(m.box.height * k, 8), borderWidth: border },
                  { borderColor: TONE[m.tone].border, backgroundColor: TONE[m.tone].bg },
                ]}
                testID={`tanit-kutu-${i}`}
              />
            ))}
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
}

export default function TeachModal({ visible, pages, code, onDismiss, onSaved }: Props) {
  const { width, height } = useWindowDimensions();
  const portrait = width < height;
  const insets = useSafeAreaInsets();
  const [pageIdx, setPageIdx] = useState(0);
  const nav = useGuidedNav(visible);
  const { advanced, step } = nav;
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
  const title = t.existing ? `Şablonu güncelle — ${t.existing.name}` : 'Bu belgeyi tanıt';
  // Bölme oranla (flex 58/42) değil ölçüyle: tablette fotoğraf bölmesi tüm alanı yutup paneli 32 px'e sıkıştırıyordu (2026-11-05 cihaz ölçümü).
  const paneSize: ViewStyle = portrait ? { height: Math.round(height * 0.45) } : { width: Math.round(width * 0.58) - spacing.md };
  const words = t.words.data?.words ?? [];
  const marks = t.state ? (advanced ? teachMarks(t.state, words) : guidedMarks(t.state, words, step)) : [];
  const onTap = (i: number) =>
    t.setState((s) => {
      if (advanced) return toggleWord(s, i);
      if (step === 0) return toggleHeaderWord(s, words, i);
      const key = stepField(step);
      return key ? toggleFieldWord(s, words, key, i) : s;
    });
  return (
    // Kaydırma (yakınlaştırılmış fotoğraf) ile çakışmasın diye sürükleyip kapatma kapalı; kapat düğmesi + geri tuşu var.
    <AppModal visible={visible} onDismiss={onDismiss} position="right" contentStyle={{ width, height }} swipeToDismiss={false}>
      <View style={[styles.page, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.sm }]} testID="tanit-modal">
        <View style={styles.header}>
          <Text style={styles.title} testID="tanit-baslik">
            {title}
            {t.existing ? ` · sürüm ${t.existing.version} → ${t.existing.version + 1}` : ''}
          </Text>
          <Button mode={advanced ? 'contained-tonal' : 'text'} icon={advanced ? 'school-outline' : 'tune'} onPress={nav.toggleAdvanced} contentStyle={styles.btn} testID="tanit-gelismis">
            {advanced ? 'Adım adım' : 'Gelişmiş'}
          </Button>
          <IconButton icon="close" size={32} style={styles.iconBtn} onPress={onDismiss} accessibilityLabel="Tanıtmayı kapat" testID="tanit-kapat" />
        </View>
        {pages.length > 1 && (
          <View style={styles.zoomRow}>
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
          <View style={[styles.body, portrait && styles.bodyPortrait]}>
            <ScanPane key={page.scanId} uri={page.uri} scan={t.words.data} marks={marks} size={paneSize} onToggle={onTap} />
            <ScrollView style={portrait ? styles.sidePortrait : styles.side} contentContainerStyle={styles.sideBody} keyboardShouldPersistTaps="handled">
              <TeachSide t={t} nav={nav} />
            </ScrollView>
          </View>
        )}
      </View>
      <SimilarDialog similar={t.similar} currentName={t.existing?.name ?? null} onSame={t.chooseSimilar} onNew={t.saveAsNew} onDismiss={t.dismissSimilar} />
    </AppModal>
  );
}


/** Yan panel: rehberli adımlar | gelişmiş serbest panel + eksikler + önizleme + düğmeler. */
function TeachSide({ t, nav }: { t: TeachModalState; nav: GuidedNav }) {
  const { advanced, step } = nav;
  const state = t.state!;
  return (
    <>
      {advanced ? (
        <TeachPanel state={state} words={t.words.data?.words ?? []} onChange={t.setState} old={t.existing?.template ?? null} />
      ) : (
        <GuidedPanel
          state={state}
          onChange={t.setState}
          step={step}
          onStep={nav.onStep}
          skipped={nav.skipped}
          onSkip={(k) => {
            t.setState((s) => clearField(s, k));
            nav.skip(k);
          }}
          preview={{ result: t.preview, fresh: t.previewFresh, error: t.previewError, blocked: t.previewBlocked }}
        />
      )}
      {t.problems.length > 0 && (advanced || step === FINISH_STEP) && (
        <View testID="tanit-eksikler">
          {t.problems.map((p) => (
            <Text key={p} style={styles.warn}>
              • {p}
            </Text>
          ))}
        </View>
      )}
      {advanced && t.preview && <TeachPreview result={t.preview} stale={!t.previewFresh} />}
      <View style={styles.actions}>
        {advanced && (
          <Button mode="outlined" icon="eye" onPress={() => void t.runPreview()} disabled={t.problems.length > 0 || t.busy !== null} loading={t.busy === 'preview'} contentStyle={styles.btn} testID="tanit-onizle">
            Önizle
          </Button>
        )}
        <Button mode="contained" icon="content-save" onPress={() => void t.save()} disabled={!t.canSave} loading={t.busy === 'save'} contentStyle={styles.btn} testID="tanit-kaydet">
          {t.existing ? 'Şablonu güncelle' : 'Belge tipini kaydet'}
        </Button>
      </View>
      {!advanced && step !== FINISH_STEP && t.problems.length > 0 && (
        <Text style={styles.warn} testID="tanit-kaydet-neden">{`Kaydetmek için: ${t.problems[0]}`}</Text>
      )}
    </>
  );
}

/** Rehber gezintisi (adım, atlanan alanlar, kip); her açılış rehberin başından başlar. */
function useGuidedNav(visible: boolean) {
  const [advanced, setAdvanced] = useState(false);
  const [step, setStep] = useState(0);
  const [skipped, setSkipped] = useState<FieldKey[]>([]);
  useEffect(() => {
    if (!visible) return;
    setAdvanced(false);
    setStep(0);
    setSkipped([]);
  }, [visible]);
  return {
    advanced,
    step,
    skipped,
    toggleAdvanced: () => setAdvanced((a) => !a),
    onStep: (n: number) => {
      const key = stepField(n);
      if (key) setSkipped((xs) => xs.filter((k) => k !== key));
      setStep(n);
    },
    skip: (k: FieldKey) => setSkipped((xs) => (xs.includes(k) ? xs : [...xs, k])),
  };
}
type GuidedNav = ReturnType<typeof useGuidedNav>;

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.appBg, paddingHorizontal: spacing.md, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: colors.text },
  iconBtn: { width: 56, height: 56, margin: 0 },
  body: { flex: 1, flexDirection: 'row', gap: spacing.md },
  bodyPortrait: { flexDirection: 'column' },
  scanPane: { gap: spacing.sm, backgroundColor: colors.surfaceSunken },
  zoomRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  zoomHint: { flex: 1, fontSize: typography.size.sm, color: colors.textSecondary, marginLeft: spacing.sm },
  frame: { flex: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  mark: { position: 'absolute', borderRadius: 2 },
  side: { flex: 1 },
  sidePortrait: { flex: 1 },
  sideBody: { gap: spacing.md, paddingBottom: spacing.xl },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm },
  btn: { minHeight: 56 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  error: { fontSize: typography.size.base, color: colors.dangerText },
  warn: { fontSize: typography.size.sm, color: colors.warningText },
});
