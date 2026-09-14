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
import { isSameLocalDay } from './beamPayload';
import { BEAMS_KEY, CONTEXT_KEY, useBeamMutations } from './useBeamMutations';
import { useBeamForms, type FormModal } from './useBeamForms';

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
  const todayWound = useMemo(() => {
    const now = new Date();
    return (ready.data ?? []).filter((b) => b.wound && isSameLocalDay(b.wound.createdAt, now));
  }, [ready.data]);

  const mutations = useBeamMutations({ attemptRef, onDone: () => setModal(null), onCollision: setCollision });
  const defaultWarehouseId = context.data?.warehouses.find((w) => w.isDefault)?.id ?? context.data?.warehouses[0]?.id ?? null;
  const forms = useBeamForms({ attemptRef, mutations, defaultWarehouseId, open: setModal, current: modal?.kind === 'plan' || modal?.kind === 'wind' ? modal : null, lotRequired: context.data?.lotRequired ?? false });
  const closeModal = useCallback(() => {
    setModal(null);
    forms.clearFormError();
  }, [forms]);

  const busy = mutations.plan.isPending || mutations.wind.isPending || mutations.deleteDraft.isPending || mutations.cancel.isPending;
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
    readyLoading: ready.isLoading,
    refresh: () => {
      void planned.refetch();
      void ready.refetch();
      void context.refetch();
    },
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
