// Cariler — rol özet şeridi: dört tıklanır sayı kartı (Tümü · Müşteri · Tedarikçi · Fason). Tık, süzgeci
// URL'e yazar (Yön × Fason ile aynı anahtarlar) → liste ve sayılar aynı sunucu süzgecinden.
import { useSearchParams } from "react-router-dom";
import { Factory, ShoppingBag, Truck, Users2, type LucideIcon } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import type { IconTileTone } from "@/components/ui/icon-tile";
import { cn } from "@/lib/utils";
import { formatDisplay } from "@/lib/format";
import { partnerRoleLabels, type DirectionFilter, type SubcontractorFilter } from "@/lib/partnerRoles";
import type { CariFilters } from "../carilerPaging";
import type { CariRoleCounts } from "./useCariRoleCounts";

type ChipKey = keyof CariRoleCounts;
interface Chip { key: ChipKey; label: string; icon: LucideIcon; tone: IconTileTone; direction: DirectionFilter; subcontractor: SubcontractorFilter }

export const ROLE_CHIPS: readonly Chip[] = [
  { key: "all", label: "Tüm cariler", icon: Users2, tone: "violet", direction: "ALL", subcontractor: "ALL" },
  { key: "customer", label: partnerRoleLabels.customer, icon: ShoppingBag, tone: "blue", direction: "CUSTOMER", subcontractor: "ALL" },
  { key: "supplier", label: partnerRoleLabels.supplier, icon: Truck, tone: "amber", direction: "SUPPLIER", subcontractor: "ALL" },
  { key: "subcontractor", label: partnerRoleLabels.subcontractor, icon: Factory, tone: "teal", direction: "ALL", subcontractor: "YES" },
];

/** Süzgeç çiftine karşılık gelen kart (yoksa null — ör. "Müşteri + Tedarikçi" seçiliyken). */
export function activeChip(f: CariFilters): ChipKey | null {
  return ROLE_CHIPS.find((c) => c.direction === f.direction && c.subcontractor === f.subcontractor)?.key ?? null;
}

export function CariRoleStrip({ filters, counts, loading }: { filters: CariFilters; counts: CariRoleCounts | undefined; loading: boolean }) {
  const [, setSearchParams] = useSearchParams();
  const active = activeChip(filters);
  const pick = (c: Chip) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const set = (k: string, v: string) => (v === "ALL" ? next.delete(k) : next.set(k, v));
        set("filter[direction]", c.direction);
        set("filter[subcontractor]", c.subcontractor);
        return next;
      },
      { replace: true },
    );
  return (
    <div className="grid shrink-0 grid-cols-2 gap-3 px-[var(--list-inset)] py-3 lg:grid-cols-4">
      {ROLE_CHIPS.map((c) => (
        <StatCard
          key={c.key}
          label={c.label}
          value={counts ? formatDisplay(counts[c.key], 0) : "—"}
          loading={loading}
          icon={c.icon}
          tone={c.tone}
          onClick={() => pick(c)}
          className={cn("py-3", active === c.key && "border-primary/60 ring-2 ring-primary/25")}
        />
      ))}
    </div>
  );
}
