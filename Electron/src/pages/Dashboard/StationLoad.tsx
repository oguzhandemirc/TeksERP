import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { stationKindLabels, type StationKind } from "@/types/enums";
import {
  fetchStationLiveState,
  type StationLiveState,
} from "./dashboardService";

// Üretim akışına göre istasyon sırası — KK1 → Zımpara → Boyahane → KK2 → Tambur.
// Listede olmayanlar sona düşer, kendi aralarında code'a göre sıralanır.
const FLOW_ORDER: Array<{ keywords: string[]; rank: number }> = [
  { keywords: ["KK1", "HAM"], rank: 1 },
  { keywords: ["ZIMPA"], rank: 2 },
  { keywords: ["BOYA"], rank: 3 },
  { keywords: ["KK2", "KURSUN"], rank: 4 },
  { keywords: ["TAMBUR"], rank: 5 },
];

function flowRank(s: StationLiveState): number {
  const text = `${s.code} ${s.name}`.toUpperCase();
  for (const entry of FLOW_ORDER) {
    if (entry.keywords.some((kw) => text.includes(kw))) return entry.rank;
  }
  return 99;
}

function sortByFlow(list: StationLiveState[]): StationLiveState[] {
  return [...list].sort((a, b) => {
    const ra = flowRank(a);
    const rb = flowRank(b);
    if (ra !== rb) return ra - rb;
    return a.code.localeCompare(b.code, "tr");
  });
}

export function StationLoad() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "stationLiveState"],
    queryFn: fetchStationLiveState,
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4 text-muted-foreground" />
          İstasyon Doluluk
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingGrid />
        ) : isError ? (
          <EmptyState message="Veri alınamadı." />
        ) : !data || data.length === 0 ? (
          <EmptyState message="Aktif istasyon yok." />
        ) : (
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <div className="grid grid-flow-col auto-cols-fr gap-3 min-w-min">
              {sortByFlow(data).map((s) => (
                <StationCell key={s.id} station={s} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StationCell({ station }: { station: StationLiveState }) {
  const kindLabel = stationKindLabels[station.kind as StationKind] ?? station.kind;
  const isBusy = station.queueCount > 0 || station.activeCount > 0;
  return (
    <div
      className={cn(
        "min-w-[160px] rounded-md border bg-card/40 p-3 transition-colors",
        isBusy ? "border-border" : "border-border/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{station.name}</p>
          <p className="truncate text-[10px] text-muted-foreground">{kindLabel}</p>
        </div>
        {station.type === "EXTERNAL" && (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            Fason
          </Badge>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1 text-center">
        <Metric label="Kuyruk" value={station.queueCount} tone="text-amber-600 dark:text-amber-400" />
        <Metric label="Aktif" value={station.activeCount} tone="text-sky-600 dark:text-sky-400" />
        <Metric
          label="Bugün"
          value={station.todayCompletedCount}
          tone="text-emerald-600 dark:text-emerald-400"
        />
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <p className={cn("text-lg font-semibold leading-none tabular-nums", value > 0 ? tone : "text-muted-foreground")}>
        {value}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-flow-col auto-cols-fr gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-24 min-w-[160px]" />
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{message}</p>;
}
