import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, IconButton, Text, TouchableRipple } from 'react-native-paper';
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

/**
 * Kadrajın ORTASINDA kısa süre duran büyük bildirim.
 *
 * Saha gerekçesi (2026-08-06): mükerrer okumada tek görsel iz ALTTAKİ şeritte
 * yanıp sönen satırdı. Operatör telefonu topa doğrultmuş, gözü kadrajın
 * içindedir — şerit görüş alanının dışında kalıyor ve "okumadı" sanıp tekrar
 * okutuyordu (sesi/titreşimi gürültülü ortamda ayırt edemeyen vardiya için de
 * tek hat kalmıştı). Bildirim tam da bakılan yere basılır.
 *
 * İki tür var ve ikisi de kullanımda: `duplicate` (zaten listede) ve `reject`
 * (kabul edilmedi — sebebiyle). Kabul için tür YOK: onu kadrajın kendi yeşil
 * tiki + şerit satırı zaten söylüyor.
 */
export interface ScanFlash {
  kind: 'duplicate' | 'reject';
  /** Büyük satır — tek bakışta okunacak olan ("ZATEN OKUTULDU"). */
  title: string;
  /** İnce satır — barkod / sebep. */
  detail?: string;
  /**
   * Aynı olay tekrar ederse (aynı barkod peş peşe okutulursa) nesne kimliği
   * değişsin diye artan sayaç — giriş animasyonu yeniden oynar. Sayaç olmadan
   * ikinci okutma state'i aynı bıraktığı için ekranda HİÇBİR ŞEY değişmezdi.
   */
  seq?: number;
}

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
  /**
   * Okuma tetikleyicisi.
   *
   * `'auto'` (default) — kamera kadrajdaki her barkodu kendiliğinden okur.
   * `'tap'` — **dokunarak okut**: kamera SİLAHSIZ açılır, yalnız operatör
   * "OKUT" tuşuna bastıktan sonra tek bir okuma yapar ve hemen tekrar silahsız
   * kalır. Saha gerekçesi (2026-08-05, Hızlı İş Emri): operatör telefonu top
   * yığınının üzerinde gezdirirken kadraja giren KOMŞU topların barkodları da
   * okunup iş emrine ekleniyordu. Sorun "yanlış okuma" değil "istenmeden
   * okuma"dır; onay sorarak değil **taramayı kapatarak** çözülür — gezinme
   * sırasında okuyacak bir tarayıcı olmaz.
   */
  trigger?: 'auto' | 'tap';
  /**
   * Kadrajın ortasında kısa süre duran bildirim (mükerrer / ret). Süresini
   * ÇAĞIRAN yönetir (bkz. `hooks/useScanFeedback`): tarayıcı okumanın sonucunu
   * bilmez, onu çözen taraf bilir. `null`/verilmemişse hiçbir şey çizilmez ve
   * bu bileşenin bugünkü çıktısı birebir korunur.
   */
  flash?: ScanFlash | null;
}

// Sürekli modda iki okuma arası yeniden silahlanma gecikmesi (ms).
const REARM_MS = 1400;
// Dokunarak okut: "OKUT"a basıldıktan sonra tarayıcının açık kalacağı süre.
// Süre dolarsa kendiliğinden silahsız kalır — operatör tuşa basıp topu bulamadan
// vazgeçtiyse tarayıcı arkada açık kalmamalı (aynı sorun geri gelir).
const TAP_ARM_MS = 8000;
// Dokunarak okut: yakalama onayının (yeşil tik) ekranda kalma süresi.
const TAP_FEEDBACK_MS = 1200;

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
  trigger = 'auto',
  flash = null,
}: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [facing, setFacing] = useState<'front' | 'back'>(initialFacing);
  // Fener — endüstriyel el terminallerinin hepsinde aydınlatma vardır ve sebebi
  // fizik: karanlık koridorda / topun gölgede kalan ucunda kamera odaklanamaz.
  // Oturum ömürlü (cihazda saklanmaz): ışık ihtiyacı okutulan YERE bağlıdır,
  // cihaza değil — açık unutulan fener pili boşuna tüketir.
  const [torch, setTorch] = useState(false);
  const reduced = useReducedMotion();
  // Sürekli modda aynı barkodu üst üste işlememek için son okunan kod.
  const lastScanRef = useRef<string | null>(null);

  // ── Dokunarak okut ────────────────────────────────────────────────────────
  // `armed` yalnız tap modunda anlamlıdır; auto modda hep true kabul edilir ve
  // aşağıdaki dallar bugünkü davranışı bayt-bayt korur.
  const tapMode = trigger === 'tap';
  // handleScanned stable ([] deps) — güncel modu ref'ten okur (continuousRef deseni).
  const tapModeRef = useRef(tapMode);
  useEffect(() => {
    tapModeRef.current = tapMode;
  }, [tapMode]);
  const [armed, setArmed] = useState(false);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [armExpired, setArmExpired] = useState(false);
  const clearArmTimer = () => {
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
  };
  const disarm = useCallback(() => {
    clearArmTimer();
    setArmed(false);
  }, []);
  const arm = useCallback(() => {
    clearArmTimer();
    // Yeniden silahlanma okuma kilidini de açar: `scannedRef` tek-okuma
    // bekçisidir, tap modunda onu açan tek şey bu tuştur.
    scannedRef.current = false;
    setBusy(false);
    lastScanRef.current = null;
    setArmExpired(false);
    setArmed(true);
    recordActivity();
    armTimerRef.current = setTimeout(() => {
      armTimerRef.current = null;
      setArmed(false);
      setArmExpired(true);
    }, TAP_ARM_MS);
  }, []);
  useEffect(() => clearArmTimer, []);

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

  useEffect(() => {
    if (active) {
      scannedRef.current = false;
      setBusy(false);
      lastScanRef.current = null;
    }
    // Tarayıcı kapanınca/açılınca tap modu daima SİLAHSIZ başlar — modal
    // yeniden açıldığında önceki oturumdan kalan silahlı hâl "açar açmaz
    // okudu" sürprizini geri getirirdi.
    clearArmTimer();
    setArmed(false);
    setArmExpired(false);
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
    // Tap modunda OTOMATİK yeniden silahlanma YOK — bir dokunuş bir okumadır.
    // (Zamanlayıcıyla silahlansaydı "gezdirirken okuyor" sorunu 1,4 sn'lik bir
    // pencereyle aynen geri gelirdi.) Silahlanmayı yalnız "OKUT" tuşu yapar.
    if (tapModeRef.current) {
      clearArmTimer();
      setArmed(false);
      // Yakalama onayı KISA sürer: kalıcı yeşil tik, çağıran topu reddetse bile
      // (farklı ürün / stokta değil) "eklendi" izlenimi verirdi. Yakalamanın
      // sonucunu söyleyen yer tarayıcı değil, çağıranın listesi/toast'ıdır.
      setTimeout(() => setBusy(false), TAP_FEEDBACK_MS);
      return;
    }
    // Sürekli modda kısa gecikmeyle yeniden silahlan (modal açık kalır).
    if (continuousRef.current) {
      setTimeout(() => {
        scannedRef.current = false;
        setBusy(false);
      }, REARM_MS);
    }
  }, []);

  // Tap modunda tarama yalnız silahlıyken canlıdır.
  const live = !tapMode || armed;
  const scanning = active && !!permission?.granted && !busy && live;

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
  // ⚠️ Bildirim varken BASTIRILIR: yakalama onayı (yeşil tik) okumanın SONUCUNU
  // değil yalnız "kod yakalandı"yı söyler; mükerrer bildiriminin arkasında yeşil
  // tik yanarsa operatör iki zıt işaret görür ve topu eklenmiş sanar.
  const successV = useSharedValue(0);
  const showSuccess = busy && !flash;
  useEffect(() => {
    if (showSuccess) {
      successV.value = 0;
      successV.value = reduced
        ? withTiming(1, { duration: 160 })
        : withSpring(1, springs.bouncy);
    } else {
      successV.value = 0;
    }
  }, [showSuccess, reduced, successV]);
  const successCheckStyle = useAnimatedStyle(() => ({
    opacity: successV.value,
    transform: [{ scale: 0.5 + successV.value * 0.5 }],
  }));
  const successTintStyle = useAnimatedStyle(() => ({
    opacity: successV.value * 0.16,
  }));

  // Merkez bildirim — her yeni olayda (nesne kimliği değişir) yeniden açılır.
  const flashV = useSharedValue(0);
  useEffect(() => {
    if (flash) {
      flashV.value = 0;
      flashV.value = reduced ? withTiming(1, { duration: 140 }) : withSpring(1, springs.bouncy);
    } else {
      flashV.value = withTiming(0, { duration: 140 });
    }
  }, [flash, reduced, flashV]);
  const flashStyle = useAnimatedStyle(() => ({
    opacity: flashV.value,
    transform: [{ scale: 0.82 + flashV.value * 0.18 }],
  }));

  // Tap modunda silahsızken köşeler sönük — "şu an okumuyorum" durumu kadrajın
  // kendisinden okunmalı, yalnız alttaki tuşun yazısından değil.
  const cornerColor = busy ? colors.success : live ? '#fff' : 'rgba(255,255,255,0.35)';
  const over = !!counter && counter.scanned > counter.expected;

  const overlayHint = busy
    ? 'Okundu'
    : tapMode
      ? armed
        ? 'Topu çerçeveye alın'
        : armExpired
          ? 'Okunamadı — tekrar OKUT’a basın'
          : 'OKUT’a basınca tek top okunur'
      : "QR'ı çerçeve içine alın · otomatik okunur";

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
        // Ön kamerada fener yok — açık kalırsa arkaya dönüldüğünde beklenmedik
        // şekilde yanar. Yön değişince sönmesi yerine burada bastırılır ki
        // operatör geri döndüğünde tuş hâlâ "açık" dediği şeyi yapsın.
        enableTorch={torch && facing === 'back'}
        barcodeScannerSettings={{ barcodeTypes }}
        // Tap modunda silahsızken handler HİÇ bağlanmaz — "okuyup atmak"
        // değil, taramayı kapatmak. Kadrajdan geçen komşu top hiç işlenmez.
        onBarcodeScanned={busy || !live ? undefined : handleScanned}
      />
      {/* paddingBottom: ortalanan kadraj + ipucu, alttaki OKUT tuşunun altına
          girmesin (tuş absolute, layout'a yer açmaz). */}
      <View style={[styles.overlay, tapMode && styles.overlayTapMode]} pointerEvents="none">
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
          {showSuccess && (
            <Animated.View style={[styles.successCheck, successCheckStyle]} testID="scan-success-check">
              <MaterialCommunityIcons name="check-bold" size={56} color="#fff" />
            </Animated.View>
          )}
        </View>
        {/* İpucu bildirim varken susar — kartın altında "Okundu" yazması,
            "zaten okutuldu" mesajıyla çelişirdi. */}
        {flash ? null : <Text style={styles.overlayHint}>{overlayHint}</Text>}
      </View>
      {/* Merkez bildirim — operatörün BAKTIĞI yere basılır. pointerEvents="none":
          altındaki OKUT tuşunu yutmamalı (bildirim 1-2 sn duruyor ve operatör o
          sırada sıradaki topu okutmak isteyebilir). */}
      {flash ? (
        <View style={styles.flashLayer} pointerEvents="none" testID="scan-flash">
          <Animated.View
            style={[
              styles.flashCard,
              flash.kind === 'duplicate' ? styles.flashDuplicate : styles.flashReject,
              flashStyle,
            ]}
          >
            <MaterialCommunityIcons
              name={flash.kind === 'duplicate' ? 'content-duplicate' : 'close-octagon'}
              size={42}
              color="#fff"
            />
            <Text style={styles.flashTitle}>{flash.title}</Text>
            {flash.detail ? (
              <Text style={styles.flashDetail} numberOfLines={2}>
                {flash.detail}
              </Text>
            ) : null}
          </Animated.View>
        </View>
      ) : null}
      {/* Dokunarak okut — kadrajın altında, tek büyük hedef (≥56dp). Overlay
          `pointerEvents="none"` olduğu için tuş onun DIŞINDA durmak zorunda. */}
      {tapMode ? (
        <View style={styles.tapBar} pointerEvents="box-none">
          <TouchableRipple
            onPress={armed ? disarm : arm}
            style={[styles.tapBtn, armed && styles.tapBtnArmed]}
            rippleColor="rgba(255,255,255,0.25)"
            accessibilityLabel={armed ? 'Okumayı iptal et' : 'Topu okut'}
            borderless
          >
            <View style={styles.tapBtnInner}>
              <MaterialCommunityIcons
                name={armed ? 'close' : 'barcode-scan'}
                size={26}
                color="#fff"
              />
              <Text style={styles.tapBtnText}>{armed ? 'İPTAL' : 'OKUT'}</Text>
            </View>
          </TouchableRipple>
        </View>
      ) : null}
      {/* Sağ üstte iki tuş: fener + ön/arka. Fener yalnız arka kamerada anlamlı
          olduğu için ön kameradayken çizilmez (çalışmayan tuş göstermek yerine). */}
      <View style={styles.cornerBtns}>
        {facing === 'back' ? (
          <IconButton
            icon={torch ? 'flashlight' : 'flashlight-off'}
            size={24}
            iconColor={torch ? palette.amber[500] : '#fff'}
            onPress={() => setTorch((t) => !t)}
            style={styles.cornerBtn}
            accessibilityLabel={torch ? 'Feneri kapat' : 'Feneri aç'}
          />
        ) : null}
        <IconButton
          icon="camera-flip"
          size={24}
          iconColor="#fff"
          onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
          style={styles.cornerBtn}
          accessibilityLabel="Ön/arka kamera değiştir"
        />
      </View>
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
  cornerBtns: { position: 'absolute', top: 6, right: 6, flexDirection: 'row', gap: 4 },
  cornerBtn: { margin: 0, backgroundColor: 'rgba(15,23,42,0.55)' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },
  overlayTapMode: { paddingBottom: 84 },
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
  // Dokunarak okut tuşu — kadrajın altında, kameranın üstünde.
  tapBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 14,
    alignItems: 'center',
  },
  tapBtn: {
    minHeight: 56,
    minWidth: 170,
    borderRadius: 28,
    backgroundColor: colors.brand,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    elevation: 6,
  },
  tapBtnArmed: { backgroundColor: palette.slate[700] },
  tapBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 26,
    paddingVertical: 14,
  },
  tapBtnText: { color: '#fff', fontSize: 19, fontWeight: '800', letterSpacing: 0.5 },
  // Merkez bildirim — kadrajın üstünde, tam ortada.
  flashLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  flashCard: {
    alignItems: 'center',
    gap: 6,
    maxWidth: '94%',
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderRadius: 18,
    borderWidth: 2,
    elevation: 8,
  },
  // Mükerrer amber, ret kırmızı — şeritteki satır renkleriyle AYNI dil
  // (ScannerRollStrip.rowDuplicate / rowReject); iki yüzey aynı olayı farklı
  // renkle anlatırsa operatör hangisinin doğru olduğunu sorar.
  flashDuplicate: { backgroundColor: 'rgba(180,83,9,0.95)', borderColor: palette.amber[500] },
  flashReject: { backgroundColor: 'rgba(153,27,27,0.95)', borderColor: palette.red[500] },
  flashTitle: { color: '#fff', fontSize: 21, fontWeight: '800', letterSpacing: 0.5, textAlign: 'center' },
  flashDetail: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
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
