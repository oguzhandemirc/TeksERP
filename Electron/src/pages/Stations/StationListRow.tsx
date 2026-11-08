// Liste görünümü SATIRI — bir satır = bir İSTASYON; tıklama/Enter sağdaki istasyon panelini açar.
import { ChevronRight, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { toneFor } from "@/lib/station-colors";
import { stationTypeLabels } from "@/types/enums";
import type { Station } from "./types";
import type { StationListItem, StationKursunInfo } from "./stationListItems";
import { plainStationKindLabel } from "./stationPlainLabels";

/** Yetenek rozetleri — dışa aktarımdaki Evet/Hayır sütunlarının satır içi karşılığı. */
export function capabilityChips(s: Station): string[] {
  const out: string[] = [];
  if (s.appliesColor) out.push("Renk");
  if (s.appliesProperty) out.push("Özellik");
  if (s.inspectionEnabled) out.push("Muayene");
  if (s.appliesQuality) out.push("Kart akışı");
  if (s.producesWarpBeam) out.push("Levent sarar");
  if (s.consumesWarpBeam) out.push("Levent tüketir");
  if (s.capturesWidth) out.push("En ölçer");
  if (s.scanAddAllowed) out.push("Okutunca eklenir");
  if (s.scanNotSkippable) out.push("Atlanamaz");
  return out;
}

/** Belirgin kurşun rozeti + varsayılan gramaj (★). Kurşun kapalıysa hiçbir şey çizmez. */
export function KursunBadge({ kursun, className }: { kursun: StationKursunInfo | null; className?: string }) {
  if (!kursun?.enabled) return null;
  return (
    <Badge
      data-testid="kursun-badge"
      className={cn("gap-1 border-amber-300 bg-amber-100 font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200", className)}
      title={kursun.defaultGramaj ? `Kurşun uygular · varsayılan gramaj ${kursun.defaultGramaj}` : "Kurşun uygular · varsayılan gramaj seçilmedi"}
    >
      Kurşun
      {kursun.defaultGramaj && (
        <span className="inline-flex items-center gap-0.5 font-medium">
          <Star className="h-3 w-3 fill-current" />
          {kursun.defaultGramaj}
        </span>
      )}
    </Badge>
  );
}

export function StationStatusBadge({ active }: { active: boolean }) {
  return (
    <Badge variant={active ? "secondary" : "muted"} className="gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-500" : "bg-muted-foreground/50")} />
      {active ? "Aktif" : "Pasif"}
    </Badge>
  );
}

interface Props {
  item: StationListItem;
  selected: boolean;
  showType: boolean;
  onSelect: (s: Station) => void;
}

export function StationListRow({ item, selected, showType, onSelect }: Props) {
  const s = item.station;
  const tone = toneFor(s.type, s.kind);
  const chips = capabilityChips(s);
  const inactiveMachines = item.machines.filter((m) => m.isActive === false).length;
  return (
    <TableRow
      data-testid="station-row"
      data-state={selected ? "selected" : undefined}
      aria-selected={selected}
      tabIndex={0}
      onClick={() => onSelect(s)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(s);
        }
      }}
      className={cn(
        "cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none data-[state=selected]:bg-primary/10",
        !s.isActive && "text-muted-foreground",
      )}
    >
      <TableCell className={cn("border-l-2 py-2", selected ? "border-l-primary" : "border-l-transparent")}>
        <div className="flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tone.solid)} />
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="truncate font-medium">{s.name}</span>
              {s.code && <span className="shrink-0 font-mono text-xs text-muted-foreground">{s.code}</span>}
            </div>
            <div className="text-xs text-muted-foreground">{plainStationKindLabel(s.kind)}</div>
          </div>
        </div>
      </TableCell>
      <TableCell className="py-2 text-sm">{s.defaultCategory?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
      <TableCell className="py-2">
        <div className="flex flex-wrap items-center gap-1">
          <KursunBadge kursun={item.kursun} />
          {chips.map((c) => (
            <Badge key={c} variant="muted" className="text-[10px]">
              {c}
            </Badge>
          ))}
          {chips.length === 0 && !item.kursun?.enabled && <span className="text-xs text-muted-foreground">—</span>}
        </div>
      </TableCell>
      {showType && <TableCell className="py-2 text-xs">{stationTypeLabels[s.type]}</TableCell>}
      <TableCell className="py-2 text-right tabular-nums" title={inactiveMachines > 0 ? `${inactiveMachines} pasif makine dahil` : undefined}>
        {item.machines.length > 0 ? item.machines.length : <span className="text-muted-foreground">0</span>}
        {inactiveMachines > 0 && <span className="ml-1 text-xs text-muted-foreground">({inactiveMachines} pasif)</span>}
      </TableCell>
      <TableCell className="py-2">
        <StationStatusBadge active={s.isActive} />
      </TableCell>
      <TableCell className="w-8 py-2 pr-3">
        <ChevronRight className={cn("h-4 w-4 text-muted-foreground", selected && "text-primary")} />
      </TableCell>
    </TableRow>
  );
}
