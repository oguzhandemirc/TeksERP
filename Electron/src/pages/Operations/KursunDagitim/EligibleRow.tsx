import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertOctagon, Ban, GripVertical, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  /** Kuyruktaki sıra (düz liste — gruplama yok). */
  index: number;
  selected: boolean;
  onToggleSelect: () => void;
  /** Makine listesi payload'dan gelir — ReferenceSelect'e gerek YOK. */
  machines: KursunBypassMachineOption[];
  busy: boolean;
  /**
   * `production.kursunBypassEnabled`. KAPALIYKEN satır YİNE ÇİZİLİR (bu liste
   * kurşun KUYRUĞUdur, dağıtıma özel değil) — yalnız makine seçimi + "Ata"
   * görünmez. Sıralama ve acil işaretleme her iki rejimde de çalışır.
   */
  flagEnabled: boolean;
  /** Sürükleme açık mı (kuyruk sıralama yetkisi). */
  canReorder: boolean;
  onAssign: (machineId: string) => void;
  onToggleUrgent: () => void;
}

/**
 * Kurşun kuyruğunda BEKLEYEN bir iş emri satırı.
 *
 * Satır İKİ İŞ birden yapar (2026-08-05 birleştirmesi): kuyruk sırasını taşır
 * (sürükle-bırak) ve — bayrak açıkken — makineye dağıtım kontrollerini sunar.
 * Ayrı iki ekran olduğunda planlamacı aynı iş emrini iki listede iki farklı
 * yerde görüyordu; sıra ile dağıtım kararı aynı satırda verilir.
 *
 * Seçim hedefi İSTASYON DEĞİL MAKİNEDİR: kurşun tek istasyon, altındaki fiziksel
 * makineler farklı. İstasyon adı yalnız parantezde bağlam olarak yazılır.
 *
 * `eligible=false` ise seçim ve "Ata" pasiftir ve `blockReason` SOMUT olarak
 * gösterilir (butonun sessizce çalışmaması en kötü davranış). Sürükleme ve acil
 * işaretleme BUNDAN ETKİLENMEZ — uygun olmayan iş de kuyrukta bekliyor ve
 * tablette işlenecek; önceliklendirilebilmesi gerekir.
 */
export function EligibleRow({
  row,
  index,
  selected,
  onToggleSelect,
  machines,
  busy,
  flagEnabled,
  canReorder,
  onAssign,
  onToggleUrgent,
}: Props) {
  const [machineId, setMachineId] = useState<string>("");
  const sortable = useSortable({ id: row.workOrderStepId, disabled: !canReorder });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  const blocked = !row.eligible;
  // İstasyon adı yalnız AYIRT EDİCİYSE parantezde yazılır. Fabrikada tek
  // PROCESS_QC istasyonu var → her satıra aynı adı basmak saf gürültü olurdu.
  const showStationHint = new Set(machines.map((m) => m.stationId)).size > 1;

  return (
    <li ref={sortable.setNodeRef} style={style}>
      <Card
        className={cn(
          "transition-colors",
          row.isUrgent && "border-destructive/40 bg-destructive/5",
          selected && "ring-primary/40 bg-primary/5 ring-1",
          sortable.isDragging && "ring-ring ring-2",
        )}
      >
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          {/* Seçim kutusu, dağıtıma UYGUN OLMAYAN satırda da AÇIKTIR: toplu
              gönderimde backend o satırı somut sebebiyle atlar ve sebep ekranda
              gösterilir. Kutuyu kapatmak, operatöre "neden seçemiyorum"u hiçbir
              yerde söylemeden sessizce engel çıkarırdı. */}
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelect}
            disabled={busy}
            aria-label={`${row.workOrderNumber} seç`}
          />

          {canReorder && (
            <button
              type="button"
              {...sortable.attributes}
              {...sortable.listeners}
              className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
              aria-label="Sürükle"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}

          <div className="bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-mono text-xs">
            {index + 1}
          </div>

          <RowIdentity row={row} />

          <div className="flex shrink-0 items-center gap-2">
            {flagEnabled && (
              <PermissionGate permission="workorder:distribute">
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
              </PermissionGate>
            )}

            {/* Acil, sayfayı açan HER İKİ izne de açıktır (backend `urgent` ucu
                quality:write | workorder:distribute kabul ediyor) → ayrı gate YOK. */}
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

          {/* Engel sebebi YALNIZ bayrak açıkken anlamlı: bayrak kapalıyken
              dağıtım diye bir seçenek yok, "dağıtılamaz" demek gürültü olurdu. */}
          {flagEnabled && !row.eligible && row.blockReason && (
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
