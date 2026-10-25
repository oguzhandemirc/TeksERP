// =============================================================================
// useInspectionPreview — 4 puan önizlemesi (K4P-TABLET, plan §4.1 md. 4)
// =============================================================================
// KONAKTA çağrılır (bileşen ağ çağrısı yapmaz). Taslak/metre/kumaş değişince 400 ms sonra
// `POST /quality-inspections/preview`. Yazmayan uç → asla kuyruğa girmez: çevrimdışı ya da hata
// `data=null` + durum; operatör kaliteyi bugünkü gibi seçer. Eski yanıt yenisini ezmez (sıra no).
// =============================================================================
import { useEffect, useRef, useState } from 'react';
import { qualityInspectionService, type InspectionPreview, type InspectionPreviewRequest } from '../../services/qualityInspection.service';
import type { InspectionDraft } from './inspectionDraft';
import { draftToWireDefects } from './inspectionWire';

export const PREVIEW_DEBOUNCE_MS = 400;

export type PreviewStatus = 'idle' | 'needs-length' | 'offline' | 'loading' | 'ok' | 'error';

export interface PreviewState {
  status: PreviewStatus;
  data: InspectionPreview | null;
}

export interface PreviewTarget {
  rollId?: string;
  draft?: { itemId: string; widthCm?: number | null };
}

interface Options {
  enabled: boolean;
  target: PreviewTarget | null;
  draft: InspectionDraft;
  /** Muayene uzunluğu: taslağın kendi değeri yoksa konağın metrajı. */
  lengthM: number | null;
  isOnline: boolean;
}

/** İstek gövdesi (saf) — null: hedef ya da uzunluk yok, çağrı yapılmaz. */
export function buildPreviewRequest(target: PreviewTarget | null, draft: InspectionDraft, lengthM: number | null): InspectionPreviewRequest | null {
  if (!target || (!target.rollId && !target.draft?.itemId)) return null;
  const length = draft.inspectedLengthM ?? lengthM;
  if (target.draft && !(length != null && length > 0)) return null;
  return {
    ...(target.rollId ? { rollId: target.rollId } : { draft: target.draft }),
    defects: draftToWireDefects(draft),
    ...(length != null && length > 0 ? { inspectedLengthM: length } : {}),
  };
}

export function useInspectionPreview({ enabled, target, draft, lengthM, isOnline }: Options): PreviewState {
  const [state, setState] = useState<PreviewState>({ status: 'idle', data: null });
  const seq = useRef(0);
  const request = enabled ? buildPreviewRequest(target, draft, lengthM) : null;
  const key = request ? JSON.stringify(request) : null;

  useEffect(() => {
    const mine = ++seq.current;
    if (!enabled) return setState({ status: 'idle', data: null });
    if (!key) return setState({ status: 'needs-length', data: null });
    if (!isOnline) return setState({ status: 'offline', data: null });
    setState((s) => ({ status: 'loading', data: s.data }));
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      qualityInspectionService
        .preview(JSON.parse(key) as InspectionPreviewRequest, ctrl.signal)
        .then((res) => {
          if (mine === seq.current) setState({ status: 'ok', data: res.data ?? null });
        })
        .catch(() => {
          if (mine === seq.current) setState({ status: 'error', data: null });
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [enabled, key, isOnline]);

  return state;
}
