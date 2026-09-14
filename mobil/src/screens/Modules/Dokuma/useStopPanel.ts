// =============================================================================
// DURUŞ PANELİ HOOK'U — bu MAKİNEDEKİ açık duruş (hat değil: tek açık duruş/makine seddi)
// =============================================================================
// Kimlik token'dır (`stopKey`): `clientToken` deneme başına bir, yalnız belirsiz
// hatada yapışır (`doffAttempt` yardımcıları, parmak izi makine · sebep).
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import { useQuery } from '@tanstack/react-query';
import { machineStopService } from '../../../services/machineStop.service';
import { tokenForDoff, type DoffAttempt } from './doffAttempt';
import { stopsKey, useStopMutations } from './useStopMutations';
import { EMPTY_REASON, stopFingerprint, validateClassify } from './stopPayload';
import type { ReasonPresetValue } from '../../../components/reasonPresets/ReasonPresetPicker';

type Modal = { mode: 'open' } | { mode: 'classify'; stopId: string } | null;

function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function useStopPanel({ machineId, isOnline }: { machineId: string | null; isOnline: boolean }) {
  const [modal, setModal] = useState<Modal>(null);
  const [reason, setReason] = useState<ReasonPresetValue>(EMPTY_REASON);
  const [collision, setCollision] = useState<string | null>(null);
  const attemptRef = useRef<DoffAttempt | null>(null);
  const now = useMinuteTick();

  const stopsQuery = useQuery({
    queryKey: stopsKey(machineId ?? ''),
    queryFn: () => machineStopService.listOpen(machineId!),
    enabled: !!machineId,
    staleTime: 15_000,
  });

  const closeModal = useCallback(() => {
    setModal(null);
    setReason(EMPTY_REASON);
  }, []);
  const m = useStopMutations({ machineId, attemptRef, onDone: closeModal, onCollision: setCollision });

  const submit = useCallback(() => {
    if (!machineId || !modal || m.open.isPending || m.classify.isPending) return;
    if (!isOnline) {
      Toast.show({ type: 'error', text1: 'Çevrimdışı — duruş kaydedilemez (kuyruk yok)', visibilityTime: 4000 });
      return;
    }
    if (modal.mode === 'classify') {
      const v = validateClassify(reason);
      if (!v.ok) {
        Toast.show({ type: 'error', text1: v.message, visibilityTime: 4000 });
        return;
      }
      m.classify.mutate({ id: modal.stopId, reason });
      return;
    }
    const fingerprint = stopFingerprint({ machineId, reasonCode: reason.code });
    m.open.mutate({ reason, token: tokenForDoff(attemptRef.current, fingerprint), fingerprint });
  }, [machineId, modal, m.open, m.classify, isOnline, reason]);

  return {
    openStop: stopsQuery.data?.[0] ?? null,
    stopsLoading: stopsQuery.isLoading,
    now,
    modal,
    openModal: () => setModal({ mode: 'open' }),
    classifyModal: (stopId: string) => setModal({ mode: 'classify', stopId }),
    closeModal,
    reason,
    setReason,
    submit,
    submitting: m.open.isPending || m.classify.isPending,
    close: (id: string) => m.close.mutate(id),
    closing: m.close.isPending,
    revoke: (id: string, why: string) => m.revoke.mutate({ id, reason: why }),
    revoking: m.revoke.isPending,
    collision,
    dismissCollision: () => setCollision(null),
    resendAsNew: () => {
      attemptRef.current = null;
      setCollision(null);
      submit();
    },
  };
}

export type StopPanelState = ReturnType<typeof useStopPanel>;
