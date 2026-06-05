import { useEffect, useRef } from 'react';
import * as Print from 'expo-print';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { labelService } from '../services/label.service';
import { apiClient } from '../services/api';
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
      try {
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
        if (!mountedRef.current) return;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Audit izi — başarısızlığı baskı akışını engellemez.
        labelService.recordPrintEvent(roll.id, labelContext).catch((e) => {
          console.warn('Print audit failed', (e as Error).message);
        });
      } catch (err) {
        if (!mountedRef.current) return;
        // expo-print iptal: kullanıcı yazdırma diyalogunu kapattı → hata değil,
        // info toast göster. "did not complete" expo-print'in iptal mesajı.
        const msg = (err as Error).message ?? '';
        const isCancel = /did not complete|cancel/i.test(msg);
        void Haptics.notificationAsync(
          isCancel
            ? Haptics.NotificationFeedbackType.Warning
            : Haptics.NotificationFeedbackType.Error,
        );
        Toast.show({
          type: isCancel ? 'info' : 'error',
          text1: isCancel ? 'Yazdırma iptal edildi' : 'Yazdırma hatası',
          text2: isCancel ? 'Etiket basılmadı' : 'Yazıcıya gönderilemedi',
        });
      } finally {
        if (mountedRef.current) onDoneRef.current();
      }
    })();
  }, [roll, kind, labelContext]);

  return null;
}
