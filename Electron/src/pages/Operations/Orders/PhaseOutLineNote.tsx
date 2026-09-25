// =============================================================================
// "TÜKENENE KADAR" SATIR NOTU — sipariş kaleminin yanında sarı tek satır (URUN-YASAM-DONGUSU §8, A2)
// =============================================================================
// Kart bilgisi ürün seçicinin etiket sorgusuyla AYNI anahtardan okunur (ikinci istek yok).
// Sunucu kaydın kendisinde yine karar verir; bu not yalnız operatörü önceden uyarır.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { itemLifecycleOf } from "@/lib/item-lifecycle";
import { DEFAULT_PHASE_OUT_LINE_QTY, PHASE_OUT_LINE_NOTE } from "@/lib/item-lifecycle-flags";
import { itemService } from "@/pages/Items/service";

export function PhaseOutLineNote({ itemId }: { itemId: string | null }) {
  const item = useQuery({
    queryKey: ["items", "ref-select-by-id", itemId],
    queryFn: () => itemService.getById(itemId as string),
    enabled: Boolean(itemId),
    staleTime: 5 * 60_000,
  });
  const mode = useFeatureFlags().data?.data?.itemPhaseOutLineQty ?? DEFAULT_PHASE_OUT_LINE_QTY;
  const it = item.data?.data;
  if (!it || itemLifecycleOf(it) !== "PHASE_OUT") return null;
  return (
    <p role="note" className="text-xs text-amber-700 dark:text-amber-400">
      {PHASE_OUT_LINE_NOTE[mode]}
    </p>
  );
}
