import { useEffect, useRef } from 'react';
import * as Print from 'expo-print';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { labelService } from '../services/label.service';
import { apiClient } from '../services/api';
import { useBtPrinterStore } from '../store/btPrinterStore';
import { isBtPrinterSupported, printRaw } from '../services/btPrinter.service';
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
}

/**
 * Etiket basma — backend `/labels/rolls/:id/html` endpoint'inden hazır HTML
 * çeker, expo-print'e verir. Tüm render mantığı (barcode SVG, QR SVG, şablon
 * uygulama, alan visibility/label/bold) backend'de.
 *
 * "Mobil ile Electron'daki etiket farklı" sorunu yapısal olarak çözülür —
 * Electron LabelPreview de iframe ile aynı HTML'i tüketir.
 */
export function LabelPrinter({ roll, kind, labelContext, onDone }: Props) {
  const firedRef = useRef(false);

  // onDone parent'tan inline arrow gelebilir → effect deps'inden çıkarmak için
  // ref'le sabitliyoruz. Böylece print akışı yarıda re-tetiklenmez.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

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

      // BT yazıcı seçili + bu derlemede destekleniyorsa PPLA→Bluetooth; yoksa
      // HTML→expo-print (OS yazıcı diyaloğu / PDF). Seçimi fire anında okuruz
      // (effect deps'i şişirmemek için getState).
      const btPrinter = useBtPrinterStore.getState().printer;
      const viaBt = btPrinter != null && isBtPrinterSupported();
      let usedBt = false;
      try {
        if (viaBt && btPrinter) {
          // Cihazın diline göre native (PPLA/PPLB/ZPL) — kayıttaki yazıcı belirler
          // (backend resolveLabelRouting; cihaz kaydı yoksa global/model). kind:
          // KK1 ham / Tambur bitmiş paritesi.
          const native = await labelService.getRollNative(roll.id, kind, labelContext);
          if (native.language !== 'RASTER_HTML' && native.content) {
            await printRaw(btPrinter.address, native.content);
            usedBt = true;
          }
          // Cihaz dili RASTER_HTML (native tanımsız) → ham gönderilemez; HTML'e düş.
        }
        if (!usedBt) {
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
