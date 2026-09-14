// =============================================================================
// KOŞUM PANELİ HOOK'U — durum + doğrulama + yapışkan token; mutasyonlar ayrı dosyada
// =============================================================================
// Açık koşum listesi `useDoffLists`ten (aynı anahtar → doff koşum seçici de tazelenir).
// `clientToken` mantıksal deneme başına bir kez — `doffAttempt` yardımcıları parmak
// izinden bağımsız çalışır, koşum kendi parmak izini verir (`runFingerprint`).
// =============================================================================
import { useCallback, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import { useQuery } from '@tanstack/react-query';
import { weavingOrderService } from '../../../services/weavingOrder.service';
import { tokenForDoff, type DoffAttempt } from './doffAttempt';
import { OPEN_ORDERS_KEY, useRunMutations } from './useRunMutations';
import { EMPTY_RUN_FORM, runFingerprint, validateClose, validateRunOpen, type RunFailureAction, type RunOpenForm } from './runPayload';

interface Deps {
  machineId: string | null;
  lineNo: number;
  isOnline: boolean;
}

function warn(text1: string) {
  Toast.show({ type: 'error', text1, visibilityTime: 4000 });
}

export function useRunPanel({ machineId, lineNo, isOnline }: Deps) {
  const [openModal, setOpenModal] = useState(false);
  const [closeTarget, setCloseTarget] = useState<string | null>(null);
  const [form, setForm] = useState<RunOpenForm>(EMPTY_RUN_FORM);
  const [collision, setCollision] = useState<RunFailureAction | null>(null);
  const attemptRef = useRef<DoffAttempt | null>(null);

  const ordersQuery = useQuery({ queryKey: OPEN_ORDERS_KEY, queryFn: weavingOrderService.listOpen, enabled: openModal, staleTime: 30_000 });

  const m = useRunMutations({
    machineId,
    lineNo,
    form,
    attemptRef,
    onOpened: () => {
      setOpenModal(false);
      setForm(EMPTY_RUN_FORM);
    },
    onClosed: () => setCloseTarget(null),
    onCollision: setCollision,
  });

  const submitOpen = useCallback(() => {
    if (!machineId || m.open.isPending) return;
    if (!isOnline) return warn('Çevrimdışı — koşum açılamaz (kuyruk yok)');
    const v = validateRunOpen(form);
    if (!v.ok) return warn(v.message);
    const fingerprint = runFingerprint({ machineId, productionLineNo: lineNo, weavingOrderId: form.weavingOrderId, itemId: form.itemId });
    m.open.mutate({ token: tokenForDoff(attemptRef.current, fingerprint), fingerprint });
  }, [machineId, m.open, isOnline, form, lineNo]);

  const submitClose = useCallback(
    (picks: string) => {
      if (!closeTarget || m.close.isPending) return;
      const v = validateClose(picks);
      if (!v.ok) return warn(v.message);
      m.close.mutate({ id: closeTarget, picks });
    },
    [closeTarget, m.close]
  );

  return {
    openModal,
    setOpenModal,
    closeTarget,
    setCloseTarget,
    form,
    setForm,
    orders: ordersQuery.data ?? [],
    ordersLoading: ordersQuery.isLoading,
    ordersError: ordersQuery.isError,
    submitOpen,
    opening: m.open.isPending,
    submitClose,
    closing: m.close.isPending,
    revoke: (id: string, reason: string) => m.revoke.mutate({ id, reason }),
    revoking: m.revoke.isPending,
    collision,
    dismissCollision: () => setCollision(null),
    resendAsNew: () => {
      attemptRef.current = null;
      setCollision(null);
      submitOpen();
    },
  };
}

export type RunPanelState = ReturnType<typeof useRunPanel>;
