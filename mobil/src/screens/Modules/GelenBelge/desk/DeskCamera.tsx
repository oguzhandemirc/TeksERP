// Belge masası kamerası (K23/K26): kamera sürekli açık; ekrana dokun / "Okut" → tam çözünürlük sayfa, "Oku" → okuma.
// Otomatik kipte (deneysel) `useAutoCapture` ara karelerle çekimi kendisi tetikler. Kameraya erişim TEK sıradan geçer
// (ara kare ile elle çekim üst üste binmez). Tablet yatay: kamera solda + yan panel; telefon dikey: alt çubuk.
import React, { useCallback, useRef, useState, type MutableRefObject } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { withSystemDialog } from '../../../../store/lockStore';
import { colors, radius, spacing, typography } from '../../../../theme';
import { CAPTURE_QUALITY, photoSha256, pickPictureSize, type ScanPage } from '../docScan';
import type { AutoCaptureState } from './autoCapture';
import type { RecentWo } from './deskPlan';
import { useAutoCapture } from './useAutoCapture';

/** Ara kare kalitesi: yalnız bayt boyu sinyali için (görüntü kullanılmaz). */
export const PROBE_QUALITY = 0.05;

export interface DeskCameraProps {
  pages: readonly ScanPage[];
  sending: boolean;
  auto: boolean;
  frameMs: number;
  recent: readonly RecentWo[];
  onCaptured: (p: ScanPage) => void;
  /** "Tekrar çek": son sayfa silinir. */
  onRetake: () => void;
  onRead: () => void;
  onError: (message: string) => void;
  /** Otomatik çekim durumu üstte yaşar: inceleme kamerayı söker, dönüşte boş masa referansı korunur. */
  autoState?: MutableRefObject<AutoCaptureState>;
}

/** Kamera erişim sırası: elle çekim her zaman sıraya girer; ara kare sıra doluysa atlanır (birikmez). */
function useShutter(onCaptured: (p: ScanPage) => void, onError: (m: string) => void) {
  const cameraRef = useRef<CameraView | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const inFlight = useRef(0);
  const [ready, setReady] = useState(false);
  const [shooting, setShooting] = useState(false);
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);

  const run = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    inFlight.current += 1;
    const p = chain.current.then(fn).finally(() => {
      inFlight.current -= 1;
    });
    chain.current = p.catch(() => undefined);
    return p;
  }, []);

  const onReady = useCallback(async () => {
    try {
      setPictureSize(pickPictureSize((await cameraRef.current?.getAvailablePictureSizesAsync()) ?? []));
    } catch {
      setPictureSize(undefined); // kamera varsayılanı; çekim yine çalışır
    }
    setReady(true);
  }, []);

  const probe = useCallback(async (): Promise<number | null> => {
    if (inFlight.current > 0 || !cameraRef.current) return null;
    return run(async () => {
      const pic = await cameraRef.current?.takePictureAsync({ quality: PROBE_QUALITY, base64: true, exif: false, shutterSound: false });
      return pic?.base64 ? pic.base64.length : null;
    });
  }, [run]);

  const shoot = useCallback(async (): Promise<void> => {
    if (!cameraRef.current) return;
    setShooting(true);
    try {
      await run(async () => {
        const pic = await cameraRef.current?.takePictureAsync({ quality: CAPTURE_QUALITY, base64: true, exif: false });
        if (!pic?.base64) throw new Error('Fotoğraf alınamadı');
        const base64 = pic.base64;
        await new Promise((r) => setTimeout(r, 0)); // özet ağır; döndürücü çizilsin
        onCaptured({ base64, sha256: photoSha256(base64), uri: pic.uri, width: pic.width, height: pic.height });
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Fotoğraf çekilemedi');
    } finally {
      setShooting(false);
    }
  }, [run, onCaptured, onError]);

  return { cameraRef, ready, shooting, pictureSize, onReady, probe, shoot };
}

export default function DeskCamera(p: DeskCameraProps) {
  const { width, height } = useWindowDimensions();
  const wide = width > height;
  const [permission, requestPermission] = useCameraPermissions();
  const s = useShutter(p.onCaptured, p.onError);
  const granted = permission?.granted === true;
  const auto = useAutoCapture({ enabled: p.auto && granted && s.ready && !p.sending, intervalMs: p.frameMs, probe: s.probe, onCapture: () => void s.shoot(), stateRef: p.autoState });

  const manual = () => {
    if (p.sending || s.shooting) return;
    if (p.auto) auto.markManual();
    void s.shoot();
  };
  const onSurface = () => (p.auto && auto.paused ? auto.resume() : manual());
  const retake = () => {
    p.onRetake();
    if (p.auto) auto.retake();
  };

  const camera = !permission ? (
    <ActivityIndicator color={colors.textOnDark} />
  ) : !granted ? (
    <View style={styles.center}>
      <Text style={styles.onDark}>Belge çekmek için kamera izni gerekiyor.</Text>
      <Button mode="contained" onPress={() => void withSystemDialog(() => requestPermission())}>
        Kamera izni ver
      </Button>
    </View>
  ) : (
    <>
      <CameraView ref={s.cameraRef} style={StyleSheet.absoluteFill} pictureSize={s.pictureSize} animateShutter={false} onCameraReady={() => void s.onReady()} />
      <Pressable style={StyleSheet.absoluteFill} onPress={onSurface} accessibilityLabel="Ekrana dokun: sayfayı çek" testID="masa-kamera-yuzey" />
    </>
  );

  return (
    <View style={[styles.root, wide ? styles.row : styles.col]} testID="belge-masasi-kamera">
      <View style={styles.cameraLayer}>{camera}</View>
      <SidePanel p={p} wide={wide} hint={p.auto ? auto.hint : null} shooting={s.shooting} canShoot={granted} onShoot={manual} onRetake={retake} onRecalibrate={p.auto ? auto.recalibrate : null} />
    </View>
  );
}

interface PanelProps {
  p: DeskCameraProps;
  wide: boolean;
  hint: string | null;
  shooting: boolean;
  canShoot: boolean;
  onShoot: () => void;
  onRetake: () => void;
  onRecalibrate: (() => void) | null;
}

function SidePanel({ p, wide, hint, shooting, canShoot, onShoot, onRetake, onRecalibrate }: PanelProps) {
  const n = p.pages.length;
  return (
    <View style={[styles.panel, wide ? styles.panelWide : styles.panelTall]}>
      <Text style={styles.status} testID="masa-durum">
        {n === 0 ? 'Belgeyi masaya koyun' : `${n} sayfa çekildi`}
      </Text>
      {hint ? <Text style={styles.hint} testID="masa-otomatik-ipucu">{`Otomatik (deneysel): ${hint}`}</Text> : null}
      <Button mode="contained" icon="camera" onPress={onShoot} loading={shooting} disabled={!canShoot || shooting || p.sending} contentStyle={styles.big} labelStyle={styles.bigLabel} testID="masa-okut">
        {n === 0 ? 'Okut' : 'Sayfa ekle'}
      </Button>
      {n > 0 && (
        <View style={styles.actions}>
          <Button mode="outlined" icon="camera-retake" onPress={onRetake} disabled={p.sending || shooting} contentStyle={styles.btn} style={styles.grow} testID="masa-tekrar-cek">
            Tekrar çek
          </Button>
          <Button mode="contained-tonal" icon="text-recognition" onPress={p.onRead} loading={p.sending} disabled={p.sending || shooting} contentStyle={styles.btn} style={styles.grow} testID="masa-oku">
            {`Oku (${n} sayfa)`}
          </Button>
        </View>
      )}
      {onRecalibrate && (
        <Button mode="text" onPress={onRecalibrate} testID="masa-yeniden-tani">
          Boş masayı yeniden tanı
        </Button>
      )}
      <RecentStrip recent={p.recent} />
    </View>
  );
}

/** Son oluşturulan iş emirleri — masa başındaki planlamacı neyi açtığını kameradan ayrılmadan görür. */
export function RecentStrip({ recent }: { recent: readonly RecentWo[] }) {
  if (recent.length === 0) return null;
  return (
    <View style={styles.recent} testID="masa-son-olusturulanlar">
      <Text style={styles.recentTitle}>Son oluşturulanlar</Text>
      {recent.map((r) => (
        <Text key={r.noteNo} style={styles.recentItem} numberOfLines={1}>
          {r.workOrderNos.length ? `${r.workOrderNos.join(', ')} · ${r.noteNo}` : `${r.noteNo} · taslak`}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.headerBg },
  row: { flexDirection: 'row' },
  col: { flexDirection: 'column' },
  cameraLayer: { flex: 1, position: 'relative', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  center: { gap: spacing.md, alignItems: 'center', padding: spacing.lg },
  onDark: { color: colors.textOnDark, fontSize: typography.size.base },
  panel: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.surface },
  panelWide: { width: 340 },
  panelTall: { borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md },
  status: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, color: colors.text },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary },
  big: { minHeight: 88 },
  bigLabel: { fontSize: typography.size.xl },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  grow: { flexGrow: 1, minWidth: 140 },
  btn: { minHeight: 56 },
  recent: { gap: spacing.xs, marginTop: spacing.sm },
  recentTitle: { fontSize: typography.size.sm, fontWeight: typography.weight.semibold, color: colors.textSecondary },
  recentItem: { fontSize: typography.size.base, color: colors.text },
});
