import { ArrowUpCircle, Sparkles, Wrench } from "lucide-react";
import { foldedIncludes } from "@/lib/search-fold";
import type { ReleaseEntry, ReleaseItem, ReleaseItemScope, ReleaseItemType } from "@/lib/surum-notlari";
import { formatFactory } from "@/lib/factory-time";

export const TYPE_ORDER: ReleaseItemType[] = ["yeni", "iyilestirme", "duzeltme"];

export const TYPE_VIEW: Record<
  ReleaseItemType,
  { icon: typeof Sparkles; className: string; label: string; lower: string; plural: string }
> = {
  yeni: { icon: Sparkles, className: "text-success", label: "Yeni", lower: "yeni", plural: "Yenilikler" },
  iyilestirme: {
    icon: ArrowUpCircle,
    className: "text-info",
    label: "İyileştirme",
    lower: "iyileştirme",
    plural: "İyileştirmeler",
  },
  duzeltme: {
    icon: Wrench,
    className: "text-warning",
    label: "Düzeltme",
    lower: "düzeltme",
    plural: "Düzeltmeler",
  },
};

export const SCOPE_LABEL: Record<ReleaseItemScope, string> = {
  panel: "Panel",
  tablet: "Tablet",
  "her-ikisi": "Panel + Tablet",
};


/** Tarih kimliğini ("2026-08-28", "2026-08-28b") okunur başlığa çevirir. */
export function formatReleaseDate(id: string): string {
  // Kimlik bir TAKVİM günüdür (an değil): dilim uygulanmaz.
  return formatFactory(`${id.slice(0, 10)}T00:00:00Z`, "d MMMM yyyy", id, "UTC");
}

export type ScopeFilter = "all" | "panel" | "tablet";

function scopeMatches(item: ReleaseItem, scope: ScopeFilter): boolean {
  return scope === "all" || item.kapsam === scope || item.kapsam === "her-ikisi";
}

/**
 * Sayfanın süzgeci — kapsam + arama. Madde süzülür; maddesi kalmayan yayın
 * listeden düşer. Arama başlıkta tutarsa yayının (kapsama uyan) tüm maddeleri kalır.
 */
export function filterReleases(entries: ReleaseEntry[], scope: ScopeFilter, query: string): ReleaseEntry[] {
  const q = query.trim();
  return entries
    .map((entry) => {
      const scoped = entry.maddeler.filter((m) => scopeMatches(m, scope));
      if (!q || foldedIncludes(entry.baslik, q)) return { ...entry, maddeler: scoped };
      return { ...entry, maddeler: scoped.filter((m) => foldedIncludes(m.metin, q)) };
    })
    .filter((entry) => entry.maddeler.length > 0);
}

export function countByType(entry: ReleaseEntry): Record<ReleaseItemType, number> {
  const counts: Record<ReleaseItemType, number> = { yeni: 0, iyilestirme: 0, duzeltme: 0 };
  for (const m of entry.maddeler) counts[m.tip] += 1;
  return counts;
}
