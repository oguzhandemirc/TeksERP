// Özet şeridi + firma şeridi: sunucu özeti listeyle AYNI where'den; firma çipi tıklanınca firma süzgeci olur.
import { cn } from "@/lib/utils";
import { BandStats } from "@/components/layout/ListPage";
import { formatDisplay } from "@/lib/format";
import { balanceText } from "./cockpit-labels";
import type { SubcontractorCockpitResult } from "./types";

type Summary = SubcontractorCockpitResult["summary"];

export function CockpitSummaryStrip({ summary }: { summary: Summary | null }) {
  const s = summary;
  return (
    <BandStats
      label="Fason özeti"
      items={[
        { key: "open", label: "Açık sevk", value: s ? s.openDispatchCount : "—" },
        { key: "overdue", label: "Geciken", value: s ? s.overdueCount : "—", tone: s && s.overdueCount > 0 ? "danger" : undefined },
        { key: "soon", label: "2 gün içinde dönecek", value: s ? s.dueSoonCount : "—", tone: s && s.dueSoonCount > 0 ? "warn" : undefined },
        { key: "qty", label: "Fasonda kalan", value: s ? formatDisplay(s.outstandingQty) : "—", unit: s ? "m" : undefined },
      ]}
    />
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
            <span className="ml-1.5 tabular-nums text-muted-foreground">{f.openDispatchCount} sevk · {balanceText(f)}</span>
            {f.overdueCount > 0 && <span className="ml-1.5 font-medium text-destructive">{f.overdueCount} geciken</span>}
          </button>
        );
      })}
    </div>
  );
}
