// Canlı okuma (L3) bitiş çekimi: kamera fotoğrafı → native iyileştirme → ScanPage → kilitler fotoğrafın sha256'sına →
// `onDone`. Aynı anda tek çekim; ekran kapanmışsa (nesil değişti) sonuç atılır. Hata/iyileştirme yok → Toast, ekran açık kalır.
import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import Toast from 'react-native-toast-message';
import type { LiveCameraHandle } from '../../../../components/liveCamera/LiveCameraView';
import { enhanceWithNative } from '../../../../services/docScannerNative';
import { CAPTURE_QUALITY, MAX_SCAN_BYTES, TARGET_LONG_EDGE_PX, scannedToScanPage, type ScanPage } from '../docScan';
import { rememberLiveLocks } from './liveLocks';
import { lockedLiveValues, userLockedLiveKeys, type LiveVoteState } from './liveVote';

export const LIVE_CAPTURE_FAILED = 'Fotoğraf hazırlanamadı; yeniden çekin';

interface Options {
  gen: MutableRefObject<number>;
  voteRef: MutableRefObject<LiveVoteState>;
  onDone: (pages: ScanPage[]) => void;
  /** Çekim bittiğinde (başarı/hata) — halka sıfırlanır. */
  onSettled: () => void;
}

export function useLiveCapture({ gen, voteRef, onDone, onSettled }: Options) {
  const cameraRef = useRef<LiveCameraHandle | null>(null);
  const capturingRef = useRef(false);
  const [capturing, setCapturing] = useState(false);
  const cb = useRef({ onDone, onSettled });
  cb.current = { onDone, onSettled };

  const capture = useCallback(async () => {
    if (capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    const g = gen.current;
    try {
      const cam = cameraRef.current;
      if (!cam) throw new Error('Kamera hazır değil');
      const still = await cam.captureStill();
      const raw = await enhanceWithNative(still.uri, { longEdge: TARGET_LONG_EDGE_PX, maxBytes: MAX_SCAN_BYTES, quality: CAPTURE_QUALITY });
      if (g !== gen.current) return;
      if (!raw) {
        Toast.show({ type: 'error', text1: LIVE_CAPTURE_FAILED });
        return;
      }
      const page = scannedToScanPage(raw);
      rememberLiveLocks(page.sha256, lockedLiveValues(voteRef.current), userLockedLiveKeys(voteRef.current));
      cb.current.onDone([page]);
    } catch (e) {
      if (g === gen.current) Toast.show({ type: 'error', text1: LIVE_CAPTURE_FAILED, text2: e instanceof Error ? e.message : undefined });
    } finally {
      if (g === gen.current) {
        capturingRef.current = false;
        setCapturing(false);
        cb.current.onSettled();
      }
    }
  }, [gen, voteRef]);

  const reset = useCallback(() => {
    capturingRef.current = false;
    setCapturing(false);
  }, []);

  return { cameraRef, capturing, capturingRef, capture, reset };
}
