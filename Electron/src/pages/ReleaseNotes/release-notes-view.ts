import { ArrowUpCircle, Sparkles, Wrench } from "lucide-react";
import { foldedIncludes } from "@/lib/search-fold";
import type { ReleaseEntry, ReleaseItem, ReleaseItemScope, ReleaseItemType } from "@/lib/surum-notlari";

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

const dateFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" });

/** Tarih kimliğini ("2026-08-28", "2026-08-28b") okunur başlığa çevirir. */
export function formatReleaseDate(id: string): string {
  const t = new Date(id.slice(0, 10));
  if (Number.isNaN(t.getTime())) return id;
  return dateFmt.format(t);
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
