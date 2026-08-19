import { useQuery } from "@tanstack/react-query";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { Activity } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STATION_TEXT } from "@/lib/station-colors";
import { stationKindLabels, type StationKind } from "@/types/enums";
import {
  fetchStationLiveState,
  type StationLiveState,
} from "./dashboardService";
import { foldSearchText } from "@/lib/search-fold";
import { trCompare } from "@/lib/collate";

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
  // ⚠️ `toUpperCase()` YETMEZ: "Kurşun" → "KURŞUN" olur ve anahtar "KURSUN" ile
  // eşleşmez; istasyon akış sırasında 99'a düşüp panonun en sonuna giderdi
  // (2026-08-19 denetiminde bulundu). Katlama ç/ş/ğ'yi ASCII'ye indirir.
  const text = foldSearchText(`${s.code} ${s.name}`).toUpperCase();
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
    return trCompare(a.code, b.code);
  });
}

export function StationLoad() {
  // O8 fix: izin yoksa sorgu HİÇ atılmaz (enabled) ve widget gizlenir.
  // Erken return HOOK'lardan SONRA (rules-of-hooks).
  const { hasPermission } = useRoleAccess();
  const allowed = hasPermission("station:read");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "stationLiveState"],
    queryFn: fetchStationLiveState,
    staleTime: 30_000,
    enabled: allowed,
  });

  if (!allowed) return null;

  return (
    <Card className="border-t-2 border-t-primary/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4 text-muted-foreground" />
          İstasyon Doluluk
          {data && data.length > 0 && (
            <span className="ml-auto flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
              <span className="live-dot" />
              Canlı
            </span>
          )}
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
          // Çok fazla istasyonda tek satıra sığdırmak yerine SAR: her kart en az
          // 170px, satırı 1fr ile eşit doldurur, taşınca alt satıra iner (örtüşme
          // yok). Aşırı fazlada widget dashboard'u ezmesin diye max-yükseklik +
          // dikey kaydırma; az istasyonda yükseklik zorlanmaz (scroll çıkmaz).
          <div className="grid max-h-[30rem] grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3 overflow-y-auto pr-0.5">
            {sortByFlow(data).map((s) => (
              <StationCell key={s.id} station={s} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StationCell({ station }: { station: StationLiveState }) {
  const kindLabel = stationKindLabels[station.kind as StationKind] ?? station.kind;
  // KK1 (RAW_QC) üretim akışına step olarak girmez — kuyruk/aktif kavramı yok.
  // Sadece "bugün giren ham mal" sayacı anlamlı.
  const isEntryStation = station.kind === "RAW_QC";
  // EXTERNAL (fason) istasyonlar — kuyruk = sevk edilen ve dönmeyenler;
  // operatöre Aktif / Bugün giden / Bugün gelen üçlüsü daha anlamlı.
  const isQueuelessStation = station.type === "EXTERNAL";
  const isBusy = isEntryStation
    ? station.todayCompletedCount > 0
    : station.queueCount > 0 || station.activeCount > 0;
  return (
    <div
      className={cn(
        "rounded-md border bg-card/40 p-3 transition-colors",
        isBusy ? "border-border" : "border-border/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{station.name}</p>
          <p className="truncate text-[10px] text-muted-foreground">{kindLabel}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isBusy && <span className="live-dot" title="Çalışıyor" />}
          {station.type === "EXTERNAL" && (
            <Badge variant="outline" className="text-[10px]">
              Fason
            </Badge>
          )}
        </div>
      </div>

      {isEntryStation ? (
        <div className="mt-3 text-center">
          <Metric
            label="Bugün Giren"
            value={station.todayCompletedCount}
            tone={STATION_TEXT.kk1}
          />
        </div>
      ) : isQueuelessStation ? (
        <div className="mt-3 grid grid-cols-3 gap-1 text-center">
          <Metric label="Aktif" value={station.activeCount} tone="text-info" />
          <Metric
            label="Bugün giden"
            value={station.todayDispatchedCount}
            tone={STATION_TEXT.fason}
          />
          <Metric
            label="Bugün gelen"
            value={station.todayCompletedCount}
            tone="text-success"
          />
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-1 text-center">
          <Metric label="Kuyruk" value={station.queueCount} tone="text-warning" />
          <Metric label="Aktif" value={station.activeCount} tone="text-info" />
          <Metric
            label="Bugün"
            value={station.todayCompletedCount}
            tone="text-success"
          />
        </div>
      )}
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
    <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{message}</p>;
}
