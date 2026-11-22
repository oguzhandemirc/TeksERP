// "Bu durumda" hücresi (devere S4) — yaş sunucuda fabrika gününden türer; istemci yalnız biçimler.
// Eski backend alanı göndermezse "—". `staleAt` eşiği aşılınca uyarı rengi (bilgi; engel değil).
import type { FilterDef } from "@/components/data-table/FilterBar";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { formatFactory } from "@/lib/factory-time";
import { cn } from "@/lib/utils";

export function statusAgeText(days: number | undefined): string {
  if (days === undefined) return "—";
  return days === 0 ? "Bugün" : `${days} gün`;
}

export function StatusAgeCell({ days, since, staleAt }: { days?: number; since?: string; staleAt?: number | null }) {
  if (days === undefined) return <span className="text-muted-foreground">—</span>;
  const stale = staleAt != null && days >= staleAt;
  return (
    <span className={cn("tabular-nums text-sm", stale && "font-medium text-warning")} title={since ? `Bu duruma giriş: ${formatFactory(since, "dd.MM.yyyy HH:mm")}` : undefined}>
      {statusAgeText(days)}
    </span>
  );
}

/** Eşik sistem ayarından (`devere.staleFullBeamDays` / `devere.staleOutBodyDays`) — özet şeridiyle aynı kaynak.
 *  Bayrak yüklenmemiş ya da eski backend alanı göndermiyorsa renk yok (istemci eşik uydurmaz). */
export function DevereStaleAgeCell({ days, since, watch, kind }: { days?: number; since?: string; watch: boolean; kind: "fullBeam" | "outBody" }) {
  const flags = useFeatureFlags().data?.data;
  const threshold = kind === "fullBeam" ? flags?.devereStaleFullBeamDays : flags?.devereStaleOutBodyDays;
  return <StatusAgeCell days={days} since={since} staleAt={watch && typeof threshold === "number" ? threshold : null} />;
}

/** Ortak süzgeç çipi: `minAgeDays` (sunucu süzer; liste + özet aynı where). */
export function minAgeFilter(options: number[]): FilterDef {
  return { kind: "select", key: "minAgeDays", label: "Bu durumda", options: options.map((d) => ({ value: String(d), label: `${d}+ gün` })) };
}
