// Canlı etiket önizlemesi sorgusu (2026-11-10) — taslak 400 ms debounce'la gider; hata/ağ kopukluğunda son
// başarılı görüntü kalır (keepPreviousData) ve `stale` uyarısı döner. Kesimi hiçbir koşulda engellemez.
import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { tamburService, type TamburLabelPreview, type TamburLabelPreviewDraft } from '../../../services/tambur.service';

export const PREVIEW_DEBOUNCE_MS = 400;

export interface LivePreviewInput {
  rollId: string | null | undefined;
  orderLineId: string | null | undefined;
  customerId: string | null | undefined;
  consigneeId: string | null | undefined;
  /** Seçilen şablon — yalnız varsayılandan farklıysa dolu (`labelTemplateChoice.previewTemplateId`). */
  templateId?: string;
  draft: TamburLabelPreviewDraft;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useTamburLivePreview(i: LivePreviewInput): {
  preview: TamburLabelPreview | null;
  loading: boolean;
  /** Son istek başarısız — ekrandaki görüntü bir önceki taslağın. */
  stale: boolean;
  /** Son hatanın `details.code`u (ör. LABEL_TEMPLATE_NOT_OFFERED → seçim varsayılana döner). */
  errorCode: string | null;
  /** Son (hatalı olabilen) isteğin taşıdığı şablon — reddi yalnız O seçime uygulamak için. */
  requestTemplateId: string | null;
} {
  const body = useMemo(
    () =>
      i.rollId
        ? {
            rollId: i.rollId,
            orderLineId: i.orderLineId ?? null,
            customerId: i.orderLineId ? null : (i.customerId ?? null),
            consigneeId: i.consigneeId ?? null,
            ...(i.templateId ? { templateId: i.templateId } : {}),
            draft: i.draft,
          }
        : null,
    // Taslak her render yeni nesne — anahtar içerikten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [i.rollId, i.orderLineId, i.customerId, i.consigneeId, i.templateId, JSON.stringify(i.draft)],
  );
  const debounced = useDebounced(body, PREVIEW_DEBOUNCE_MS);
  const q = useQuery({
    queryKey: ['tambur', 'label-preview', debounced],
    queryFn: () => tamburService.labelPreview(debounced!),
    enabled: !!debounced,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
  });
  const code = (q.error as { details?: { code?: unknown } } | null)?.details?.code;
  return { preview: q.data ?? null, loading: q.isFetching, stale: q.isError, errorCode: typeof code === 'string' ? code : null,
    requestTemplateId: debounced?.templateId ?? null,
  };
}
