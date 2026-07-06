import { useEffect, useRef } from 'react';
import * as Print from 'expo-print';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { labelService } from '../services/label.service';
import { apiClient } from '../services/api';
import { peripheralService } from '../services/peripheral.service';
import { useSessionStore } from '../store/sessionStore';
import { isBtPrinterSupported, printRaw, ensurePrinterPaired } from '../services/btPrinter.service';
import type { Roll } from '../types/models';

interface Props {
  /** Etiketi basılacak top. null ise hiçbir şey yapılmaz. */
  roll: Roll | null;
  /** Etiket türü — KK1 → ROLL_RAW, Tambur → ROLL_FINISHED. Backend hangi
   *  default şablonun uygulanacağını belirler. */
  kind: 'ROLL_RAW' | 'ROLL_FINISHED';
  /** Baskı-anında müşteri bağlamı (gevşek model: top→sipariş bağı yok).
   *  orderLineId → tam sipariş + override; customerId → manuel müşteri;
   *  stock → explicit "Stok/müşterisiz" (backend müşteriyi zorla null bırakır,
   *  snapshot/WO tahminini atlar); hiçbiri yoksa doğal etiket (snapshot/WO). */
  labelContext?: { orderLineId?: string | null; customerId?: string | null; stock?: boolean };
  /** Print akışı bittiğinde (başarılı / hatalı) parent state'ini temizler. */
  onDone: () => void;
  /** Sonuç bildirimi (opsiyonel): ok=false + cancelled=false → GERÇEK hata —
   *  parent (KK1) topu "başarısızlar" listesine alıp Tekrar Dene sunar.
   *  İptal (expo-print diyaloğu kapatıldı) hata SAYILMAZ (cancelled=true). */
  onResult?: (r: { ok: boolean; cancelled: boolean; error?: string }) => void;
}

/**
 * Etiket basma — backend `/labels/rolls/:id/html` endpoint'inden hazır HTML
 * çeker, expo-print'e verir. Tüm render mantığı (barcode SVG, QR SVG, şablon
 * uygulama, alan visibility/label/bold) backend'de.
 *
 * "Mobil ile Electron'daki etiket farklı" sorunu yapısal olarak çözülür —
 * Electron LabelPreview de iframe ile aynı HTML'i tüketir.
 */
export function LabelPrinter({ roll, kind, labelContext, onDone, onResult }: Props) {
  const firedRef = useRef(false);

  // onDone parent'tan inline arrow gelebilir → effect deps'inden çıkarmak için
  // ref'le sabitliyoruz. Böylece print akışı yarıda re-tetiklenmez.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  // Async print akışı saniyeler sürer; bu sırada parent unmount olursa
  // onDone çağrısı ve Toast/Haptic side-effect'leri anlamsız → mounted bayrağı.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!roll) {
      firedRef.current = false;
      return;
    }
    if (!roll.barcode) {
      Toast.show({
        type: 'info',
        text1: 'Bu top için etiket basılamaz',
        text2: 'Açık kumaş (Kurşun/KK2 öncesi) fiziksel etiket almaz.',
      });
      onDoneRef.current();
      return;
    }
    if (firedRef.current) return;
    firedRef.current = true;

    (async () => {
      // Etiket NİYETİNİ (müşteri / stok / sipariş) fiziksel baskıdan BAĞIMSIZ
      // kalıcılaştır (seedSnapshot — LABEL_PRINTED audit YAZMAZ): yazıcı bağlı
      // olmasa, BT baskısı patlasa veya operatör diyaloğu iptal etse BİLE
      // operatörün "Kime?" seçimi topa (lastLabelSnapshot) yazılsın. Baskı
      // başarısı snapshot'ı KOŞULLAMAZ ("etiket geçerli olmuyor" bug'ı). Gerçek
      // baskı tamamlanınca AŞAĞIDA ayrıca recordPrintEvent (LABEL_PRINTED) atılır.
      // best-effort: hata baskı akışını engellemez.
      labelService.seedSnapshot(roll.id, labelContext).catch((e) => {
        console.warn('Etiket snapshot kaydı başarısız', (e as Error).message);
      });

      // Yazıcı OPERATÖR SEÇİMİ DEĞİL — aktif çalışma oturumunun YERİNE bağlı
      // BT yazıcı backend'den çözülür (for-session; fail-closed: oturum yoksa /
      // yerde SPP yazıcı tanımlı değilse BT yolu hiç denenmez). Oturumlu ekranlar
      // (KK1/Tambur) gate sayesinde her zaman oturumludur; gezici ekranlar (Depo)
      // doğal olarak HTML/expo-print'e düşer. NETWORK_TCP yazıcılar bu yoldan
      // BASILMAZ (backend print-native ayrı akış) — yalnız BLUETOOTH_SPP device-direct.
      let btPrinterAddr: string | null = null;
      if (isBtPrinterSupported() && useSessionStore.getState().active != null) {
        try {
          const printers = await peripheralService.getForSession('LABEL_PRINTER');
          const spp = printers.find(
            (p) => p.connectionType === 'BLUETOOTH_SPP' && !!p.address && !p.simulate,
          );
          btPrinterAddr = spp?.address ?? null;
        } catch {
          btPrinterAddr = null; // çözüm hatası → HTML yoluna düş (aşağıda)
        }
      }
      const viaBt = btPrinterAddr != null;
      // Yerde BT yazıcı tanımlıysa operatör DİYALOGSUZ baskı bekliyor (KK1 peş
      // peşe top akışı — "arada yazdırma ekranı çıkmasın"). Bu modda HTML/expo-print
      // diyaloğuna ASLA düşme: başarısızlık sessizce yazdırma ekranı açmak yerine
      // GÖRÜNÜR hata olsun. expo-print yalnız BT yazıcı YOKKEN devreye girer.
      const directOnly = viaBt;
      let usedBt = false;
      try {
        if (viaBt && btPrinterAddr) {
          // Cihazın diline göre native (PPLA/PPLB/ZPL) — kayıttaki yazıcı belirler
          // (backend resolveLabelRouting; cihaz kaydı yoksa RASTER_HTML → aşağıda
          // fail-closed). kind: KK1 ham / Tambur bitmiş paritesi.
          const native = await labelService.getRollNative(roll.id, kind, labelContext);
          // FAIL-CLOSED: yalnız bilinen native dil ham gönderilir. RASTER_HTML/boş/
          // bilinmeyen → diyaloğa düşmek yerine NET hata (akış ortasında yazdırma
          // ekranı çıkmasın; çöp etiket de basılmasın).
          if (!['PPLA', 'PPLB', 'ZPL'].includes(native.language) || !native.content) {
            throw new Error(
              'Yazıcının dili çözülemedi — Tanımlar → Donanım’da bu makinenin yazıcısını ve dilini kontrol edin.',
            );
          }
          // İlk baskıda otomatik eşleştir (bond yoksa) — Bluetooth ayarlarına girmeden.
          // Zaten eşleşikse no-op; değilse Android PIN'i bir kez sorar, sonra basar.
          await ensurePrinterPaired(btPrinterAddr);
          await printRaw(btPrinterAddr, native.content);
          usedBt = true;
        }
        if (!usedBt && !directOnly) {
          const r = await apiClient.get<string>(`/labels/rolls/${roll.id}/html`, {
            params: {
              kind,
              ...(labelContext?.orderLineId ? { orderLineId: labelContext.orderLineId } : {}),
              ...(labelContext?.customerId ? { customerId: labelContext.customerId } : {}),
              ...(labelContext?.stock ? { stock: "1" } : {}),
            },
            responseType: 'text',
            transformResponse: [(d) => d],
          });
          const html = String(r.data ?? '');
          if (!html.startsWith('<')) {
            throw new Error('Etiket HTML alınamadı');
          }
          // margins: 0 → expo-print default kenar payını sıfırlar. Aksi halde
          // HTML'deki @page { margin: 0 } iOS/Android WebKit print preview'a
          // tam yansımıyor, etiket sayfanın sol üst köşesinden 4-5mm aşağıda
          // başlıyor. Fiziksel yazıcı yine de küçük donanım payı bırakabilir.
          await Print.printAsync({
            html,
            margins: { left: 0, top: 0, right: 0, bottom: 0 },
          });
        }
        if (!mountedRef.current) return;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onResultRef.current?.({ ok: true, cancelled: false });
        // Niyet YUKARIDA seedSnapshot ile zaten kalıcı. Burada — yalnız GERÇEK
        // baskı tamamlandığında — LABEL_PRINTED audit'i düş (iptal/hata catch'e
        // gider, audit YAZILMAZ → "basıldı" yalanı olmaz). best-effort.
        labelService.recordPrintEvent(roll.id, labelContext).catch((e) => {
          console.warn('Baskı audit kaydı başarısız', (e as Error).message);
        });
      } catch (err) {
        if (!mountedRef.current) return;
        // expo-print iptal: kullanıcı yazdırma diyalogunu kapattı → hata değil,
        // info toast göster. "did not complete" expo-print'in iptal mesajı.
        const msg = (err as Error).message ?? '';
        // İptal yalnız expo-print (HTML) yolunda olur; BT'ye gittiyse her hata gerçek.
        const isCancel = !usedBt && /did not complete|cancel/i.test(msg);
        // TEŞHİS: gerçek hata mesajını logla + toast'ta göster — "Yazıcıya
        // gönderilemedi" altındaki asıl sebebi ayırt etmek için (fetch hatası mı,
        // Print.printAsync native hatası mı, eksik PrintSpooler mı). Kök neden
        // bulununca bu satır kaldırılacak.
        console.warn('[LabelPrinter] print failed:', msg, err);
        onResultRef.current?.({ ok: false, cancelled: isCancel, error: msg });
        void Haptics.notificationAsync(
          isCancel
            ? Haptics.NotificationFeedbackType.Warning
            : Haptics.NotificationFeedbackType.Error,
        );
        Toast.show({
          type: isCancel ? 'info' : 'error',
          text1: isCancel ? 'Yazdırma iptal edildi' : 'Yazdırma hatası',
          text2: isCancel ? 'Etiket basılmadı' : msg || 'Yazıcıya gönderilemedi',
          visibilityTime: isCancel ? 3000 : 8000,
        });
      } finally {
        if (mountedRef.current) onDoneRef.current();
      }
    })();
  }, [roll, kind, labelContext]);

  return null;
}
