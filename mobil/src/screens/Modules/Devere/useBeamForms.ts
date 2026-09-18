// =============================================================================
// PLAN / SAR formları — durum + doğrulama + gönderim (token deneme başına bir kez)
// =============================================================================
import { useCallback, useState, type MutableRefObject } from 'react';
import type { WarpBeam } from '../../../services/warpBeam.service';
import { planFingerprint, tokenForBeam, windFingerprint, type BeamAttempt } from './devereAttempt';
import { EMPTY_PLAN, initialWindForm, validatePlan, validateWind, type PlanForm, type WindForm } from './beamPayload';
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
}

const toNum = (s: string): number => Number(s.replace(',', '.'));

export function useBeamForms({ attemptRef, mutations, defaultWarehouseId, open, current, lotRequired }: Deps) {
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
    setPlanForm(EMPTY_PLAN);
    open({ kind: 'plan' });
  }, [open, setPlanForm]);

  const openWind = useCallback(
    (beam: WarpBeam) => {
      setWindForm(initialWindForm(beam, defaultWarehouseId));
      open({ kind: 'wind', beam });
    },
    [defaultWarehouseId, open, setWindForm]
  );

  const submitPlan = useCallback(() => {
    const v = validatePlan(planForm);
    if (!v.ok) return setFormError(v.message);
    setFormError(null);
    const fingerprint = planFingerprint({ warpSpecId: planForm.warpSpecId ?? '', originKind: planForm.originKind, plannedLengthM: toNum(planForm.plannedLengthM) });
    mutations.plan.mutate({ form: planForm, token: tokenForBeam(attemptRef.current, fingerprint), fingerprint });
  }, [planForm, mutations.plan, attemptRef]);

  const submitWind = useCallback(() => {
    if (current?.kind !== 'wind' || !windForm) return;
    const v = validateWind(windForm, current.beam.originKind, lotRequired);
    if (!v.ok) return setFormError(v.message);
    setFormError(null);
    const fingerprint = windFingerprint({ beamId: current.beam.id, lengthM: toNum(windForm.lengthM) });
    mutations.wind.mutate({ beamId: current.beam.id, originKind: current.beam.originKind, form: windForm, token: tokenForBeam(attemptRef.current, fingerprint), fingerprint });
  }, [current, windForm, mutations.wind, attemptRef, lotRequired]);

  /** Çakışma modalı "yeni olarak gönder": yapışan token düşer, aynı yük taze token'la gider. */
  const resendAsNew = useCallback(() => {
    attemptRef.current = null;
    if (current?.kind === 'plan') submitPlan();
    else if (current?.kind === 'wind') submitWind();
  }, [attemptRef, current, submitPlan, submitWind]);

  return { planForm, setPlanForm, windForm, setWindForm, formError, clearFormError: () => setFormError(null), openPlan, openWind, submitPlan, submitWind, resendAsNew };
}
