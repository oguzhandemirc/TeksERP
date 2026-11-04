// Çok çekimli kameranın durumu: çekim → listeye + iyileştirme hemen arka planda başlar; "Tamam" yalnız kalanları bekler.
// Yer bitince kendiliğinden biter (tek sayfalık "belgeden iş bul" ek dokunuş istemez).
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { CameraView } from 'expo-camera';
import { enhanceWithNative, type RawScannedPage } from '../../../services/docScannerNative';
import { addShot, finishShots, removeShot, type FinishResult, type Shot } from './captureSession';
import { CAPTURE_QUALITY, MAX_SCAN_BYTES, TARGET_LONG_EDGE_PX } from './docScan';

interface Args {
  visible: boolean;
  capacity: number;
  cameraRef: RefObject<CameraView | null>;
  onDone: (r: FinishResult) => void;
  onError: (message: string) => void;
}

let seq = 0;

export function useMultiCapture({ visible, capacity, cameraRef, onDone, onError }: Args) {
  const [shots, setShots] = useState<Shot[]>([]);
  const shotsRef = useRef<Shot[]>([]);
  const enhancing = useRef(new Map<string, Promise<RawScannedPage | null>>());
  const [shooting, setShooting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const put = (next: Shot[]) => {
    shotsRef.current = next;
    setShots(next);
  };

  // Her açılış boş oturumdur (önceki çekimler ya gönderildi ya bırakıldı).
  useEffect(() => {
    if (!visible) return;
    put([]);
    enhancing.current.clear();
    setProgress(null);
    setConfirmDiscard(false);
  }, [visible]);

  const finish = useCallback(async () => {
    const list = shotsRef.current;
    if (!list.length) return;
    setProgress({ done: 0, total: list.length });
    try {
      const r = await finishShots(list, (s) => enhancing.current.get(s.id) ?? Promise.resolve(null), (done, total) => setProgress({ done, total }));
      onDone(r);
    } finally {
      setProgress(null);
    }
  }, [onDone]);

  const capture = async () => {
    if (shooting || progress || !cameraRef.current) return;
    setShooting(true);
    setConfirmDiscard(false);
    try {
      const pic = await cameraRef.current.takePictureAsync({ quality: CAPTURE_QUALITY, base64: true, exif: false });
      if (!pic?.base64) throw new Error('Fotoğraf alınamadı');
      const shot: Shot = { id: `c${++seq}`, uri: pic.uri, base64: pic.base64, width: pic.width, height: pic.height };
      const r = addShot(shotsRef.current, shot, capacity);
      if (!r.added) return;
      enhancing.current.set(shot.id, enhanceWithNative(shot.uri, { longEdge: TARGET_LONG_EDGE_PX, maxBytes: MAX_SCAN_BYTES, quality: CAPTURE_QUALITY }));
      put(r.shots);
      if (r.full) void finish();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Fotoğraf çekilemedi');
    } finally {
      setShooting(false);
    }
  };

  const remove = (id: string) => {
    enhancing.current.delete(id);
    put(removeShot(shotsRef.current, id));
  };

  /** Çekim varken ilk dokunuş sorar, ikincisi bırakır (çekimler yanlışlıkla gitmesin). */
  const requestDismiss = (): boolean => {
    if (shotsRef.current.length > 0 && !confirmDiscard) {
      setConfirmDiscard(true);
      return false;
    }
    return true;
  };

  return { shots, shooting, progress, confirmDiscard, capture: () => void capture(), finish: () => void finish(), remove, requestDismiss };
}
