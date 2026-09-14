// =============================================================================
// LEVENT PANELİ hook'u (Faz 3 E3) — makinedeki bağlı leventler; sök · tüket · bitir (online-only)
// =============================================================================
// Yalnız devere + tezgah bağı bayrağı açıkken sorgulanır (`useDevereMountTracking`); kapalıyken
// panel hiç çizilmez (Faz 1b ile birebir). Kurallar `tezgahPayload`ta; token tüketim için (deneme başına).
// =============================================================================
import { useCallback, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { warpBeamService, type MountedBeam } from '../../../services/warpBeam.service';
import { FLAGS_KEY, useDevereMountTracking } from '../../../hooks/useFeatureFlags';
import { onBeamFailed, onBeamSucceeded, tokenForBeam, type BeamAttempt } from '../Devere/devereAttempt';
import { classifyBeamFailure } from '../Devere/beamPayload';
import {
  EMPTY_CONSUME, EMPTY_DISMOUNT, EMPTY_EXHAUST, buildConsumePayload, buildDismountPayload, buildExhaustPayload, consumeFingerprint, parseM,
  validateConsume, validateDismount, validateExhaust, type ConsumeForm, type DismountForm, type ExhaustForm,
} from '../Devere/tezgahPayload';

export type BeamPanelModal = { kind: 'dismount' | 'consume' | 'exhaust'; beam: MountedBeam } | null;
export const MOUNTED_KEY = (machineId: string) => ['warp-beams', 'mounted', machineId] as const;

export function useBeamPanel({ machineId, isOnline }: { machineId: string | null; isOnline: boolean }) {
  const qc = useQueryClient();
  const enabled = useDevereMountTracking() && machineId != null;
  const attemptRef = useRef<BeamAttempt | null>(null);
  const [modal, setModal] = useState<BeamPanelModal>(null);
  const [dismountForm, setDismountForm] = useState<DismountForm>(EMPTY_DISMOUNT);
  const [consumeForm, setConsumeForm] = useState<ConsumeForm>(EMPTY_CONSUME);
  const [exhaustForm, setExhaustForm] = useState<ExhaustForm>(EMPTY_EXHAUST);
  const [error, setError] = useState<string | null>(null);

  const mounted = useQuery({ queryKey: MOUNTED_KEY(machineId ?? ''), queryFn: () => warpBeamService.mountedOnMachine(machineId!), enabled, staleTime: 15_000 });
  const done = useCallback(
    (res: { message?: string; warnings?: string[] }, fallback: string) => {
      Toast.show({ type: 'success', text1: res.message ?? fallback, text2: res.warnings?.[0], visibilityTime: 6000 });
      setModal(null);
      void qc.invalidateQueries({ queryKey: ['warp-beams'] });
    },
    [qc]
  );
  const fail = useCallback(
    (e: unknown, fallback: string) => {
      const a = classifyBeamFailure(e, fallback);
      if (a.kind === 'refresh-list' || a.kind === 'refresh-context') void qc.invalidateQueries({ queryKey: ['warp-beams'] });
      if (a.kind === 'module-off') void qc.invalidateQueries({ queryKey: FLAGS_KEY });
      Toast.show({ type: 'error', text1: fallback, text2: a.message, visibilityTime: 6000 });
    },
    [qc]
  );

  const dismount = useMutation({ networkMode: 'always', mutationFn: (a: { id: string; form: DismountForm }) => warpBeamService.dismount(a.id, buildDismountPayload(a.form)), onSuccess: (r) => done(r, 'Levent söküldü'), onError: (e) => fail(e, 'Levent sökülemedi') });
  const exhaust = useMutation({ networkMode: 'always', mutationFn: (a: { id: string; form: ExhaustForm }) => warpBeamService.exhaust(a.id, buildExhaustPayload(a.form)), onSuccess: (r) => done(r, 'Levent bitti'), onError: (e) => fail(e, 'Bitiş kaydedilemedi') });
  const consume = useMutation({
    networkMode: 'always',
    mutationFn: (a: { id: string; form: ConsumeForm; token: string; fingerprint: string }) => warpBeamService.consume(a.id, buildConsumePayload(a.form, a.token)),
    onSuccess: (r) => {
      attemptRef.current = onBeamSucceeded();
      done(r, 'Tüketim yazıldı');
    },
    onError: (e, a) => {
      attemptRef.current = onBeamFailed(a.token, a.fingerprint, e);
      fail(e, 'Tüketim yazılamadı');
    },
  });

  const open = useCallback((kind: NonNullable<BeamPanelModal>['kind'], beam: MountedBeam) => {
    setDismountForm(EMPTY_DISMOUNT);
    setConsumeForm(EMPTY_CONSUME);
    setExhaustForm(EMPTY_EXHAUST);
    setError(null);
    setModal({ kind, beam });
  }, []);
  const close = useCallback(() => setModal(null), []);
  const submit = useCallback(() => {
    if (!modal) return;
    const { kind, beam } = modal;
    if (kind === 'dismount') {
      const v = validateDismount(dismountForm);
      if (v) return setError(v);
      return dismount.mutate({ id: beam.id, form: dismountForm });
    }
    if (kind === 'exhaust') {
      const v = validateExhaust(exhaustForm);
      if (v) return setError(v);
      return exhaust.mutate({ id: beam.id, form: exhaustForm });
    }
    const v = validateConsume(consumeForm, beam.remainingM);
    if (v) return setError(v);
    const fingerprint = consumeFingerprint({ beamId: beam.id, lengthM: parseM(consumeForm.lengthM) ?? 0 });
    consume.mutate({ id: beam.id, form: consumeForm, token: tokenForBeam(attemptRef.current, fingerprint), fingerprint });
  }, [modal, dismountForm, exhaustForm, consumeForm, dismount, exhaust, consume]);

  const pending = dismount.isPending || consume.isPending || exhaust.isPending;
  return { enabled, beams: mounted.data ?? [], loading: mounted.isLoading, isError: mounted.isError, refetch: mounted.refetch, modal, open, close, submit, pending, error, isOnline, dismountForm, setDismountForm, consumeForm, setConsumeForm, exhaustForm, setExhaustForm };
}

export type BeamPanelState = ReturnType<typeof useBeamPanel>;
