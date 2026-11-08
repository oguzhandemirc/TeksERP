// Özet şeridi + firma şeridi: sunucu özeti listeyle AYNI where'den; firma çipi tıklanınca firma süzgeci olur.
import { cn } from "@/lib/utils";
import { fmtQty } from "./cockpit-labels";
import type { SubcontractorCockpitResult } from "./types";

type Summary = SubcontractorCockpitResult["summary"];

function Cell({ label, value, tone }: { label: string; value: string; tone?: "danger" | "warn" }) {
  return (
    <div className="min-w-0 rounded-md border bg-card px-3 py-2">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums", tone === "danger" && "text-destructive", tone === "warn" && "text-amber-600 dark:text-amber-400")}>{value}</div>
    </div>
  );
}

export function CockpitSummaryStrip({ summary }: { summary: Summary | null }) {
  const s = summary;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Fason özeti">
      <Cell label="Açık sevk" value={s ? String(s.openDispatchCount) : "—"} />
      <Cell label="Geciken" value={s ? String(s.overdueCount) : "—"} tone={s && s.overdueCount > 0 ? "danger" : undefined} />
      <Cell label="2 gün içinde dönecek" value={s ? String(s.dueSoonCount) : "—"} tone={s && s.dueSoonCount > 0 ? "warn" : undefined} />
      <Cell label="Fasonda kalan" value={s ? `${fmtQty(s.outstandingQty)} m` : "—"} />
    </div>
  );
}

export function CockpitFirmStrip({ summary, selectedId, onSelect }: { summary: Summary | null; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const firms = summary?.firms ?? [];
  if (firms.length === 0) return null;
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Firma şeridi">
      {firms.map((f) => {
        const active = selectedId === f.subcontractor.id;
        return (
          <button
            key={f.subcontractor.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(active ? null : f.subcontractor.id)}
            className={cn("shrink-0 rounded-md border px-2.5 py-1 text-left text-xs transition-colors hover:bg-muted/50", active && "border-primary bg-primary/5")}
          >
            <span className="font-medium">{f.subcontractor.name}</span>
            <span className="ml-1.5 tabular-nums text-muted-foreground">{f.openDispatchCount} sevk · {fmtQty(f.outstandingQty)} m</span>
            {f.overdueCount > 0 && <span className="ml-1.5 font-medium text-destructive">{f.overdueCount} geciken</span>}
          </button>
        );
      })}
    </div>
  );
}
