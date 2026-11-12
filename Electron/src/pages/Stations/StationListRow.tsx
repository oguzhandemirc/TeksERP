// İstasyon liste/panel ortak parçaları — yetenek rozetleri, kurşun rozeti, durum rozeti (liste sütunları ve yan panel).
import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Station } from "./types";
import type { StationKursunInfo } from "./stationListItems";

/** Yetenek rozetleri — dışa aktarımdaki Evet/Hayır sütunlarının satır içi karşılığı. */
export function capabilityChips(s: Station): string[] {
  const out: string[] = [];
  if (s.appliesColor) out.push("Renk");
  if (s.appliesProperty) out.push("Özellik");
  if (s.inspectionEnabled) out.push("Muayene");
  if (s.machineStopEnabled === false) out.push("Duruş bildirimi kapalı");
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
