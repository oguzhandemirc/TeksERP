import { useState } from "react";
import { AlertOctagon, Ban, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PermissionGate } from "@/components/PermissionGate";
import { cn } from "@/lib/utils";
import { RowIdentity } from "./RowIdentity";
import type { KursunBypassStationOption, KursunDistributionWaitingRow } from "./types";

interface Props {
  row: KursunDistributionWaitingRow;
  /** İstasyon listesi payload'dan gelir — ReferenceSelect'e gerek YOK. */
  stations: KursunBypassStationOption[];
  busy: boolean;
  /** Bayrak kapalıysa sayfa bu bölümü hiç göstermez; ek güvenlik için de kapatılır. */
  flagEnabled: boolean;
  onAssign: (stationId: string) => void;
  onToggleUrgent: () => void;
}

/**
 * Dağıtım BEKLEYEN bir iş emri satırı. İstasyon seçimi SATIR İÇİNDE yapılır —
 * planlamacı "seç → ata" akışını modal açmadan, listeden gözünü ayırmadan yürütür.
 *
 * `eligible=false` ise seçim ve "Ata" pasiftir ve `blockReason` SOMUT olarak
 * gösterilir (butonun sessizce çalışmaması en kötü davranış).
 */
export function EligibleRow({
  row,
  stations,
  busy,
  flagEnabled,
  onAssign,
  onToggleUrgent,
}: Props) {
  const [stationId, setStationId] = useState<string>("");
  const blocked = !row.eligible || !flagEnabled;

  return (
    <li>
      <Card
        className={cn(
          "transition-colors",
          row.isUrgent && "border-destructive/40 bg-destructive/5",
          blocked && "opacity-70",
        )}
      >
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <RowIdentity row={row} />

          <PermissionGate permission="workorder:distribute">
            <div className="flex shrink-0 items-center gap-2">
              <Select
                value={stationId}
                onValueChange={setStationId}
                disabled={blocked || busy || stations.length === 0}
              >
                <SelectTrigger className="h-8 w-48 text-xs">
                  <SelectValue placeholder="İstasyon seç" />
                </SelectTrigger>
                <SelectContent>
                  {stations.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="button"
                size="sm"
                className="gap-1"
                disabled={blocked || busy || !stationId}
                onClick={() => onAssign(stationId)}
              >
                <Send className="h-3.5 w-3.5" />
                Ata
              </Button>

              <Button
                type="button"
                size="sm"
                variant={row.isUrgent ? "destructive" : "outline"}
                className="gap-1"
                disabled={busy}
                onClick={onToggleUrgent}
              >
                <AlertOctagon className="h-3.5 w-3.5" />
                {row.isUrgent ? "Acil Kaldır" : "Acil Yap"}
              </Button>
            </div>
          </PermissionGate>

          {!row.eligible && row.blockReason && (
            <div className="text-warning-foreground border-warning/50 bg-warning/10 flex w-full items-start gap-2 rounded-md border p-2 text-[11px]">
              <Ban className="text-warning mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{row.blockReason}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  );
}
