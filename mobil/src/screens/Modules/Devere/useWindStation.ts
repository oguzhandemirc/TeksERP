// =============================================================================
// LEVENT SAR İSTASYONU ekran-hook'u — form durumu · okutma · plan→sar zinciri · etiket kuyruğu
// =============================================================================
// Sarım ONLINE-ONLY: levent no sunucuda doğar (plan) ve iplik çıkışı deftere yazar; eksi-bakiye
// kapısı sunucudadır — kuyrukta bekleyen sarım boşalırken sessiz 409 üretirdi (useBeamMutations).
// Token `devereAttempt` (deneme başına, yalnız belirsiz hatada yapışır); hata sınıfı
// `classifyBeamFailure` mevcut mutasyonlardan. Plan doğup sar düşerse hedef o levent olur.
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import Toast from 'react-native-toast-message';
import type { TabletContext, WarpBeam } from '../../../services/warpBeam.service';
import { signalScan } from '../../../services/scanFeedback';
import { planFingerprint, tokenForBeam, windFingerprint, type BeamAttempt } from './devereAttempt';
import { lastPlannedWarpSpecId, soleMachineId, soleWeavingOrderId } from './beamPayload';
import { useBeamMutations } from './useBeamMutations';
import { useBeamLabelQueue } from './beamLabelQueue';
import {
  afterPlanCreated,
  afterWind,
  applyStationScan,
  defaultWarpSpecId,
  initialStationForm,
  resolveStationScan,
  resolveTarget,
  stationPlanForm,
  toWindForm,
  validateStation,
  type StationDeps,
  type StationForm,
  type StationSpec,
  type StationTarget,
} from './windStation';

interface Deps {
  context: TabletContext | undefined;
  planned: readonly WarpBeam[];
  /** Bugün sarılanlar — okutulan levent no'yu tanımak + son kart önerisi için. */
  recent: readonly WarpBeam[];
  isOnline: boolean;
}

const toNum = (s: string): number => Number(s.replace(',', '.'));

interface SubmitDeps {
  form: StationForm | null;
  context: TabletContext | undefined;
  spec: StationSpec | null;
  target: WarpBeam | null;
  isOnline: boolean;
  setFormState: Dispatch<SetStateAction<StationForm | null>>;
  setError: (m: string | null) => void;
  onWound: (beamId: string) => void;
  onPlanned: (beam: WarpBeam) => void;
}

/** SAR: doğrula → (hedef yoksa) plan → sar; sar OK → etiket kuyruğu. Token deneme başına (`devereAttempt`). */
function useStationSubmit({ form, context, spec, target, isOnline, setFormState, setError, onWound, onPlanned }: SubmitDeps) {
  const attemptRef = useRef<BeamAttempt | null>(null);
  const onCollision = useCallback(
    (message: string) => {
      attemptRef.current = null;
      setError(`${message} — SAR'a yeniden basın (yeni deneme).`);
    },
    [setError]
  );
  const mutations = useBeamMutations({ attemptRef, onDone: () => {}, onCollision });

  const windBeam = useCallback(
    (beamId: string, f: StationForm) => {
      const fingerprint = windFingerprint({ beamId, lengthM: toNum(f.lengthM) });
      mutations.wind.mutate(
        { beamId, originKind: 'IN_HOUSE', form: toWindForm(f, spec), token: tokenForBeam(attemptRef.current, fingerprint), fingerprint },
        {
          onSuccess: (res) => {
            const q = useBeamLabelQueue.getState();
            if (res.data) q.enqueue(res.data.id, res.data.beamNo);
            for (const s of res.data?.siblings ?? []) q.enqueue(s.id, s.beamNo);
            onWound(beamId);
            setFormState((cur) => (cur ? afterWind(cur) : cur));
          },
        }
      );
    },
    [mutations.wind, spec, onWound, setFormState]
  );

  const submit = useCallback(() => {
    if (!form || !context) return;
    if (!isOnline) return setError('Bağlantı yok — sarım yalnız çevrimiçi kaydedilir (levent no sunucuda doğar).');
    const v = validateStation(form, spec, target, { lotRequired: context.lotRequired ?? false, beamWeavingLinkRequired: context.beamWeavingLinkRequired ?? false });
    if (!v.ok) return setError(v.message);
    setError(null);
    if (target) return windBeam(target.id, form);
    const fingerprint = planFingerprint({ warpSpecId: form.warpSpecId ?? '', originKind: 'IN_HOUSE', plannedLengthM: toNum(form.lengthM) });
    mutations.plan.mutate(
      { form: stationPlanForm(form), token: tokenForBeam(attemptRef.current, fingerprint), fingerprint },
      {
        onSuccess: (res) => {
          if (!res.data?.id) {
            Toast.show({ type: 'error', text1: 'Plan yanıtı eksik', text2: 'Listeyi yenileyip planlı leventi sarın.' });
            return;
          }
          const born = res.data;
          onPlanned(born);
          setFormState((cur) => (cur ? afterPlanCreated(cur, born.id) : cur));
          windBeam(born.id, form);
        },
      }
    );
  }, [form, context, isOnline, spec, target, windBeam, mutations.plan, setError, onPlanned, setFormState]);

  return { submit, busy: mutations.plan.isPending || mutations.wind.isPending };
}

export function useWindStation({ context, planned, recent, isOnline }: Deps) {
  const [form, setFormState] = useState<StationForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanValue, setScanValue] = useState('');
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  // Bu oturumda sarılan planlar — liste tazelenene kadar otomatik hedef onları yeniden seçmesin.
  const [woundIds, setWoundIds] = useState<readonly string[]>([]);
  // Bu oturumda doğan planlar — liste tazelenmeden sar düşerse tekrar SAR o leventi bulabilsin.
  const [created, setCreated] = useState<readonly WarpBeam[]>([]);

  const deps: StationDeps = useMemo(
    () => ({
      defaultWarehouseId: context?.warehouses.find((w) => w.isDefault)?.id ?? context?.warehouses[0]?.id ?? null,
      soleMachineId: soleMachineId(context?.machines ?? []),
      soleWeavingOrderId: soleWeavingOrderId(context?.weavingOrders),
      lastWindDefaults: context?.lastWindDefaults ?? [],
    }),
    [context]
  );

  // Bağlam gelince bir kez kurulur (son levent kartı ön-dolu); sonrası operatörün.
  useEffect(() => {
    if (form || !context) return;
    setFormState(initialStationForm(defaultWarpSpecId(lastPlannedWarpSpecId([...planned, ...recent]), deps, context.warpSpecs), deps));
  }, [form, context, deps, planned, recent]);

  const livePlanned = useMemo(
    () => [...planned, ...created.filter((c) => !planned.some((b) => b.id === c.id))].filter((b) => !woundIds.includes(b.id)),
    [planned, created, woundIds]
  );
  const spec: StationSpec | null = context?.warpSpecs.find((s) => s.id === form?.warpSpecId) ?? null;
  const target = form ? resolveTarget(form, livePlanned) : null;

  const patch = useCallback((p: Partial<StationForm>) => {
    setFormState((f) => (f ? { ...f, ...p } : f));
    setError(null);
  }, []);
  const selectSpec = useCallback(
    (id: string) => {
      setFormState((f) => initialStationForm(id, deps, f ? { lengthM: f.lengthM, kgSource: f.kgSource } : undefined));
      setError(null);
    },
    [deps]
  );
  const setTarget = useCallback((t: StationTarget) => patch({ target: t, physicalBeamNo: '' }), [patch]);

  const submitScan = useCallback(
    (raw: string) => {
      if (!form) return;
      const r = applyStationScan(form, resolveStationScan(raw, [...livePlanned, ...recent]), target);
      signalScan(r.outcome);
      setFormState(r.form);
      setScanMessage(r.message);
      setScanValue('');
      setError(null);
    },
    [form, livePlanned, recent, target]
  );

  const onWound = useCallback((id: string) => {
    setWoundIds((ids) => [...ids, id]);
    setScanMessage(null);
  }, []);
  const onPlanned = useCallback((b: WarpBeam) => setCreated((c) => [...c, b]), []);
  const { submit, busy } = useStationSubmit({ form, context, spec, target, isOnline, setFormState, setError, onWound, onPlanned });

  return { form, spec, target, livePlanned, error, patch, selectSpec, setTarget, scanValue, setScanValue, scanMessage, submitScan, submit, busy };
}

export type WindStationState = ReturnType<typeof useWindStation>;
