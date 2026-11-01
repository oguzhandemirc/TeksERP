// Tezgâh önerisi görsel parçaları (SY-M3): kademe rozeti + sıralı aday listesi. Öneri SIRALAMADIR (K15) — engellemez.
import { cn } from "@/lib/utils";
import { LOOM_TIER_META, candidateDetail, type LoomCandidate, type LoomTier } from "./types";

export function LoomTierBadge({ tier, className }: { tier: LoomTier; className?: string }) {
  const m = LOOM_TIER_META[tier];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", m.tone, className)} title={m.label}>
      {m.short} · {m.label}
    </span>
  );
}

export function WidthWarningBadge() {
  return (
    <span className="rounded border border-warning/40 px-1.5 py-0.5 text-[11px] text-warning" title="Tarak eni ürün eninden dar">
      Tarak dar
    </span>
  );
}

/** Sıralı aday listesi; `limit` aşılırsa kalan sayısı yazılır. */
export function LoomCandidateList({ candidates, limit = 6 }: { candidates: readonly LoomCandidate[]; limit?: number }) {
  if (candidates.length === 0) return <p className="text-xs text-muted-foreground">Uygun tezgâh bulunamadı.</p>;
  const shown = candidates.slice(0, limit);
  return (
    <ul className="space-y-1" aria-label="Tezgâh önerisi">
      {shown.map((c) => (
        <li key={c.machineId} className="flex flex-wrap items-center gap-2 text-xs">
          <LoomTierBadge tier={c.tier} />
          <span className="font-mono font-medium">{c.code}</span>
          {c.name && c.name !== c.code && <span className="text-muted-foreground">{c.name}</span>}
          <span className="text-muted-foreground">{candidateDetail(c)}</span>
          {c.widthWarning && <WidthWarningBadge />}
        </li>
      ))}
      {candidates.length > shown.length && <li className="text-xs text-muted-foreground">+{candidates.length - shown.length} tezgâh daha</li>}
    </ul>
  );
}
