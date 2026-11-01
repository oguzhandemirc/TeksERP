// =============================================================================
// useStandaloneInspection — bağımsız Muayene ekranının konak durumu (K4P-EKRAN)
// =============================================================================
// Okut → top → durum önizlemesi (aktif muayene + en) → taslak → KAYDET. Token mantıksal
// deneme başına (`useAttemptToken`): belirsiz hatada yapışır, kesin 4xx'te ve yeni topta yenilenir.
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { defectTypeService } from '../../../services/defectType.service';
import { rollService } from '../../../services/roll.service';
import { qualityInspectionService } from '../../../services/qualityInspection.service';
import { useKaliteGuvenceEnabled } from '../../../hooks/useFeatureFlags';
import { usePermissions } from '../../../hooks/usePermission';
import { useSessionStore } from '../../../store/sessionStore';
import { useIsOnline } from '../../../offline/hooks';
import { useAttemptToken } from '../../../offline/attemptToken';
import { draftCounts, type DraftAction, type InspectionDraft } from '../../../components/inspection/inspectionDraft';
import { useInspectionDraft, useInspectionDraftStore } from '../../../components/inspection/inspectionDraftStore';
import type { InspectionDefect, InspectionDefectInput, InspectionSummary } from '../../../components/inspection/InspectionPanel';
import { useInspectionPreview } from '../../../components/inspection/useInspectionPreview';
import { fmtPer100 } from '../../../components/inspection/InspectionSummaryStrip';
import type { DefectType, Roll } from '../../../types/models';
import { useAmbiguousScanPicker } from '../../../components/customerCode/CustomerCodeCandidateModal';
import { saveErrorText, standaloneCreateBody, standaloneDraftKey, standaloneInspectionVisible } from './standaloneInspectionHost';

const newId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const NO_ROLL_KEY = standaloneDraftKey('none');

/** Okutma: barkod → top. */
function useRollScan() {
  const [barcode, setBarcode] = useState('');
  const [roll, setRoll] = useState<Roll | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Belirsiz müşteri barkodu → aday modalı; seçim topun İÇ barkoduyla yeniden okutulur.
  const scanRef = useRef<(code: string) => Promise<void>>(async () => {});
  const ambiguous = useAmbiguousScanPicker((b) => void scanRef.current(b));
  const intercept = ambiguous.intercept;
  const scan = useCallback(
    async (code: string) => {
      const c = code.trim();
      if (!c) return;
      setBusy(true);
      setError(null);
      try {
        const res = await rollService.getByBarcode(c);
        setRoll(res.data);
        setBarcode('');
      } catch (e) {
        if (intercept(e)) return;
        const st = (e as { status?: number }).status;
        setError(st === 404 ? `${c} — top bulunamadı` : st === undefined ? 'Sunucuya ulaşılamıyor — top okunamadı' : (e as Error).message || 'Top okunamadı');
      } finally {
        setBusy(false);
      }
    },
    [intercept],
  );
  scanRef.current = scan;
  return { barcode, setBarcode, roll, setRoll, scan, scanBusy: busy, scanError: error, ambiguousModal: ambiguous.modal };
}

interface SaveArgs {
  roll: Roll | null;
  draft: InspectionDraft;
  station: { id: string; canInspect?: unknown } | null | undefined;
  onSaved: () => void;
  onActiveConflict: () => void;
}

/** KAYDET: token denemenin; başarıda taslak temizlenir, 409 aktif muayenede durum tazelenir. */
function useStandaloneSave({ roll, draft, station, onSaved, onActiveConflict }: SaveArgs) {
  const [error, setError] = useState<string | null>(null);
  const attempt = useAttemptToken();
  const rollId = roll?.id;
  // Başka top okutuldu = yeni mantıksal deneme (önceki topun belirsiz token'ı taşınmaz).
  useEffect(() => attempt.renew(), [attempt, rollId]);
  const m = useMutation({
    mutationFn: () => qualityInspectionService.create(standaloneCreateBody(roll!.id, draft, attempt.token(), station)),
    onSuccess: (res) => {
      attempt.onSuccess();
      const row = res.data;
      const per = fmtPer100(row.pointsPer100M2);
      Toast.show({ type: 'success', text1: `${roll?.barcode ?? 'Top'} muayenesi kaydedildi`, text2: `${row.totalPoints} puan${per ? ` · ${per} /100 m²` : ''}${row.suggestedGradeCode ? ` · öneri ${row.suggestedGradeCode}` : ''}` });
      setError(null);
      onSaved();
    },
    onError: (err) => {
      attempt.onFailure(err);
      setError(saveErrorText(err));
      if ((err as { details?: { code?: string } }).details?.code === 'INSPECTION_ALREADY_ACTIVE') onActiveConflict();
    },
  });
  return { save: () => m.mutate(), saving: m.isPending, saveError: error, clearError: () => setError(null) };
}

/** Taslak + metre girişi + cetvel kayıtları (KK1 konağıyla aynı biçim; bileşen tek). */
function useDraftEntry(key: string, defectTypes: DefectType[]) {
  const draft = useInspectionDraft(key);
  const [meterInput, setMeterInput] = useState('');
  const dispatch = useCallback((a: DraftAction) => useInspectionDraftStore.getState().dispatch(key, a), [key]);
  const onDefect = useCallback(
    (input: InspectionDefectInput) => {
      const fixedPoints = defectTypes.find((d) => d.id === input.defectTypeId)?.fixedPoints ?? null;
      dispatch({ type: 'add', id: newId(), defectTypeId: input.defectTypeId, meter: input.meter, sizeClass: input.sizeClass, fixedPoints });
      setMeterInput('');
    },
    [defectTypes, dispatch],
  );
  const ownDefects: InspectionDefect[] = useMemo(
    () =>
      draft.defects
        .filter((d) => d.meter != null)
        .map((d) => ({ id: d.id, startMeter: d.meter as number, defectTypeId: d.defectTypeId, errorType: defectTypes.find((t) => t.id === d.defectTypeId)?.name ?? null })),
    [draft.defects, defectTypes],
  );
  return { draft, dispatch, meterInput, setMeterInput, onDefect, ownDefects };
}

export function useStandaloneInspection() {
  const moduleEnabled = useKaliteGuvenceEnabled();
  const { has } = usePermissions();
  const visible = standaloneInspectionVisible({ moduleEnabled, hasPermission: has });
  const station = useSessionStore((s) => s.active?.station);
  const isOnline = useIsOnline();
  const qc = useQueryClient();
  const scan = useRollScan();
  const roll = scan.roll;

  const typesQuery = useQuery({
    queryKey: ['defect-types', 'active'],
    queryFn: () => defectTypeService.list({ pageSize: 100 }),
    staleTime: 10 * 60 * 1000,
    enabled: visible,
  });
  const defectTypes: DefectType[] = useMemo(() => typesQuery.data?.data ?? [], [typesQuery.data]);
  const entry = useDraftEntry(roll ? standaloneDraftKey(roll.id) : NO_ROLL_KEY, defectTypes);

  // Durum = boş önizleme: aktif muayene + en + aşama (liste ucu `inspection:read` ister, tablet operatörü taşımaz).
  const statusQuery = useQuery({
    queryKey: ['inspection-standalone-status', roll?.id],
    queryFn: () => qualityInspectionService.preview({ rollId: roll!.id, defects: [] }),
    enabled: visible && !!roll && isOnline,
    staleTime: 0,
  });
  const status = statusQuery.data?.data ?? null;
  const active = status?.activeInspection ?? null;
  const preview = useInspectionPreview({ enabled: visible && !!roll && !active, target: roll ? { rollId: roll.id } : null, draft: entry.draft, lengthM: null, isOnline });

  const saver = useStandaloneSave({
    roll,
    draft: entry.draft,
    station,
    onSaved: () => {
      entry.dispatch({ type: 'clear' });
      scan.setRoll(null);
      void qc.invalidateQueries({ queryKey: ['inspection-standalone-status'] });
    },
    onActiveConflict: () => void statusQuery.refetch(),
  });

  const summary: InspectionSummary = {
    ...draftCounts(entry.draft),
    per100M2: preview.data?.pointsPer100M2 ?? null,
    widthSource: preview.data?.widthSource ?? status?.widthSource ?? null,
    offline: !isOnline,
    previewNote: preview.status === 'error' ? 'Öneri hesaplanamadı' : null,
  };

  return {
    ...scan,
    ...entry,
    ...saver,
    visible,
    isOnline,
    /** Okutmayı bırak: taslak top anahtarında kalır, aynı top yeniden okutulunca döner. */
    reset: () => {
      scan.setRoll(null);
      saver.clearError();
    },
    status,
    statusLoading: statusQuery.isLoading,
    active,
    defectTypes,
    summary,
    preview,
  };
}

export type StandaloneInspection = ReturnType<typeof useStandaloneInspection>;
