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
}

const toNum = (s: string): number => Number(s.replace(',', '.'));

export function useBeamForms({ attemptRef, mutations, defaultWarehouseId, open, current }: Deps) {
  const [planForm, setPlanForm] = useState<PlanForm>(EMPTY_PLAN);
  const [windForm, setWindForm] = useState<WindForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const openPlan = useCallback(() => {
    setPlanForm(EMPTY_PLAN);
    setFormError(null);
    open({ kind: 'plan' });
  }, [open]);

  const openWind = useCallback(
    (beam: WarpBeam) => {
      setWindForm(initialWindForm(beam, defaultWarehouseId));
      setFormError(null);
      open({ kind: 'wind', beam });
    },
    [defaultWarehouseId, open]
  );

  const submitPlan = useCallback(() => {
    const v = validatePlan(planForm);
    if (!v.ok) return setFormError(v.message);
    const fingerprint = planFingerprint({ warpSpecId: planForm.warpSpecId ?? '', originKind: planForm.originKind, plannedLengthM: toNum(planForm.plannedLengthM) });
    mutations.plan.mutate({ form: planForm, token: tokenForBeam(attemptRef.current, fingerprint), fingerprint });
  }, [planForm, mutations.plan, attemptRef]);

  const submitWind = useCallback(() => {
    if (current?.kind !== 'wind' || !windForm) return;
    const v = validateWind(windForm, current.beam.originKind);
    if (!v.ok) return setFormError(v.message);
    const fingerprint = windFingerprint({ beamId: current.beam.id, lengthM: toNum(windForm.lengthM) });
    mutations.wind.mutate({ beamId: current.beam.id, originKind: current.beam.originKind, form: windForm, token: tokenForBeam(attemptRef.current, fingerprint), fingerprint });
  }, [current, windForm, mutations.wind, attemptRef]);

  /** Çakışma modalı "yeni olarak gönder": yapışan token düşer, aynı yük taze token'la gider. */
  const resendAsNew = useCallback(() => {
    attemptRef.current = null;
    if (current?.kind === 'plan') submitPlan();
    else if (current?.kind === 'wind') submitWind();
  }, [attemptRef, current, submitPlan, submitWind]);

  return { planForm, setPlanForm, windForm, setWindForm, formError, clearFormError: () => setFormError(null), openPlan, openWind, submitPlan, submitWind, resendAsNew };
}
