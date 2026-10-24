import type { MouseEvent } from "react";
import { CheckCircle2, Truck } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toneFor } from "@/lib/station-colors";
import type { WorkOrderStatus } from "@/types/enums";
import { locationView, stationDetail, type WorkOrderLocation, type WorkOrderLocationStation } from "./location";

// "Şu an nerede" sütunu: TEK satır yüksekliği (çip + "+N" rozeti); dağılım tıkla açılan
// küçük kartta. Satır tıklaması detay panelini açtığı için tetik olayı yukarı taşımaz.

const fmt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 0, useGrouping: false });
const stop = (e: MouseEvent) => e.stopPropagation();

function Dot({ s }: { s: Pick<WorkOrderLocationStation, "dis" | "tur"> }) {
  return <span className={cn("h-2 w-2 shrink-0 rounded-full", toneFor(s.dis ? "EXTERNAL" : "INTERNAL", s.tur).solid)} />;
}

export function LocationCard({ konum }: { konum: WorkOrderLocation }) {
  const v = locationView(konum, "IN_PROGRESS");
  if (v.kind !== "stations") return null;
  const total = Math.max(1, v.total);
  return (
    <div className="w-64 space-y-2 text-xs" data-testid="location-card">
      <div className="flex items-baseline justify-between">
        <span className="font-medium">Şu an nerede</span>
        <span className="text-muted-foreground">
          {v.total} top · {konum.istasyonlar.length} istasyon
        </span>
      </div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        {konum.istasyonlar.map((s) => (
          <div
            key={s.istasyonId}
            className={toneFor(s.dis ? "EXTERNAL" : "INTERNAL", s.tur).solid}
            style={{ width: `${(s.topSayisi / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="space-y-1">
        {v.rows.map((s) => {
          const detail = stationDetail(s);
          return (
            <li key={s.istasyonId} className="flex items-center gap-2">
              <Dot s={s} />
              <span className="min-w-0 flex-1 truncate" title={detail ? `${s.ad} — ${detail}` : s.ad}>
                {s.ad}
                {detail && <span className="ml-1 text-muted-foreground">({detail})</span>}
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="font-medium">{s.topSayisi} top</span>
                <span className="ml-1 text-muted-foreground">{fmt(s.metre)} m</span>
              </span>
            </li>
          );
        })}
      </ul>
      {v.hiddenCount > 0 && <div className="text-muted-foreground">+{v.hiddenCount} diğer istasyon</div>}
    </div>
  );
}

export function LocationCell({ konum, status }: { konum: WorkOrderLocation | undefined; status: WorkOrderStatus }) {
  const v = locationView(konum, status);
  if (v.kind === "unknown" || v.kind === "cancelled") return <span className="text-muted-foreground">—</span>;
  if (v.kind === "not-started") return <span className="text-xs text-muted-foreground/70">Başlamadı</span>;
  if (v.kind === "done") {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400" title={v.hint}>
        <CheckCircle2 className="h-3.5 w-3.5" />
        {v.label}
      </span>
    );
  }
  const chip = (
    <span
      className={cn(
        "inline-flex max-w-[10rem] items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
        v.fason && "border-station-fason/45 bg-station-fason/10",
      )}
    >
      {v.fason ? <Truck className="h-3 w-3 shrink-0 text-station-fason" /> : <Dot s={v.primary} />}
      <span className="truncate font-medium">{v.primaryLabel}</span>
    </span>
  );
  const tip = konum ? konum.istasyonlar.map((s) => `${s.ad}: ${s.topSayisi} top`).join(" · ") : "";
  if (v.extra === 0 && !v.fason) return <span title={tip}>{chip}</span>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={stop}
          className="flex items-center gap-1 rounded-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={`${tip} — ayrıntı için tıkla`}
          aria-label="Konum dağılımını göster"
        >
          {chip}
          {v.extra > 0 && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              +{v.extra}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" onClick={stop}>
        {konum && <LocationCard konum={konum} />}
      </PopoverContent>
    </Popover>
  );
}
