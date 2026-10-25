// Canlı önizleme: gövde ~400 ms durulunca `POST /api/cost/preview` (YAZMAZ). Sayı yalnız yanıttan gelir.
// Durulma gövdenin METNİ üzerinden: çağıran her render'da yeni nesne kursa da zamanlayıcı yeniden kurulmaz,
// aynı gövdeye ikinci istek atılmaz; eski yanıt yenisi gelene dek kalır.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { previewCost, type PreviewBody } from "../Items/service";

export const PREVIEW_DEBOUNCE_MS = 400;

export function useCostPreview(body: PreviewBody | null) {
  const settled = useDebouncedValue(body ? JSON.stringify(body) : null, PREVIEW_DEBOUNCE_MS);
  return useQuery({
    queryKey: ["cost-preview", settled],
    queryFn: () => previewCost(JSON.parse(settled!) as PreviewBody),
    enabled: settled !== null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
