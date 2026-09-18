// =============================================================================
// PLAN / SAR formları — durum + doğrulama + gönderim (token deneme başına bir kez)
// =============================================================================
import { useCallback, useState, type MutableRefObject } from 'react';
import type { WarpBeam } from '../../../services/warpBeam.service';
import { planFingerprint, tokenForBeam, windFingerprint, type BeamAttempt } from './devereAttempt';
import { EMPTY_PLAN, initialWindForm, validatePlan, validateWind, windDefaultFor, windFormWithDefault, type PlanForm, type WindDefault, type WindForm } from './beamPayload';
import type { useBeamMutations } from './useBeamMutations';

type Mutations = ReturnType<typeof useBeamMutations>;
export type FormModal = { kind: 'plan' } | { kind: 'wind'; beam: WarpBeam };

interface Deps {
  attemptRef: MutableRefObject<BeamAttempt | null>;
  mutations: Mutations;
  defaultWarehouseId: string | null;
  open: (m: FormModal) => void;
  current: FormModal | null;
  /** `devere.lotRequired` sunucudan (bağlam ucu); alan yoksa false. */
  lotRequired: boolean;
  /** Tek devere makinesi → SAR açılışında ön-seçili (IN_HOUSE); yoksa null (+0/−1 dokunuş). */
  soleMachineId: string | null;
  /** Z5: çözgü kartı başına son IN_HOUSE sarım önerileri (SAR satır ön-dolgusu); boş → yalnız `soleMachineId` düşer. */
  lastWindDefaults: readonly WindDefault[];
  /** Bağlamdaki son leventin çözgü kartı → Plan açılışında ön-dolu; yoksa null. */
  lastWarpSpecId: string | null;
  /** Tek açık dokuma işi → Plan açılışında ön-seçili; yoksa null (Z1). */
  soleWeavingOrderId: string | null;
  /** `devere.beamWeavingLinkRequired` (sunucudan); açıkken plan işe bağlanmalı. */
  beamWeavingLinkRequired: boolean;
}

const toNum = (s: string): number => Number(s.replace(',', '.'));

export function useBeamForms({ attemptRef, mutations, defaultWarehouseId, open, current, lotRequired, soleMachineId, lastWindDefaults, lastWarpSpecId, soleWeavingOrderId, beamWeavingLinkRequired }: Deps) {
  const [planForm, setPlanFormState] = useState<PlanForm>(EMPTY_PLAN);
  const [windForm, setWindFormState] = useState<WindForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Yerel doğrulama satırı alan değişince ve doğrulama GEÇİNCE düşer — yoksa sunucunun 409 toast'ıyla
  // eski kırmızı satır yan yana kalıyordu (gerçek cihaz bulgusu 2026-09-18 03:12).
  const setPlanForm = useCallback((f: PlanForm) => {
    setPlanFormState(f);
    setFormError(null);
  }, []);
  const setWindForm = useCallback((f: WindForm | null) => {
    setWindFormState(f);
    setFormError(null);
  }, []);

  const openPlan = useCallback(() => {
    // Son çözgü kartı + tek açık dokuma işi ön-dolu (operatör değiştirebilir).
    setPlanForm({ ...EMPTY_PLAN, warpSpecId: lastWarpSpecId, weavingOrderId: soleWeavingOrderId });
    open({ kind: 'plan' });
  }, [open, setPlanForm, lastWarpSpecId, soleWeavingOrderId]);

  const openWind = useCallback(
    (beam: WarpBeam) => {
      const taban = initialWindForm(beam, defaultWarehouseId);
      // Önce çözgü kartının SON sarım önerisi (makine + iplik satırları); yoksa tek devere makinesi ön-seçimi.
      const oneri = windFormWithDefault(taban, beam.originKind, windDefaultFor(lastWindDefaults, beam.warpSpec.id));
      const machineId = oneri.machineId ?? (beam.originKind === 'IN_HOUSE' ? soleMachineId : null);
      setWindForm({ ...oneri, machineId });
      open({ kind: 'wind', beam });
    },
    [defaultWarehouseId, open, setWindForm, soleMachineId, lastWindDefaults]
  );

  const submitPlan = useCallback(() => {
    const v = validatePlan(planForm, beamWeavingLinkRequired);
    if (!v.ok) return setFormError(v.message);
    setFormError(null);
    const fingerprint = planFingerprint({ warpSpecId: planForm.warpSpecId ?? '', originKind: planForm.originKind, plannedLengthM: toNum(planForm.plannedLengthM) });
    mutations.plan.mutate({ form: planForm, token: tokenForBeam(attemptRef.current, fingerprint), fingerprint });
  }, [planForm, mutations.plan, attemptRef, beamWeavingLinkRequired]);

  const submitWind = useCallback(() => {
    if (current?.kind !== 'wind' || !windForm) return;
    const v = validateWind(windForm, current.beam.originKind, lotRequired);
    if (!v.ok) return setFormError(v.message);
    setFormError(null);
    const fingerprint = windFingerprint({ beamId: current.beam.id, lengthM: toNum(windForm.lengthM) });
    mutations.wind.mutate({ beamId: current.beam.id, originKind: current.beam.originKind, form: windForm, token: tokenForBeam(attemptRef.current, fingerprint), fingerprint, weavingOrderId: current.beam.weavingOrderId ?? undefined });
  }, [current, windForm, mutations.wind, attemptRef, lotRequired]);

  /** Çakışma modalı "yeni olarak gönder": yapışan token düşer, aynı yük taze token'la gider. */
  const resendAsNew = useCallback(() => {
    attemptRef.current = null;
    if (current?.kind === 'plan') submitPlan();
    else if (current?.kind === 'wind') submitWind();
  }, [attemptRef, current, submitPlan, submitWind]);

  return { planForm, setPlanForm, windForm, setWindForm, formError, clearFormError: () => setFormError(null), openPlan, openWind, submitPlan, submitWind, resendAsNew };
}
