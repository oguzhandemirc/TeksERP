// Canlı okuma (L3) ekran durumu. Kare gelir → (ritim izin verirse) sunucuya TEK istek → yanıt oylamaya. Açılış/kapanış
// nesil sayacını artırır: geç gelen yanıt/çekim atılır. Tüm form alanları kilitli + kamera sabit + net → "Kıpırdatmayın"
// halkası → bir kez çekim (`useLiveCapture`). "Çek ve bitir" aynı çekimi elle başlatır.
import { useCallback, useEffect, useRef, useState } from 'react';
import { liveReadService } from '../../../../services/liveRead.service';
import type { LiveCameraError, LiveStability, LiveTextFrame } from '../../../../services/liveCamera';
import type { ClientOcr } from '../../../../services/deviceOcr';
import type { ScanPage } from '../docScan';
import { liveFormLocked } from './liveLocks';
import { IDLE_RHYTHM, canSend, markSent, markSettled, readyToCapture, stepHold, type HoldState } from './liveRhythm';
import { EMPTY_VOTE, applyLiveReading, editLiveField, unlockLiveField, type LiveVoteState } from './liveVote';
import { useLiveCapture } from './useLiveCapture';

interface Options {
  visible: boolean;
  onDone: (pages: ScanPage[]) => void;
}

export function useLiveRead({ visible, onDone }: Options) {
  const [vote, setVote] = useState<LiveVoteState>(EMPTY_VOTE);
  const voteRef = useRef<LiveVoteState>(EMPTY_VOTE);
  const [ocr, setOcr] = useState<ClientOcr | null>(null);
  /** null = halka yok; 0–1 = "Kıpırdatmayın" halkası ilerlemesi. */
  const [holdProgress, setHoldProgress] = useState<number | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const rhythm = useRef(IDLE_RHYTHM);
  const hold = useRef<HoldState>({ since: null });
  const gen = useRef(0);
  const resetHold = useCallback(() => {
    hold.current = { since: null };
    setHoldProgress(null);
  }, []);
  const shot = useLiveCapture({ gen, voteRef, onDone, onSettled: resetHold });
  const { capture, capturingRef, reset: resetShot } = shot;

  const updateVote = useCallback((f: (s: LiveVoteState) => LiveVoteState) => {
    voteRef.current = f(voteRef.current);
    setVote(voteRef.current);
  }, []);

  // Her açılış/kapanış yeni nesil: önceki oturumun uçuştaki yanıtı ve çekimi sonuç üretmez.
  useEffect(() => {
    gen.current++;
    rhythm.current = IDLE_RHYTHM;
    voteRef.current = EMPTY_VOTE;
    setVote(EMPTY_VOTE);
    setOcr(null);
    setCameraError(null);
    resetHold();
    resetShot();
  }, [visible, resetHold, resetShot]);
  useEffect(() => () => void gen.current++, []);

  const onText = useCallback(
    (frame: LiveTextFrame) => {
      setOcr(frame.ocr);
      const now = Date.now();
      if (capturingRef.current || !canSend(rhythm.current, now)) return;
      rhythm.current = markSent(rhythm.current, now);
      const g = gen.current;
      liveReadService
        .readFrame(frame.ocr)
        .then((r) => {
          if (g === gen.current && r) updateVote((s) => applyLiveReading(s, r));
        })
        .catch(() => undefined) // ağ hatası: bir sonraki kare yeniden dener
        .finally(() => {
          if (g === gen.current) rhythm.current = markSettled(rhythm.current);
        });
    },
    [capturingRef, updateVote],
  );

  const onStability = useCallback(
    (s: LiveStability) => {
      if (capturingRef.current) return;
      const step = stepHold(hold.current, readyToCapture(liveFormLocked(voteRef.current.fields), s), Date.now());
      hold.current = step.hold;
      setHoldProgress(step.hold.since === null ? null : step.progress);
      if (step.fire) void capture();
    },
    [capture, capturingRef],
  );

  return {
    cameraRef: shot.cameraRef,
    capturing: shot.capturing,
    vote,
    ocr,
    holdProgress,
    cameraError,
    onText,
    onStability,
    onCameraError: useCallback((e: LiveCameraError) => setCameraError(e.message), []),
    capture: () => void capture(),
    edit: (key: string, value: string) => updateVote((s) => editLiveField(s, key, value)),
    unlock: (key: string) => updateVote((s) => unlockLiveField(s, key)),
  };
}
