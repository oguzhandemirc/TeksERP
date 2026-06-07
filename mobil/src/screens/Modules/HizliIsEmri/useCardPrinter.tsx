import React, { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Print from 'expo-print';
import Toast from 'react-native-toast-message';
import { buildWorkOrderCardHtml, type WorkOrderCardData } from './workOrderCardHtml';

// =============================================================================
// İş emri / refakat kartı yazdırma. Barkodun PNG'sini ekran-dışı bir QRCode'dan
// toDataURL ile alır (HTML'e gömmek için), sonra expo-print ile sistem yazdırma
// diyaloğunu açar. Hidden QR sink ekrana mount edilmeli — `QrSink` döner.
// =============================================================================

export function useCardPrinter() {
  const qrRef = useRef<{ toDataURL: (cb: (data: string) => void) => void } | null>(null);
  const [qrValue, setQrValue] = useState<string>('TEKS');
  const [printing, setPrinting] = useState(false);

  // Ekran-dışı QR — value değişince yeni frame'de yeniden render olur; toDataURL
  // güncel SVG'yi okusun diye print sırasında kısa bekleme veriyoruz.
  const QrSink = (
    <View style={{ position: 'absolute', left: -10000, top: 0, opacity: 0 }} pointerEvents="none">
      <QRCode value={qrValue || 'TEKS'} size={220} getRef={(c) => (qrRef.current = c)} />
    </View>
  );

  const getQrBase64 = useCallback(
    (value: string): Promise<string | null> =>
      new Promise((resolve) => {
        setQrValue(value);
        // QR'ın yeni value ile re-render olmasını bekle, sonra oku.
        setTimeout(() => {
          if (!qrRef.current?.toDataURL) {
            resolve(null);
            return;
          }
          try {
            qrRef.current.toDataURL((data: string) => resolve(data || null));
          } catch {
            resolve(null);
          }
        }, 160);
      }),
    [],
  );

  const printCard = useCallback(
    async (data: Omit<WorkOrderCardData, 'qrBase64'>) => {
      try {
        setPrinting(true);
        const qrBase64 = data.barcode ? await getQrBase64(data.barcode) : null;
        const html = buildWorkOrderCardHtml({ ...data, qrBase64 });
        await Print.printAsync({ html });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Yazdırma başarısız';
        // expo-print iOS/Android'de kullanıcı iptalinde de throw edebilir — sessiz geç.
        if (!/cancel|dismiss/i.test(msg)) {
          Toast.show({ type: 'error', text1: 'Çıktı alınamadı', text2: msg });
        }
      } finally {
        setPrinting(false);
      }
    },
    [getQrBase64],
  );

  return { QrSink, printCard, printing };
}
