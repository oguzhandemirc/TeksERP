// =============================================================================
// KOŞUM PANELİ HOOK'U — durum + doğrulama + yapışkan token; mutasyonlar ayrı dosyada
// =============================================================================
// Açık koşum listesi `useDoffLists`ten (aynı anahtar → doff koşum seçici de tazelenir).
// `clientToken` mantıksal deneme başına bir kez — `doffAttempt` yardımcıları parmak
// izinden bağımsız çalışır, koşum kendi parmak izini verir (`runFingerprint`).
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import Toast from 'react-native-toast-message';
import { useQuery } from '@tanstack/react-query';
import { weavingOrderService, type WeavingOrderSummary } from '../../../services/weavingOrder.service';
import { machineRunService } from '../../../services/machineRun.service';
import { useDokumaRunWeavingRequired } from '../../../hooks/useFeatureFlags';
import { tokenForDoff, type DoffAttempt } from './doffAttempt';
import { OPEN_ORDERS_KEY, useRunMutations } from './useRunMutations';
import { EMPTY_RUN_FORM, prefillFromOrder, runFingerprint, validateClose, validateRunOpen, type RunFailureAction, type RunOpenForm } from './runPayload';

interface Deps {
  machineId: string | null;
  lineNo: number;
  isOnline: boolean;
}

function warn(text1: string) {
  Toast.show({ type: 'error', text1, visibilityTime: 4000 });
}

/**
 * Z1 üretim belge zinciri: Koşum aç açılışında takılı leventin işi (`suggestedWeavingOrderId`)
 * kendiliğinden seçili (desen/renk `weavingOrder.service.listOpen`dan ön-dolar). Operatör işi
 * değiştirince (`selectOrder`) DOKUNULMUŞ sayılır, öneri effect'i geri yazmaz (liste tazelense bile);
 * modal kapanınca taslak sıfırlanır → sonraki açılış öneriyi taze uygular. Eski sunucu 404 → boş bağlam.
 */
function useRunOrderPreselect(
  machineId: string | null,
  openModal: boolean,
  orders: readonly WeavingOrderSummary[],
  setForm: Dispatch<SetStateAction<RunOpenForm>>
) {
  const contextQuery = useQuery({
    queryKey: ['machine-runs', 'tablet-context', machineId ?? ''],
    queryFn: () => machineRunService.tabletContext(machineId!),
    enabled: openModal && machineId != null,
    staleTime: 15_000,
    retry: false,
  });
  const suggestedId = contextQuery.data?.suggestedWeavingOrderId ?? null;
  const runTouched = useRef(false);
  useEffect(() => {
    if (!openModal) {
      runTouched.current = false;
      setForm(EMPTY_RUN_FORM);
      return;
    }
    if (runTouched.current || !suggestedId) return;
    const o = orders.find((x) => x.id === suggestedId);
    if (o) setForm((f) => (f.weavingOrderId ? f : prefillFromOrder(f, o)));
  }, [openModal, suggestedId, orders, setForm]);
  const selectOrder = useCallback(
    (next: RunOpenForm) => {
      runTouched.current = true;
      setForm(next);
    },
    [setForm]
  );
  return { suggestedFrom: contextQuery.data?.suggestedFrom ?? null, selectOrder };
}

export function useRunPanel({ machineId, lineNo, isOnline }: Deps) {
  const [openModal, setOpenModal] = useState(false);
  const [closeTarget, setCloseTarget] = useState<string | null>(null);
  const [form, setForm] = useState<RunOpenForm>(EMPTY_RUN_FORM);
  const [collision, setCollision] = useState<RunFailureAction | null>(null);
  const attemptRef = useRef<DoffAttempt | null>(null);
  const weavingRequired = useDokumaRunWeavingRequired();

  const ordersQuery = useQuery({ queryKey: OPEN_ORDERS_KEY, queryFn: weavingOrderService.listOpen, enabled: openModal, staleTime: 30_000 });
  const orders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data]);
  const { suggestedFrom, selectOrder } = useRunOrderPreselect(machineId, openModal, orders, setForm);

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
    const v = validateRunOpen(form, weavingRequired);
    if (!v.ok) return warn(v.message);
    const fingerprint = runFingerprint({ machineId, productionLineNo: lineNo, weavingOrderId: form.weavingOrderId, itemId: form.itemId });
    m.open.mutate({ token: tokenForDoff(attemptRef.current, fingerprint), fingerprint });
  }, [machineId, m.open, isOnline, form, lineNo, weavingRequired]);

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
    selectOrder,
    weavingRequired,
    /** Öneri kaynağı — "takılı leventin işi" etiketi için (null = öneri yok). */
    suggestedFrom,
    orders,
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
