// "Sayfa çek" düğmesinin durumu: cihaz ayarına göre kendi çok çekimli kameramız (varsayılan) ya da ML Kit tarayıcısı;
// tarayıcı kullanılamaz/hata → kendi kameramız; iptal ekranda bırakır. Ekran `camera`yı `MultiPageCameraModal`a verir;
// 'live' (yalnız canlı kamera modülü olan APK'da) aynı bağlamayla canlı okuma ekranını açar.
import { useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import { effectiveScanEngine, useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import { isLiveCameraAvailable } from '../../../services/liveCamera';
import { scanWithDocScanner } from '../../../services/docScannerNative';
import { scannerPageLimit, type ScanPage } from './docScan';
import { acquirePages } from './pageSource';

export interface MultiCameraBinding {
  visible: boolean;
  /** Bu çekim oturumunda alınabilecek en çok sayfa. */
  capacity: number;
  firstPageNo: number;
  onDone: (pages: ScanPage[]) => void;
  onDismiss: () => void;
  /** true → canlı okuma ekranı (tek fotoğraf, kilitli alanlar forma). */
  live?: boolean;
}

export function usePageSource(currentCount: number, onPages: (pages: ScanPage[]) => void) {
  const engine = useDeviceSettingsStore((s) => s.docScanEngine);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [live, setLive] = useState(false);
  const busyRef = useRef(false); // çift dokunuş iki tarayıcı açmasın (durum güncellemesi gecikir)

  const add = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const r = await acquirePages(currentCount, scanWithDocScanner, effectiveScanEngine(engine, isLiveCameraAvailable()));
      if (r.route === 'pages') onPages(r.pages);
      else if (r.route === 'camera') {
        if (r.error) Toast.show({ type: 'info', text1: 'Belge tarayıcı açılamadı; kamera açıldı', text2: r.error });
        setLive(r.live === true);
        setCameraOpen(true);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const camera: MultiCameraBinding = {
    visible: cameraOpen,
    capacity: scannerPageLimit(currentCount),
    firstPageNo: currentCount + 1,
    live,
    onDismiss: () => setCameraOpen(false),
    onDone: (pages) => {
      setCameraOpen(false);
      if (pages.length) onPages(pages);
    },
  };

  return { busy, add: () => void add(), camera };
}
