// =============================================================================
// KAYDET / GERİ AL mutasyonları — online-only (`networkMode: 'always'`), kuyruk YOK
// =============================================================================
import { useCallback, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { doffService } from '../../../services/doff.service';
import { onDoffFailed, onDoffSucceeded, type DoffAttempt } from './doffAttempt';
import { buildDoffPayload, classifyDoffFailure, doffResultFeedback, type DoffFailureAction, type DoffFormState } from './doffPayload';
import { runsKey, todayKey } from './useDoffLists';

export interface DoffResult {
  code: string;
  subtitle: string;
  warnings: string[];
}

interface SaveDeps {
  machineId: string | null;
  lineNo: number;
  form: DoffFormState;
  /** Başarıda form sıfırlama (parça sayısı + not). */
  onSaved: () => void;
  onRunsStale: () => void;
}

export function useDoffSave(deps: SaveDeps) {
  const qc = useQueryClient();
  const attemptRef = useRef<DoffAttempt | null>(null);
  const [result, setResult] = useState<DoffResult | null>(null);
  const [failure, setFailure] = useState<DoffFailureAction | null>(null);
  const invalidate = useCallback(() => {
    if (!deps.machineId) return;
    void qc.invalidateQueries({ queryKey: todayKey(deps.machineId) });
    void qc.invalidateQueries({ queryKey: runsKey(deps.machineId) });
  }, [qc, deps.machineId]);

  const mutation = useMutation({
    networkMode: 'always',
    mutationFn: (args: { token: string; fingerprint: string }) =>
      doffService.open(
        buildDoffPayload(deps.form, {
          machineId: deps.machineId!,
          productionLineNo: deps.lineNo,
          pressedAtIso: new Date().toISOString(),
          clientToken: args.token,
        })
      ),
    onSuccess: (res) => {
      attemptRef.current = onDoffSucceeded();
      const fb = doffResultFeedback(res.data.code, res.message);
      // Replay dönüşü `warnings` taşımıyor (§3.8c A.3) — koşumsuzluk ekranın kendi bilgisinden.
      const warnings = res.warnings ?? (deps.form.machineRunId ? [] : ['Koşum seçilmedi — bu indirme iş emri metresine GİRMİYOR.']);
      setResult({ code: fb.title, subtitle: fb.subtitle, warnings });
      Toast.show({ type: 'success', text1: fb.title, text2: fb.subtitle, visibilityTime: 6000 });
      deps.onSaved();
      invalidate();
    },
    onError: (e, args) => {
      attemptRef.current = onDoffFailed(args.token, args.fingerprint, e);
      const action = classifyDoffFailure(e, 'İndirme kaydedilemedi');
      if (action.kind === 'refresh-runs') deps.onRunsStale();
      if (action.kind === 'token-collision') setFailure(action);
      else Toast.show({ type: 'error', text1: 'İndirme kaydedilemedi', text2: action.message, visibilityTime: 6000 });
    },
  });

  return { mutation, attemptRef, result, setResult, failure, setFailure, invalidate };
}

export function useDoffRevoke(invalidate: () => void, setFailure: (f: DoffFailureAction | null) => void) {
  return useMutation({
    networkMode: 'always',
    mutationFn: (args: { id: string; reason: string }) => doffService.revoke(args.id, args.reason),
    onSuccess: (res) => {
      Toast.show({ type: 'success', text1: `${res.data.code} geri alındı`, visibilityTime: 4000 });
      invalidate();
    },
    onError: (e) => {
      const action = classifyDoffFailure(e, 'Geri alma yapılamadı');
      if (action.kind === 'has-rolls') setFailure(action);
      else Toast.show({ type: 'error', text1: 'Geri alma yapılamadı', text2: action.message, visibilityTime: 6000 });
      if (action.kind === 'already-revoked') invalidate();
    },
  });
}
