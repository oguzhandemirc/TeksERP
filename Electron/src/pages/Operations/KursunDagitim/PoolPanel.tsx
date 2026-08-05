import { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Info, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PermissionGate } from "@/components/PermissionGate";
import { EligibleRow } from "./EligibleRow";
import { BulkBar } from "./BulkBar";
import { headerState, toggleAll, toggleOne, visibleSelection } from "./selection";
import type {
  KursunBypassMachineOption,
  KursunDistributionWaitingRow,
} from "./types";

interface Props {
  rows: KursunDistributionWaitingRow[];
  machines: KursunBypassMachineOption[];
  busy: boolean;
  /** `production.kursunBypassEnabled` — kapalıyken dağıtım kontrolleri çizilmez. */
  flagEnabled: boolean;
  canReorder: boolean;
  selected: string[];
  onSelectedChange: (next: string[]) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onAssignOne: (row: KursunDistributionWaitingRow, machineId: string) => void;
  onToggleUrgent: (row: KursunDistributionWaitingRow) => void;
  /** TOPLU dağıtım — seçili adım id'leri + hedef makine. */
  onAssignBulk: (stepIds: string[], machineId: string) => void;
}

/**
 * HAVUZ SEKMESİ — kurşun adımında bekleyen, henüz bir makineye verilmemiş işler.
 *
 * Bayrak KAPALIYKEN de anlamlıdır: o rejimde bu liste kurşun tabletinin çalışma
 * kuyruğudur ve sıralaması tablete gider. Dağıtım kontrolleri (makine seçici,
 * "Ata", toplu gönderim) yalnız bayrak açıkken çizilir.
 */
export function PoolPanel({
  rows,
  machines,
  busy,
  flagEnabled,
  canReorder,
  selected,
  onSelectedChange,
  onDragEnd,
  onAssignOne,
  onToggleUrgent,
  onAssignBulk,
}: Props) {
  const [bulkMachine, setBulkMachine] = useState<string>("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = rows.map((r) => r.workOrderStepId);
  const picked = visibleSelection(selected, ids);
  const pickedMeters = rows
    .filter((r) => picked.includes(r.workOrderStepId))
    .reduce((s, r) => s + r.totalMeters, 0);
  // Seçimde dağıtıma uygun OLMAYAN satır varsa önden söylenir: backend onları
  // atlayacak ve sebebini dönecek, ama sayıyı ÖNCEDEN görmek "12 seçtim, 9 gitti"
  // sürprizini engeller.
  const blockedPicked = rows.filter(
    (r) => picked.includes(r.workOrderStepId) && !r.eligible,
  ).length;

  return (
    <div className="space-y-2">
      {flagEnabled ? (
        <BulkBar
          totalCount={rows.length}
          selectedCount={picked.length}
          selectedMeters={pickedMeters}
          headerState={headerState(selected, ids)}
          onToggleAll={() => onSelectedChange(toggleAll(selected, ids))}
          onClear={() => onSelectedChange([])}
          disabled={busy}
          actions={
            <PermissionGate permission="workorder:distribute">
              {blockedPicked > 0 && (
                <span className="text-warning-foreground text-xs">
                  {blockedPicked} tanesi dağıtıma uygun değil, atlanacak
                </span>
              )}
              <Select
                value={bulkMachine}
                onValueChange={setBulkMachine}
                disabled={busy || machines.length === 0}
              >
                <SelectTrigger className="h-8 w-48 text-xs">
                  <SelectValue placeholder="Hedef makine" />
                </SelectTrigger>
                <SelectContent>
                  {machines.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                className="gap-1"
                disabled={busy || !bulkMachine}
                onClick={() => {
                  onAssignBulk(picked, bulkMachine);
                  setBulkMachine("");
                }}
              >
                <Send className="h-3.5 w-3.5" />
                Dağıt
              </Button>
            </PermissionGate>
          }
        />
      ) : (
        <div className="bg-muted/30 flex items-start gap-2 rounded-md border p-3 text-xs">
          <Info className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Kurşun dağıtımı kapalı — iş kurşun tabletinde işleniyor. Bu sekmeden
            yalnız sıra ve acillik yönetilir.
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="text-muted-foreground flex h-24 items-center justify-center rounded-md border border-dashed text-sm">
          Kurşun adımında bekleyen iş emri yok.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {rows.map((row, idx) => (
                <EligibleRow
                  key={row.workOrderStepId}
                  row={row}
                  index={idx}
                  selected={picked.includes(row.workOrderStepId)}
                  onToggleSelect={() =>
                    onSelectedChange(toggleOne(selected, row.workOrderStepId))
                  }
                  machines={machines}
                  busy={busy}
                  flagEnabled={flagEnabled}
                  canReorder={canReorder}
                  onAssign={(machineId) => onAssignOne(row, machineId)}
                  onToggleUrgent={() => onToggleUrgent(row)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
