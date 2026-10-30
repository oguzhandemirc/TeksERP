// =============================================================================
// Tek dokunuş gramaj düzeninin durumu (KQ-D5, K9)
// =============================================================================
// Dokunuş = completeQc2 (konak mutasyonu: iyimser sıradaki top). Düzeltme aynı
// uca farklı değerle gider (D4 yolu: eski kurşun satırı damgalanır, yenisi
// yazılır). İkisi de STATION_MUT.QC2_COMPLETE kuyruğunda → çevrimdışı birikir.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { onlineManager, useMutation } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { STATION_MUT } from '../../../offline/mutations';
import { showScreenError } from '../../../lib/screenToast';
import type { CompleteQc2Request } from '../../../services/kursunQc.service';
import type { KursunStepSummary } from '../../../types/models';
import type { TapValueConfig } from './stationPanels';
import type { MeterCaptureState, MeterRoll } from './useMeterCapture';
import {
  buildTapSelections,
  canSkipFlag,
  deviationText,
  findTarget,
  isCorrectionConflict,
  stopOpenTapWarning,
  type GramajValue,
  type LastTap,
} from './gramajTap';

type MutateOpts = { onSuccess?: () => void; onSettled?: () => void };

export interface GramajTapInput {
  cfg: TapValueConfig | null;
  summary: KursunStepSummary | null;
  roll: (MeterRoll & { barcode: string | null }) | null;
  operator: string;
  complete: (vars: CompleteQc2Request, opts: MutateOpts) => void;
  refresh: () => void;
  /** H3 sayaç akışı; yoksa ya da `outOn=false` ise gövde bugünküyle bayt-aynı. */
  meter?: Pick<MeterCaptureState, 'outOn' | 'captureOut'> | null;
  /** Makinede açık duruş var mı (D4-A2). Dokunuş UYARIR, gönderim sürer — K2: sunucu kapısı yok. */
  stopOpen?: boolean;
}

// Paused (çevrimdışı) mutasyon settle olmaz → kilit kısa süre sonra kendiliğinden açılır.
const OFFLINE_UNLOCK_MS = 700;
const FLASH_MS = 1500;

function useTapValues(cfg: TapValueConfig | null, summary: KursunStepSummary | null) {
  return useMemo(() => {
    const prop = cfg ? summary?.properties?.find((p) => p.propertyId === cfg.variantPropertyId) : undefined;
    const values: GramajValue[] = (prop?.values ?? []).map((v) => ({ code: v.code, label: v.name }));
    const target = cfg ? findTarget(summary?.targetValues, cfg.variantPropertyId, values) : null;
    return { title: prop?.name ?? '', values, target };
  }, [cfg, summary]);
}

function useTapLock() {
  const lockRef = useRef(false);
  const [locked, setLocked] = useState(false);
  const take = () => {
    if (lockRef.current) return false;
    lockRef.current = true;
    setLocked(true);
    return true;
  };
  const release = () => {
    lockRef.current = false;
    setLocked(false);
  };
  return { locked, take, release };
}

/**
 * Dokunuşu yollar. Sayaç açıksa önce okunur (elle giriş/sebep modalı kapanınca kuyruğa girer,
 * vazgeçte hiç girmez); kapalıysa gövde bugünküyle bayt-aynı.
 */
function dispatchTap(
  input: GramajTapInput,
  vars: CompleteQc2Request,
  opts: MutateOpts,
  ctl: { online: boolean; abort: () => void },
): void {
  // K2: açık duruş UYARIR, gönderimi kesmez (sunucu kapısı yok).
  const stopWarning = stopOpenTapWarning(input.stopOpen === true);
  if (stopWarning) Toast.show({ type: 'info', text1: stopWarning.title, text2: stopWarning.detail, visibilityTime: 5000 });
  if (input.meter?.outOn && input.roll) {
    input.meter.captureOut(
      input.roll,
      vars.stepId,
      (meterOut) => {
        input.complete({ ...vars, meterOut }, opts);
        if (!onlineManager.isOnline()) setTimeout(opts.onSettled ?? (() => undefined), OFFLINE_UNLOCK_MS);
      },
      ctl.abort,
    );
    return;
  }
  input.complete(vars, opts);
  if (!ctl.online) setTimeout(opts.onSettled ?? (() => undefined), OFFLINE_UNLOCK_MS);
}

export function useGramajTap(input: GramajTapInput) {
  const { cfg, summary, roll, operator } = input;
  const { title, values, target } = useTapValues(cfg, summary);
  const lock = useTapLock();
  const [last, setLast] = useState<LastTap | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [flashCode, setFlashCode] = useState<string | null>(null);
  const stepId = summary?.workOrderStepId ?? null;

  useEffect(() => {
    setLast(null);
    setCorrecting(false);
  }, [stepId]);
  useEffect(() => {
    if (!flashCode) return undefined;
    const t = setTimeout(() => setFlashCode(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [flashCode]);

  const correction = useMutation<unknown, Error, CompleteQc2Request>({ mutationKey: STATION_MUT.QC2_COMPLETE });

  const markSent = (at: Date) => setLast((p) => (p && p.at === at ? { ...p, queued: false } : p));

  const send = (value: GramajValue | null) => {
    if (!cfg || !roll || !stepId || !lock.take()) return;
    const prevLast = last;
    const at = new Date();
    const online = onlineManager.isOnline();
    setLast({ rollId: roll.rollId, stepId, barcode: roll.barcode, value, operator, at, queued: !online });
    if (value && target && value.code !== target.code) setFlashCode(value.code);
    const properties = value ? buildTapSelections(cfg, value.code) : [];
    const opts = { onSuccess: () => markSent(at), onSettled: lock.release };
    dispatchTap(input, { rollId: roll.rollId, stepId, properties }, opts, {
      online,
      abort: () => {
        setLast(prevLast);
        lock.release();
      },
    });
  };

  const correct = (value: GramajValue) => {
    if (!cfg || !last || !value) return;
    const prev = last;
    const at = new Date();
    setCorrecting(false);
    setLast({ ...prev, value, operator, at, queued: !onlineManager.isOnline() });
    if (target && value.code !== target.code) setFlashCode(value.code);
    correction.mutate(
      { rollId: prev.rollId, stepId: prev.stepId, properties: buildTapSelections(cfg, value.code) },
      {
        onSuccess: () => {
          markSent(at);
          input.refresh();
        },
        onError: (err) => {
          setLast(prev);
          if (isCorrectionConflict(err)) {
            Toast.show({ type: 'error', text1: 'Başka bir düzeltme yapıldı, liste yenilendi' });
          } else {
            showScreenError(err, 'Düzeltme kaydedilemedi');
          }
          input.refresh();
        },
      },
    );
  };

  return {
    title,
    // Telefonda kuyruk çekmecede gizli: operatör sıradaki topu panelden görür.
    rollTail: roll?.barcode ? roll.barcode.slice(-4) : null,
    values,
    target,
    locked: lock.locked,
    flashCode,
    last,
    deviation: last ? deviationText(target, last.value) : null,
    correcting,
    canSkip: cfg ? canSkipFlag(cfg) : false,
    tap: (v: GramajValue) => (correcting ? correct(v) : send(v)),
    skip: () => send(null),
    startCorrect: () => setCorrecting(true),
    cancelCorrect: () => setCorrecting(false),
  };
}

export type GramajTapState = ReturnType<typeof useGramajTap>;
