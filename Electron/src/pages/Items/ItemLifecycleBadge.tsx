// =============================================================================
// DURUM ROZETİ — Aktif · "Tükenene kadar · N top kaldı" / "Pasife hazır" · Pasif (§8)
// =============================================================================
// Kalan sayı yalnız Tükenene kadar kartta sorulur (`/items/lifecycle-summary`); anahtar
// ["items", …] altında — kart mutasyonları listeyle birlikte tazeler.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { ITEM_LIFECYCLE_LABEL, itemLifecycleOf } from "@/lib/item-lifecycle";
import { itemService } from "./service";
import type { Item } from "./types";

/** Rozet metni — Excel/PDF dışa aktarımı da bunu yazar (kalan sayı olmadan). */
export const itemLifecycleExportText = (it: Item): string => ITEM_LIFECYCLE_LABEL[itemLifecycleOf(it)];

export function phaseOutBadgeText(summary: { liveTotal: number; rolls: number } | undefined): string {
  if (!summary) return "Tükenene kadar";
  if (summary.liveTotal === 0) return "Tükenene kadar · Pasife hazır";
  return summary.rolls > 0 ? `Tükenene kadar · ${summary.rolls} top kaldı` : `Tükenene kadar · ${summary.liveTotal} kayıt kaldı`;
}

function PhaseOutBadge({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["items", "lifecycle-summary", id],
    queryFn: () => itemService.lifecycleSummary([id]),
    staleTime: 30_000,
  });
  return (
    <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-300">
      {phaseOutBadgeText(q.data?.data?.[0])}
    </Badge>
  );
}

export function ItemLifecycleBadge({ item }: { item: Item }) {
  const s = itemLifecycleOf(item);
  if (s === "PHASE_OUT") return <PhaseOutBadge id={item.id} />;
  return s === "ACTIVE" ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>;
}
