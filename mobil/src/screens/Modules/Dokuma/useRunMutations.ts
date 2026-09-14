// =============================================================================
// KOŞUM MUTASYONLARI — aç / kapat / geri al (online-only; `useRunPanel` besler)
// =============================================================================
import { useCallback, type MutableRefObject } from 'react';
import Toast from 'react-native-toast-message';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { machineRunService } from '../../../services/machineRun.service';
import { onDoffFailed, onDoffSucceeded, type DoffAttempt } from './doffAttempt';
import { runsKey, todayKey } from './useDoffLists';
import { buildClosePayload, buildOpenRunPayload, classifyRunFailure, type RunFailureAction, type RunOpenForm } from './runPayload';

export const OPEN_ORDERS_KEY = ['weaving-orders', 'open'] as const;

interface Deps {
  machineId: string | null;
  lineNo: number;
  form: RunOpenForm;
  attemptRef: MutableRefObject<DoffAttempt | null>;
  onOpened: () => void;
  onClosed: () => void;
  onCollision: (a: RunFailureAction) => void;
}

function useRunInvalidate(machineId: string | null) {
  const qc = useQueryClient();
  return useCallback(() => {
    if (!machineId) return;
    void qc.invalidateQueries({ queryKey: runsKey(machineId) });
    void qc.invalidateQueries({ queryKey: todayKey(machineId) });
  }, [qc, machineId]);
}

function useRunFailure(invalidate: () => void, onCollision: (a: RunFailureAction) => void) {
  const qc = useQueryClient();
  return useCallback(
    (e: unknown, fallback: string) => {
      const a = classifyRunFailure(e, fallback);
      if (a.kind === 'refresh-runs') invalidate();
      if (a.kind === 'refresh-orders') void qc.invalidateQueries({ queryKey: OPEN_ORDERS_KEY });
      if (a.kind === 'token-collision') onCollision(a);
      else Toast.show({ type: 'error', text1: fallback, text2: a.message, visibilityTime: 6000 });
    },
    [invalidate, qc, onCollision]
  );
}

function ok(text1: string, text2?: string) {
  Toast.show({ type: 'success', text1, text2, visibilityTime: 5000 });
}

export function useRunMutations({ machineId, lineNo, form, attemptRef, onOpened, onClosed, onCollision }: Deps) {
  const invalidate = useRunInvalidate(machineId);
  const fail = useRunFailure(invalidate, onCollision);

  const open = useMutation({
    networkMode: 'always',
    mutationFn: (args: { token: string; fingerprint: string }) =>
      machineRunService.open(
        buildOpenRunPayload(form, { machineId: machineId!, productionLineNo: lineNo, startedAtIso: new Date().toISOString(), clientToken: args.token })
      ),
    onSuccess: (res) => {
      attemptRef.current = onDoffSucceeded();
      ok(res.message ?? 'Koşum açıldı', res.warnings?.[0]);
      onOpened();
      invalidate();
    },
    onError: (e, args) => {
      attemptRef.current = onDoffFailed(args.token, args.fingerprint, e);
      fail(e, 'Koşum açılamadı');
    },
  });

  const close = useMutation({
    networkMode: 'always',
    mutationFn: (args: { id: string; picks: string }) => machineRunService.close(args.id, buildClosePayload(args.picks, new Date().toISOString())),
    onSuccess: (res) => {
      ok(res.message ?? 'Koşum kapatıldı', res.warnings?.[0]);
      onClosed();
      invalidate();
    },
    onError: (e) => fail(e, 'Koşum kapatılamadı'),
  });

  const revoke = useMutation({
    networkMode: 'always',
    mutationFn: (args: { id: string; reason: string }) => machineRunService.revoke(args.id, args.reason),
    onSuccess: (res) => {
      ok(res.message ?? 'Koşum geri alındı');
      invalidate();
    },
    onError: (e) => fail(e, 'Koşum geri alınamadı'),
  });

  return { open, close, revoke };
}
