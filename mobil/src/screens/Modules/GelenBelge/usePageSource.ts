// "Sayfa çek" düğmesinin durumu: önce ML Kit tarayıcısı, kullanılamaz/hata → klasik kamera; iptal ekranda bırakır.
import { useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import type { ScanPage } from './docScan';
import { acquirePages } from './pageSource';

export function usePageSource(currentCount: number, onPages: (pages: ScanPage[]) => void, openCamera: () => void) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // çift dokunuş iki tarayıcı açmasın (durum güncellemesi gecikir)

  const add = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const r = await acquirePages(currentCount);
      if (r.route === 'pages') onPages(r.pages);
      else if (r.route === 'camera') {
        if (r.error) Toast.show({ type: 'info', text1: 'Belge tarayıcı açılamadı; klasik kamera açıldı', text2: r.error });
        openCamera();
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return { busy, add: () => void add() };
}
