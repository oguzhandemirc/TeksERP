import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors, palette } from '../theme/tokens';
import { springs } from '../theme/motion';
import { recordActivity, withSystemDialog } from '../store/lockStore';

export type SupportedBarcodeType =
  | 'qr'
  | 'code128'
  | 'ean13'
  | 'ean8'
  | 'code39'
  | 'code93'
  | 'codabar'
  | 'datamatrix'
  | 'pdf417'
  | 'aztec'
  | 'itf14'
  | 'upc_e'
  | 'upc_a';

interface Props {
  /** Mount/unmount tetiği — false ise CameraView kapanır (pil/CPU). */
  active: boolean;
  onScan: (barcode: string) => void;
  /** Close butonu — çağıran bileşene "scanner'ı kapat" sinyali. Yoksa header
   *  butonu render edilmez (kullanan akış kendi kapanışını yönetir). */
  onClose?: () => void;
  title?: string;
  barcodeTypes?: SupportedBarcodeType[];
  /**
   * Sürekli okuma — modal açık kalıp arka arkaya çok top okutan akışlar için
   * (Top Ekle / Hızlı Okut). Her okumadan sonra scanner kısa gecikmeyle yeniden
   * silahlanır; aynı barkod kadrajda kaldığı sürece tekrar işlenmez. Default
   * false = tek-okuma (okuyup modalı kapatan Tambur/KK1/Fason akışları aynen kalır).
   */
  continuous?: boolean;
  /** Başlık altında vurgulu uyarı bandı (örn. "Taradığın toplar otomatik ilk çuvala eklenir"). */
  notice?: string;
  /** Canlı karşılama sayacı (metre): okutulan / istenen. Fazla okutulursa gerçek
   *  rakam gösterilir — kısıtlama/üst sınır yok. */
  counter?: { scanned: number; expected: number };
  /**
   * Yakalama anında "başarı" haptiği verilsin mi (default true). Tek-okuma akışları
   * (KK1/Tambur/Fason) için doğru: tek geri bildirim budur. Ama çağıran kendi
   * kabul/ret titreşimini veriyorsa (örn. Hızlı İş Emri: okunan top STOCK mu, aynı
   * ürün mü diye doğrular) `false` geç → yakalamada "başarı" + sonra "uyarı" çift
   * titreşimi olmasın. Çağıran isterse yakalama anında kendi hafif tık'ını verir.
   */
  captureHaptic?: boolean;
  /** Kameranın başlangıç yönü — 'back' (arka, default) / 'front' (ön). Sabit
   *  duran tablette QR'ı önden okutmak için kilit ekranı 'front' geçer; sağ-üst
   *  flip butonuyla her zaman değiştirilebilir. */
  initialFacing?: 'front' | 'back';
}

// Sürekli modda iki okuma arası yeniden silahlanma gecikmesi (ms).
const REARM_MS = 1400;

const FRAME = 260;
const LINE_H = 3;

// Karşılama sayacı metresi — gerçek değeri göster (44,5 → "44,5"), gereksiz sıfır yok.
const fmtM = (m: number) => m.toLocaleString('tr-TR', { maximumFractionDigits: 2 });

/**
 * BarcodeScannerModal'ın RNModal sarmasız varyantı — başka modal'ların İÇİNDE
 * kullanılabilir. Nested RNModal sorunu (RN'de iki RNModal aynı anda render
 * edilmez) bu component'le aşılır.
 *
 * Görsel: animasyonlu köşe parantezleri + süpüren tarama çizgisi (Reanimated,
 * UI thread). Okuma yakalandığında çerçeve yeşile döner ve yaylı bir onay
 * işareti açılır — operatöre "okundu" hissi net verilir. `useReducedMotion`
 * aktifse hareketler sabit/yumuşatılmış gösterilir.
 */
export function BarcodeScannerView({
  active,
  onScan,
  onClose,
  title = 'Barkod / QR Okut',
  barcodeTypes = ['qr', 'code128'],
  continuous = false,
  notice,
  counter,
  captureHaptic = true,
  initialFacing = 'back',
}: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [facing, setFacing] = useState<'front' | 'back'>(initialFacing);
  const reduced = useReducedMotion();

  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  // Stable handleScanned içinden güncel continuous'a erişim için ref.
  const continuousRef = useRef(continuous);
  useEffect(() => {
    continuousRef.current = continuous;
  }, [continuous]);
  // Aynı şekilde captureHaptic'i stable callback içinden oku.
  const captureHapticRef = useRef(captureHaptic);
  useEffect(() => {
    captureHapticRef.current = captureHaptic;
  }, [captureHaptic]);
  // Sürekli modda aynı barkodu üst üste işlememek için son okunan kod.
  const lastScanRef = useRef<string | null>(null);

  useEffect(() => {
    if (active) {
      scannedRef.current = false;
      setBusy(false);
      lastScanRef.current = null;
    }
  }, [active]);

  const handleScanned = useCallback(({ data }: { data: string }) => {
    if (!data || scannedRef.current) return;
    // Sürekli modda: aynı top hâlâ kadrajdaysa tekrar ekleme.
    if (continuousRef.current && lastScanRef.current === data) return;
    // Kamera okutması dokunma responder'ına girmez — özellikle continuous
    // modda operatör dakikalarca dokunmadan okutur; idle kilidi iş ortasında
    // kilitlemesin diye okutma da aktivite sayılır.
    recordActivity();
    scannedRef.current = true;
    lastScanRef.current = data;
    setBusy(true);
    if (captureHapticRef.current) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setTimeout(() => onScanRef.current(data), 180);
    // Sürekli modda kısa gecikmeyle yeniden silahlan (modal açık kalır).
    if (continuousRef.current) {
      setTimeout(() => {
        scannedRef.current = false;
        setBusy(false);
      }, REARM_MS);
    }
  }, []);

  const scanning = active && !!permission?.granted && !busy;

  // Tarama çizgisi — çerçeve içinde yukarı/aşağı süpürür.
  const scanY = useSharedValue(0);
  useEffect(() => {
    if (scanning && !reduced) {
      scanY.value = 0;
      scanY.value = withRepeat(
        withTiming(FRAME - LINE_H, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(scanY);
    }
    return () => cancelAnimation(scanY);
  }, [scanning, reduced, scanY]);
  const scanLineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: scanY.value }],
  }));

  // Köşe parantezleri — tararken hafif nefes alır.
  const cornerP = useSharedValue(0);
  useEffect(() => {
    if (scanning && !reduced) {
      cornerP.value = withRepeat(
        withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(cornerP);
      cornerP.value = 0;
    }
    return () => cancelAnimation(cornerP);
  }, [scanning, reduced, cornerP]);
  const cornersStyle = useAnimatedStyle(() => ({
    opacity: 0.65 + cornerP.value * 0.35,
  }));

  // Yakalama onayı — çerçeve yeşil + yaylı check.
  const successV = useSharedValue(0);
  useEffect(() => {
    if (busy) {
      successV.value = 0;
      successV.value = reduced
        ? withTiming(1, { duration: 160 })
        : withSpring(1, springs.bouncy);
    } else {
      successV.value = 0;
    }
  }, [busy, reduced, successV]);
  const successCheckStyle = useAnimatedStyle(() => ({
    opacity: successV.value,
    transform: [{ scale: 0.5 + successV.value * 0.5 }],
  }));
  const successTintStyle = useAnimatedStyle(() => ({
    opacity: successV.value * 0.16,
  }));

  const cornerColor = busy ? colors.success : '#fff';
  const over = !!counter && counter.scanned > counter.expected;

  const body = !permission ? (
    <View style={styles.center}>
      <MaterialCommunityIcons name="camera" size={40} color={colors.textOnDarkMuted} />
    </View>
  ) : !permission.granted ? (
    <View style={styles.center}>
      <MaterialCommunityIcons name="camera-off" size={44} color={colors.textOnDarkMuted} />
      <Text variant="titleMedium" style={styles.permTitle}>
        Kamera izni gerekli
      </Text>
      <Text style={styles.permBody}>
        QR / barkod okumak için kamera erişimini onaylayın.
      </Text>
      {/* withSystemDialog: izin diyaloğu activity'yi pause eder → AppState
          'background' → idle kilidi anında kilitlerdi; sarma bunu bastırır. */}
      <Button
        mode="contained"
        onPress={() => void withSystemDialog(() => requestPermission())}
        style={{ marginTop: 16 }}
      >
        İzin Ver
      </Button>
    </View>
  ) : active ? (
    <View style={styles.cameraWrap}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing={facing}
        barcodeScannerSettings={{ barcodeTypes }}
        onBarcodeScanned={busy ? undefined : handleScanned}
      />
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.frame}>
          {/* Yakalamada yeşil flaş */}
          <Animated.View
            style={[styles.successTint, successTintStyle]}
          />
          {/* Köşe parantezleri */}
          <Animated.View style={[StyleSheet.absoluteFill, cornersStyle]}>
            <View style={[styles.corner, styles.cornerTL, { borderColor: cornerColor }]} />
            <View style={[styles.corner, styles.cornerTR, { borderColor: cornerColor }]} />
            <View style={[styles.corner, styles.cornerBL, { borderColor: cornerColor }]} />
            <View style={[styles.corner, styles.cornerBR, { borderColor: cornerColor }]} />
          </Animated.View>
          {/* Süpüren tarama çizgisi */}
          {scanning && (
            <Animated.View style={[styles.scanLine, scanLineStyle]} />
          )}
          {/* Yakalama onay işareti */}
          {busy && (
            <Animated.View style={[styles.successCheck, successCheckStyle]}>
              <MaterialCommunityIcons name="check-bold" size={56} color="#fff" />
            </Animated.View>
          )}
        </View>
        <Text style={styles.overlayHint}>
          {busy ? 'Okundu' : "QR'ı çerçeve içine alın · otomatik okunur"}
        </Text>
      </View>
      {/* Ön/arka kamera değiştir — sabit tablette QR'ı önden okutmak için. */}
      <IconButton
        icon="camera-flip"
        size={24}
        iconColor="#fff"
        onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
        style={styles.flipBtn}
        accessibilityLabel="Ön/arka kamera değiştir"
      />
    </View>
  ) : (
    <View style={styles.center} />
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text variant="titleMedium" style={styles.title}>
          {title}
        </Text>
        <View style={{ flex: 1 }} />
        {onClose && (
          <IconButton
            icon="close"
            size={22}
            iconColor="#fff"
            onPress={onClose}
            style={{ margin: 0 }}
          />
        )}
      </View>
      {notice ? (
        <View style={styles.notice}>
          <MaterialCommunityIcons name="alert-circle" size={16} color={palette.amber[500]} />
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}
      {counter ? (
        <View style={styles.counter}>
          <MaterialCommunityIcons name="ruler" size={16} color={colors.textOnDarkMuted} />
          <Text style={styles.counterLabel}> okutulan </Text>
          <Text style={[styles.counterValue, over && styles.counterValueOver]}>{fmtM(counter.scanned)}</Text>
          <Text style={styles.counterLabel}> / istenen </Text>
          <Text style={styles.counterValue}>{fmtM(counter.expected)}</Text>
          <Text style={styles.counterLabel}> m</Text>
          {over ? (
            <Text style={styles.counterOver}>+{fmtM(counter.scanned - counter.expected)} fazla</Text>
          ) : null}
        </View>
      ) : null}
      {body}
    </View>
  );
}

const CORNER = 36;
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.headerBg, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: '#1e293b',
  },
  title: { color: '#fff', fontWeight: '700' },
  // Uyarı bandı (başlık altı) — "toplar otomatik ilk çuvala eklenir".
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(245,158,11,0.16)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(245,158,11,0.4)',
  },
  noticeText: { flex: 1, color: palette.amber[100], fontSize: 13, fontWeight: '600' },
  // Canlı karşılama sayacı (metre) — okutulan / istenen, fazlada amber.
  counter: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#1e293b',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#334155',
  },
  counterLabel: { color: colors.textOnDarkMuted, fontSize: 13, fontWeight: '600' },
  counterValue: { color: '#fff', fontSize: 18, fontWeight: '800' },
  counterValueOver: { color: palette.amber[500] },
  counterOver: {
    marginLeft: 8,
    color: palette.amber[500],
    fontSize: 12,
    fontWeight: '800',
    backgroundColor: 'rgba(245,158,11,0.18)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 8 },
  permTitle: { color: '#fff', fontWeight: '700' },
  permBody: { color: colors.textOnDarkMuted, textAlign: 'center' },
  // overflow: 'hidden' — Android'de CameraView native önizleme yüzeyi parent'tan
  // daha geniş render edip yuvarlak sayfanın dışına taşabiliyor (kamera başlıktan
  // geniş görünüyor). Sert kırpma önizlemeyi sayfa genişliğine sabitler.
  cameraWrap: { flex: 1, backgroundColor: '#000', position: 'relative', overflow: 'hidden' },
  flipBtn: { position: 'absolute', top: 6, right: 6, margin: 0, backgroundColor: 'rgba(15,23,42,0.55)' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },
  frame: {
    width: FRAME,
    height: FRAME,
    position: 'relative',
  },
  successTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.success,
    borderRadius: 16,
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 16 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 16 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 16 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 16 },
  scanLine: {
    position: 'absolute',
    left: 6,
    right: 6,
    height: LINE_H,
    borderRadius: LINE_H,
    backgroundColor: colors.success,
    shadowColor: colors.success,
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  successCheck: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayHint: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    overflow: 'hidden',
  },
});
