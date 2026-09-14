// =============================================================================
// DURUŞ MUTASYONLARI — aç / kapat / sebep ata / geri al (online-only; `useStopPanel` besler)
// =============================================================================
import { useCallback, type MutableRefObject } from 'react';
import Toast from 'react-native-toast-message';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { machineStopService } from '../../../services/machineStop.service';
import { useInvalidateReasonPresets } from '../../../hooks/useReasonPresets';
import { onDoffFailed, onDoffSucceeded, type DoffAttempt } from './doffAttempt';
import { buildClassifyPayload, buildOpenStopPayload, classifyStopFailure } from './stopPayload';
import type { ReasonPresetValue } from '../../../components/reasonPresets/ReasonPresetPicker';

export const stopsKey = (machineId: string) => ['machine-stops', 'open', machineId] as const;

interface Deps {
  machineId: string | null;
  attemptRef: MutableRefObject<DoffAttempt | null>;
  onDone: () => void;
  onCollision: (message: string) => void;
}

function ok(text1: string, text2?: string) {
  Toast.show({ type: 'success', text1, text2, visibilityTime: 5000 });
}

export function useStopMutations({ machineId, attemptRef, onDone, onCollision }: Deps) {
  const qc = useQueryClient();
  const invalidatePresets = useInvalidateReasonPresets();
  const invalidate = useCallback(() => {
    if (machineId) void qc.invalidateQueries({ queryKey: stopsKey(machineId) });
  }, [qc, machineId]);
  const fail = useCallback(
    (e: unknown, fallback: string) => {
      const a = classifyStopFailure(e, fallback);
      if (a.kind === 'refresh-stops') invalidate();
      if (a.kind === 'refresh-presets') invalidatePresets();
      if (a.kind === 'token-collision') return onCollision(a.message);
      const text1 = a.kind === 'shift-cancelled' ? 'Vardiya iptal/mühürlü — duruş bu vardiyaya yazılamaz' : fallback;
      Toast.show({ type: 'error', text1, text2: a.message, visibilityTime: 6000 });
    },
    [invalidate, invalidatePresets, onCollision]
  );

  const open = useMutation({
    networkMode: 'always',
    mutationFn: (args: { reason: ReasonPresetValue; token: string; fingerprint: string }) =>
      machineStopService.open(buildOpenStopPayload(args.reason, { machineId: machineId!, startedAtIso: new Date().toISOString(), clientToken: args.token })),
    onSuccess: (res) => {
      attemptRef.current = onDoffSucceeded();
      ok(res.message ?? 'Duruş açıldı', res.data?.requiresReason ? 'Sebep verilmedi — sınıflandırma borcu doğdu' : res.warnings?.[0]);
      onDone();
      invalidate();
    },
    onError: (e, args) => {
      attemptRef.current = onDoffFailed(args.token, args.fingerprint, e);
      fail(e, 'Duruş açılamadı');
    },
  });

  const close = useMutation({
    networkMode: 'always',
    mutationFn: (id: string) => machineStopService.close(id, new Date().toISOString()),
    onSuccess: (res) => {
      ok(res.message ?? 'Duruş kapatıldı', res.warnings?.[0]);
      invalidate();
    },
    onError: (e) => fail(e, 'Duruş kapatılamadı'),
  });

  const classify = useMutation({
    networkMode: 'always',
    mutationFn: (args: { id: string; reason: ReasonPresetValue }) => machineStopService.classify(args.id, buildClassifyPayload(args.reason)),
    onSuccess: (res) => {
      ok(res.message ?? 'Sebep atandı');
      onDone();
      invalidate();
    },
    onError: (e) => fail(e, 'Sebep atanamadı'),
  });

  const revoke = useMutation({
    networkMode: 'always',
    mutationFn: (args: { id: string; reason: string }) => machineStopService.revoke(args.id, args.reason),
    onSuccess: (res) => {
      ok(res.message ?? 'Duruş geri alındı');
      invalidate();
    },
    onError: (e) => fail(e, 'Duruş geri alınamadı'),
  });

  return { open, close, classify, revoke };
}
