// =============================================================================
// LEVENT MUTASYONLARI — plan / sar / taslak sil / iptal (online-only; `useDevereScreen` besler)
// =============================================================================
// Kuyruk YOK (`networkMode:'always'`, §11 D): iplik çıkışı deftere yazar, eksi-bakiye
// kapısı sunucudadır — kuyrukta bekleyen sarım boşalırken sessiz 409 üretirdi.
// Plan ve sarım token'lı (`devereAttempt`), taslak sil ve iptal DB'de tek (token'sız).
// =============================================================================
import { useCallback, type MutableRefObject } from 'react';
import Toast from 'react-native-toast-message';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { warpBeamService, type WarpBeamOrigin } from '../../../services/warpBeam.service';
import { useInvalidateReasonPresets } from '../../../hooks/useReasonPresets';
import { FLAGS_KEY } from '../../../hooks/useFeatureFlags';
import { onBeamFailed, onBeamSucceeded, type BeamAttempt } from './devereAttempt';
import { buildPlanPayload, buildWindPayload, classifyBeamFailure, type PlanForm, type WindForm } from './beamPayload';

export const BEAMS_KEY = ['warp-beams'] as const;
export const CONTEXT_KEY = ['warp-beams', 'tablet-context'] as const;

interface Deps {
  attemptRef: MutableRefObject<BeamAttempt | null>;
  onDone: () => void;
  onCollision: (message: string) => void;
}

function ok(text1: string, text2?: string) {
  Toast.show({ type: 'success', text1, text2, visibilityTime: 5000 });
}

export function useBeamMutations({ attemptRef, onDone, onCollision }: Deps) {
  const qc = useQueryClient();
  const invalidatePresets = useInvalidateReasonPresets();
  const invalidateList = useCallback(() => void qc.invalidateQueries({ queryKey: BEAMS_KEY }), [qc]);
  const fail = useCallback(
    (e: unknown, fallback: string) => {
      const a = classifyBeamFailure(e, fallback);
      if (a.kind === 'refresh-list') invalidateList();
      if (a.kind === 'refresh-context') void qc.invalidateQueries({ queryKey: CONTEXT_KEY });
      if (a.kind === 'refresh-presets') invalidatePresets();
      // Modül kapandıysa bayrağı tazele — kart bir sonraki çizimde kaybolur (§11 E).
      if (a.kind === 'module-off') void qc.invalidateQueries({ queryKey: FLAGS_KEY });
      if (a.kind === 'token-collision') return onCollision(a.message);
      const text1 = a.kind === 'module-off' ? (a.modul === 'iplik' ? 'İplik modülü kapalı — içeride sarım yapılamaz' : 'Devere modülü kapalı') : fallback;
      Toast.show({ type: 'error', text1, text2: a.message, visibilityTime: 6000 });
    },
    [invalidateList, invalidatePresets, onCollision, qc]
  );

  const plan = useMutation({
    networkMode: 'always',
    mutationFn: (args: { form: PlanForm; token: string; fingerprint: string }) => warpBeamService.plan(buildPlanPayload(args.form, args.token)),
    onSuccess: (res) => {
      attemptRef.current = onBeamSucceeded();
      ok(res.message ?? `${res.data?.beamNo ?? 'Levent'} planlandı`, res.warnings?.[0]);
      onDone();
      invalidateList();
    },
    onError: (e, args) => {
      attemptRef.current = onBeamFailed(args.token, args.fingerprint, e);
      fail(e, 'Levent planlanamadı');
    },
  });

  const wind = useMutation({
    networkMode: 'always',
    mutationFn: (args: { beamId: string; originKind: WarpBeamOrigin; form: WindForm; token: string; fingerprint: string }) =>
      warpBeamService.wind(args.beamId, buildWindPayload(args.form, args.originKind, args.token)),
    onSuccess: (res) => {
      attemptRef.current = onBeamSucceeded();
      ok(res.message ?? 'Levent sarıldı', res.warnings?.[0]);
      onDone();
      invalidateList();
    },
    onError: (e, args) => {
      attemptRef.current = onBeamFailed(args.token, args.fingerprint, e);
      fail(e, 'Sarım kaydedilemedi');
    },
  });

  const deleteDraft = useMutation({
    networkMode: 'always',
    mutationFn: (id: string) => warpBeamService.deleteDraft(id),
    onSuccess: (res) => {
      ok(res.message ?? 'Taslak silindi');
      invalidateList();
    },
    onError: (e) => fail(e, 'Taslak silinemedi'),
  });

  const cancel = useMutation({
    networkMode: 'always',
    mutationFn: (args: { id: string; reason: string }) => warpBeamService.cancel(args.id, args.reason),
    onSuccess: (res) => {
      ok(res.message ?? 'Sarım iptal edildi', 'İptal sonrası yeniden sarım için yeni plan açın');
      onDone();
      invalidateList();
    },
    onError: (e) => fail(e, 'Sarım iptal edilemedi'),
  });

  return { plan, wind, deleteDraft, cancel };
}
