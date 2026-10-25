// =============================================================================
// useKk1Inspection — KK1 doğuş muayenesinin konak durumu (K4P-TABLET)
// =============================================================================
// Kapı + taslak + metre girişi + önizleme tek yerde; KK1Screen yalnız düğme, sağ panel,
// öneri çipi ve gövde parçasını bağlar (3000+ satırlık ekrana mantık taşınmaz).
// =============================================================================
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { defectTypeService } from '../../../services/defectType.service';
import { useKaliteGuvenceEnabled } from '../../../hooks/useFeatureFlags';
import { usePermissions } from '../../../hooks/usePermission';
import { useSessionStore } from '../../../store/sessionStore';
import { draftCounts, type InspectionDraft, type DraftAction } from '../../../components/inspection/inspectionDraft';
import { useInspectionDraft, useInspectionDraftStore } from '../../../components/inspection/inspectionDraftStore';
import type { InspectionDefect, InspectionDefectInput, InspectionSummary } from '../../../components/inspection/InspectionPanel';
import { useInspectionPreview, type PreviewState } from '../../../components/inspection/useInspectionPreview';
import type { DefectType } from '../../../types/models';
import { kk1BirthInspectionPayload, kk1InspectionDraftKey, kk1InspectionVisible } from './kk1InspectionHost';

interface Args {
  itemId: string;
  widthCm: number | null;
  /** Formdaki metraj (manuel mod); makineden okumada bilinmez → önizleme metre bekler. */
  lengthM: number | null;
  isOnline: boolean;
}

const newId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function previewNote(p: PreviewState): string | null {
  if (p.status === 'error') return 'Öneri hesaplanamadı';
  if (p.status === 'needs-length') return 'Kumaş ve metraj girilince /100 m² hesaplanır';
  return null;
}

export function useKk1Inspection({ itemId, widthCm, lengthM, isOnline }: Args) {
  const moduleEnabled = useKaliteGuvenceEnabled();
  const { has } = usePermissions();
  const station = useSessionStore((s) => s.active?.station);
  const visible = kk1InspectionVisible({ moduleEnabled, hasPermission: has, station });
  const key = kk1InspectionDraftKey(station?.id);
  const draft = useInspectionDraft(key);
  const [open, setOpen] = useState(false);
  const [meterInput, setMeterInput] = useState('');

  const typesQuery = useQuery({
    queryKey: ['defect-types', 'active'],
    queryFn: () => defectTypeService.list({ pageSize: 100 }),
    staleTime: 10 * 60 * 1000,
    enabled: visible,
  });
  const defectTypes: DefectType[] = useMemo(() => typesQuery.data?.data ?? [], [typesQuery.data]);

  const dispatch = useCallback((a: DraftAction) => useInspectionDraftStore.getState().dispatch(key, a), [key]);
  const onDefect = useCallback(
    (input: InspectionDefectInput) => {
      const fixedPoints = defectTypes.find((d) => d.id === input.defectTypeId)?.fixedPoints ?? null;
      dispatch({ type: 'add', id: newId(), defectTypeId: input.defectTypeId, meter: input.meter, sizeClass: input.sizeClass, fixedPoints });
      setMeterInput('');
    },
    [defectTypes, dispatch],
  );

  const preview = useInspectionPreview({
    enabled: visible && open,
    target: itemId ? { draft: { itemId, widthCm } } : null,
    draft,
    lengthM,
    isOnline,
  });

  // Cetvel yalnız konumlu kayıtları çizer; konumsuzlar SON KAYITLAR listesinde.
  const ownDefects: InspectionDefect[] = useMemo(
    () =>
      draft.defects
        .filter((d) => d.meter != null)
        .map((d) => ({ id: d.id, startMeter: d.meter as number, defectTypeId: d.defectTypeId, errorType: defectTypes.find((t) => t.id === d.defectTypeId)?.name ?? null })),
    [draft.defects, defectTypes],
  );

  const summary: InspectionSummary = {
    ...draftCounts(draft),
    per100M2: preview.data?.pointsPer100M2 ?? null,
    widthSource: preview.data?.widthSource ?? null,
    offline: !isOnline,
    previewNote: previewNote(preview),
  };

  return {
    visible,
    open: visible && open,
    setOpen,
    key,
    draft,
    dispatch,
    defectTypes,
    meterInput,
    setMeterInput,
    onDefect,
    ownDefects,
    summary,
    preview,
    /** Gövde parçası (kapalı/boş → {}). */
    payload: () => kk1BirthInspectionPayload(draft, visible),
    /** Kayıt kuyruğa/uçuşa girdi: taslak gövdeyle gitti, ekrandan temizlenir. Geri dönüş için önceki taslak. */
    takeDraft: (): InspectionDraft => {
      const prev = draft;
      dispatch({ type: 'clear' });
      return prev;
    },
    restoreDraft: (prev: InspectionDraft) => useInspectionDraftStore.getState().restore(key, prev),
  };
}

export type Kk1Inspection = ReturnType<typeof useKk1Inspection>;
