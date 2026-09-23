import { memo } from "react";
import { Pencil, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { toneFor } from "@/lib/station-colors";
import { stationKindLabels } from "@/types/enums";
import type { Station } from "@/pages/Stations/types";
import type { Machine } from "@/pages/Machines/types";
import type { StationCapabilitySummary } from "@/pages/StationCapabilities/types";
import type { PeripheralDevice } from "@/pages/PeripheralDevices/types";
import { StationMachineTable } from "@/pages/Stations/StationMachineTable";

interface Props {
  station: Station;
  machines: Machine[];
  /** makineId → o makineye bağlı cihazlar (metre/yazıcı/tartı). Makine satırında
   *  genişletilerek gösterilir. */
  peripheralsByMachine?: Map<string, PeripheralDevice[]>;
  cap?: StationCapabilitySummary;
  canWrite: boolean;
  onEditStation: (s: Station) => void;
  onAddMachine: (stationId: string) => void;
  onEditMachine: (m: Machine) => void;
  onQrMachine: (m: Machine) => void;
  onDeactivateMachine: (m: Machine) => void;
  onReactivateMachine: (m: Machine) => void;
  onDeleteMachine: (m: Machine) => void;
  onEditCap: (cap: StationCapabilitySummary) => void;
}

/**
 * Tek üretim istasyonu kartı. İstasyon türü renkle kodlanır (üst şerit + tonlu
 * başlık) — sahada hızlı ayırt edilsin. İç bölümler (Makineler / Yetenekler)
 * ayrı kenarlıklı kutular; başlık ile aralarında net görsel sınır var.
 *
 * Perf: React.memo — üst sayfada arama kutusuna yazarken (debounce'lu filtre
 * değişmediği sürece) props kararlı kalır ve kart yeniden render EDİLMEZ. Faydası
 * için üst sayfa handler'ları useCallback ile, boş makine dizisi sabit referansla
 * geçmeli (ProductionStationsPage).
 */
export const StationCard = memo(function StationCard({
  station: s,
  machines,
  peripheralsByMachine,
  cap,
  canWrite,
  onEditStation,
  onAddMachine,
  onEditMachine,
  onQrMachine,
  onDeactivateMachine,
  onReactivateMachine,
  onDeleteMachine,
  onEditCap,
}: Props) {
  const tone = toneFor(s.type, s.kind);
  // Renk artık istasyon bazlı kısıt değil (bkz. schema.prisma → StationColor);
  // düzenlenecek tek yetenek özellik listesi.
  const capEditable = !!cap?.canApplyProperty;

  return (
    <Card className="overflow-hidden shadow-sm">
      {/* Tür renk şeridi — istasyonları hızlı ayırt etmek için */}
      <div className={cn("h-1.5 w-full", tone.solid)} />

      <CardContent className="p-0">
        {/* Başlık — tür tonunda hafif zemin */}
        <div className={cn("flex items-center justify-between gap-2 px-4 py-2.5", tone.bgSoft)}>
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tone.solid)} />
            <span className="truncate text-base font-semibold">{s.name}</span>
            {/* K22: formda doğan kimlik listede de görünür (istasyon kodu yalnız düzenleme diyaloğundaydı). */}
            {s.code && <span className="shrink-0 font-mono text-xs text-muted-foreground">{s.code}</span>}
            <Badge className={cn("shrink-0 border-transparent font-medium", tone.bgSoft, tone.text)}>
              {stationKindLabels[s.kind]}
            </Badge>
            {!s.isActive && (
              <Badge variant="outline" className="shrink-0">
                pasif
              </Badge>
            )}
          </div>
          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1 bg-background"
              onClick={() => onEditStation(s)}
            >
              <Pencil className="h-3.5 w-3.5" /> Düzenle
            </Button>
          )}
        </div>

        {/* İç bölümler */}
        <div className="space-y-3 px-4 pb-4 pt-3">
          <StationMachineTable
            machines={machines}
            peripheralsByMachine={peripheralsByMachine}
            canWrite={canWrite}
            onAdd={() => onAddMachine(s.id)}
            onEdit={onEditMachine}
            onQr={onQrMachine}
            onDeactivate={onDeactivateMachine}
            onReactivate={onReactivateMachine}
            onDelete={onDeleteMachine}
          />

          {capEditable && (
            <div className="rounded-md border">
              <div className="flex items-center justify-between border-b border-amber-200/70 bg-amber-50 px-3 py-2 dark:border-amber-900/40 dark:bg-amber-950/20">
                <span className="flex items-center gap-1.5 text-sm font-bold text-amber-900 dark:text-amber-200">
                  <Sparkles className="h-4 w-4" /> Yetenekler (fason)
                </span>
                {canWrite && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2.5 text-xs"
                    onClick={() => onEditCap(cap!)}
                  >
                    <Pencil className="h-3 w-3" /> Düzenle
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs">
                  <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-semibold">{cap!.propertyCount}</span>
                  <span className="text-muted-foreground">özellik</span>
                </span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
});
