// =============================================================================
// LEVENT SARIM ekran-hook'u — listeler (planlı · bugün sarılan) · bağlam · modal durumu
// =============================================================================
// Ekran OTURUMSUZ (§11 ⓪): devere bir StationKind değil, `producesWarpBeam` yeteneği;
// makine her sarımda seçilir, kimlik JWT'den. Kuyruk YOK; çevrimdışıyken üç buton kilitli.
// =============================================================================
import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { warpBeamService, type WarpBeam } from '../../../services/warpBeam.service';
import { usePermissions } from '../../../hooks/usePermission';
import { useIsOnline, useOfflineReason } from '../../../offline/hooks';
import type { BeamAttempt } from './devereAttempt';
import { isSameLocalDay, lastPlannedWarpSpecId, soleMachineId, soleWeavingOrderId } from './beamPayload';
import { BEAMS_KEY, CONTEXT_KEY, useBeamMutations } from './useBeamMutations';
import { useBeamForms, type FormModal } from './useBeamForms';
import { useMountForm } from './useMountForm';

export type DevereModal = FormModal | { kind: 'cancel'; beam: WarpBeam } | { kind: 'delete'; beam: WarpBeam } | null;

export function useDevereScreen() {
  const canCancel = usePermissions().has('mobile:devere-iptal');
  const isOnline = useIsOnline();
  const offlineReason = useOfflineReason();
  const attemptRef = useRef<BeamAttempt | null>(null);
  const [modal, setModal] = useState<DevereModal>(null);
  const [collision, setCollision] = useState<string | null>(null);

  const context = useQuery({ queryKey: CONTEXT_KEY, queryFn: warpBeamService.tabletContext, staleTime: 5 * 60_000 });
  const planned = useQuery({ queryKey: [...BEAMS_KEY, 'PLANNED'], queryFn: () => warpBeamService.list('PLANNED', 100), staleTime: 15_000 });
  // Sarılmış levent iki durumda yaşar: READY (burada) · SHIPPED_OUT (fasonda, F1) — "bugün sarılan" ikisini de sayar.
  const ready = useQuery({ queryKey: [...BEAMS_KEY, 'WOUND'], queryFn: () => warpBeamService.list(['READY', 'SHIPPED_OUT'], 50), staleTime: 15_000 });
  // Faz 3 (E3): "Tezgahta" sekmesi — yalnız bağlam `mountTracking` derse çizilir ve sorgulanır (kapalıyken sıfır fark).
  const mountTracking = context.data?.mountTracking === true;
  const live = useQuery({ queryKey: [...BEAMS_KEY, 'LIVE'], queryFn: () => warpBeamService.list(['READY', 'MOUNTED'], 100), staleTime: 15_000, enabled: mountTracking });
  const mountForm = useMountForm({ loomMachines: context.data?.loomMachines ?? [], methodRequired: context.data?.mountTrackingRequired === true, onDone: () => void live.refetch() });
  // Gövde çakışması ERKEN uyarısı (sunucu `assertPhysicalBeamFreeTx` aynası): canlı levent = READY · SHIPPED_OUT (ready) ∪ MOUNTED (live).
  const physicalBusyBeams = useMemo(() => {
    const seen = new Map<string, WarpBeam>();
    for (const b of [...(ready.data ?? []), ...(live.data ?? [])]) seen.set(b.id, b);
    return [...seen.values()];
  }, [ready.data, live.data]);
  const todayWound = useMemo(() => {
    const now = new Date();
    return (ready.data ?? []).filter((b) => b.wound && isSameLocalDay(b.wound.createdAt, now));
  }, [ready.data]);

  const mutations = useBeamMutations({ attemptRef, onDone: () => setModal(null), onCollision: setCollision });
  const defaultWarehouseId = context.data?.warehouses.find((w) => w.isDefault)?.id ?? context.data?.warehouses[0]?.id ?? null;
  const forms = useBeamForms({
    attemptRef,
    mutations,
    defaultWarehouseId,
    open: setModal,
    current: modal?.kind === 'plan' || modal?.kind === 'wind' ? modal : null,
    lotRequired: context.data?.lotRequired ?? false,
    soleMachineId: soleMachineId(context.data?.machines ?? []),
    lastWarpSpecId: lastPlannedWarpSpecId([...(planned.data ?? []), ...(ready.data ?? [])]),
    soleWeavingOrderId: soleWeavingOrderId(context.data?.weavingOrders),
    beamWeavingLinkRequired: context.data?.beamWeavingLinkRequired ?? false,
  });
  const closeModal = useCallback(() => {
    setModal(null);
    forms.clearFormError();
  }, [forms]);

  const busy = mutations.plan.isPending || mutations.wind.isPending || mutations.deleteDraft.isPending || mutations.cancel.isPending || mountForm.pending;
  return {
    ...forms,
    canCancel,
    isOnline,
    offlineReason,
    context,
    planned: planned.data ?? [],
    plannedLoading: planned.isLoading,
    plannedError: planned.isError,
    todayWound,
    physicalBusyBeams,
    readyLoading: ready.isLoading,
    refresh: () => {
      void planned.refetch();
      void ready.refetch();
      void context.refetch();
      if (mountTracking) void live.refetch();
    },
    mountTracking,
    liveBeams: live.data ?? [],
    liveLoading: live.isLoading,
    mountForm,
    modal,
    setModal,
    closeModal,
    collision,
    dismissCollision: () => setCollision(null),
    resendAsNew: () => {
      setCollision(null);
      forms.resendAsNew();
    },
    deleteDraft: (id: string) => mutations.deleteDraft.mutate(id, { onSettled: closeModal }),
    cancel: (id: string, reason: string) => mutations.cancel.mutate({ id, reason }),
    busy,
  };
}

export type DevereScreenState = ReturnType<typeof useDevereScreen>;
