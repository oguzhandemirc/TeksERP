import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Print from 'expo-print';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { buildRollLabelHtml } from '../utils/labelHtml';
import { labelService } from '../services/label.service';
import type { Roll } from '../types/models';

interface Props {
  /** Etiketi basılacak top. null ise hiçbir şey yapılmaz. */
  roll: Roll | null;
  /** Top WO'ya bağlı ise üst başlıkta gösterilecek parti no (opsiyonel). */
  batchNumber?: string | null;
  /** Print akışı bittiğinde (başarılı / hatalı) parent state'ini temizler. */
  onDone: () => void;
}

/**
 * "Headless" yazdırma bileşeni — top etiketi A4 PDF olarak basar.
 *
 * Akış:
 *   1. Off-screen QRCode component mount edilir
 *   2. toDataURL → base64 PNG
 *   3. HTML template'i üret
 *   4. Print.printAsync → sistem print dialog'u (Save as PDF / paylaş)
 *
 * Parent: `<LabelPrinter roll={pending} onDone={() => setPending(null)} />`
 * pending=null → render edilmez.
 */
export function LabelPrinter({ roll, batchNumber, onDone }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qrRef = useRef<any>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!roll) {
      firedRef.current = false;
      return;
    }
    if (!roll.barcode) {
      // Açık kumaş Roll'lar (barkodsuz) için etiket basılmaz.
      Toast.show({
        type: 'info',
        text1: 'Bu top için etiket basılamaz',
        text2: 'Açık kumaş (Kurşun/KK2 öncesi) fiziksel etiket almaz.',
      });
      onDone();
      return;
    }
    if (firedRef.current) return;
    // QR component'in mount olup ref'i set etmesi için kısa bir tick bekle.
    const t = setTimeout(() => {
      if (!qrRef.current) {
        Toast.show({ type: 'error', text1: 'QR oluşturulamadı' });
        onDone();
        return;
      }
      firedRef.current = true;
      qrRef.current.toDataURL(async (base64: string) => {
        try {
          const html = buildRollLabelHtml({
            roll,
            qrDataUrl: `data:image/png;base64,${base64}`,
            batchNumber,
          });
          await Print.printAsync({ html });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          // Refactor 6 — audit izi (label:print yetkisi backend'de zorlanır).
          // Hata baskı akışını engellemez — sessiz log.
          labelService.recordPrintEvent(roll.id).catch((e) => {
            console.warn('Print audit failed', (e as Error).message);
          });
        } catch (err) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Toast.show({
            type: 'error',
            text1: 'Yazdırma hatası',
            text2: (err as Error).message,
          });
        } finally {
          onDone();
        }
      });
    }, 80);
    return () => clearTimeout(t);
  }, [roll, batchNumber, onDone]);

  if (!roll || !roll.barcode) return null;

  return (
    <View
      style={{ position: 'absolute', left: -10000, top: -10000, opacity: 0 }}
      pointerEvents="none"
    >
      <QRCode value={roll.barcode} size={400} ecl="M" getRef={(c) => (qrRef.current = c)} />
    </View>
  );
}
