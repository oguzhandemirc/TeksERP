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
import type { KursunBypassMachineOption, KursunDistributionWaitingRow } from "./types";

interface Props {
  row: KursunDistributionWaitingRow;
  /** Makine listesi payload'dan gelir — ReferenceSelect'e gerek YOK. */
  machines: KursunBypassMachineOption[];
  busy: boolean;
  /** Bayrak kapalıysa sayfa bu bölümü hiç göstermez; ek güvenlik için de kapatılır. */
  flagEnabled: boolean;
  onAssign: (machineId: string) => void;
  onToggleUrgent: () => void;
}

/**
 * Dağıtım BEKLEYEN bir iş emri satırı. MAKİNE seçimi SATIR İÇİNDE yapılır —
 * planlamacı "seç → ata" akışını modal açmadan, listeden gözünü ayırmadan yürütür.
 *
 * Seçim hedefi İSTASYON DEĞİL MAKİNEDİR: kurşun tek istasyon, altındaki fiziksel
 * makineler farklı. İstasyon adı yalnız parantezde bağlam olarak yazılır.
 *
 * `eligible=false` ise seçim ve "Ata" pasiftir ve `blockReason` SOMUT olarak
 * gösterilir (butonun sessizce çalışmaması en kötü davranış).
 */
export function EligibleRow({
  row,
  machines,
  busy,
  flagEnabled,
  onAssign,
  onToggleUrgent,
}: Props) {
  const [machineId, setMachineId] = useState<string>("");
  const blocked = !row.eligible || !flagEnabled;
  // İstasyon adı yalnız AYIRT EDİCİYSE parantezde yazılır. Fabrikada tek
  // PROCESS_QC istasyonu var → her satıra aynı adı basmak saf gürültü olurdu.
  const showStationHint = new Set(machines.map((m) => m.stationId)).size > 1;

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
                value={machineId}
                onValueChange={setMachineId}
                disabled={blocked || busy || machines.length === 0}
              >
                <SelectTrigger className="h-8 w-52 text-xs">
                  <SelectValue placeholder="Makine seç" />
                </SelectTrigger>
                <SelectContent>
                  {machines.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                      {showStationHint && (
                        <span className="text-muted-foreground"> ({m.stationName})</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="button"
                size="sm"
                className="gap-1"
                disabled={blocked || busy || !machineId}
                onClick={() => onAssign(machineId)}
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
