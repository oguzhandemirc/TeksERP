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
import { Inbox, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { formatNumber } from "@/lib/format";
import { AssignedRow } from "./AssignedRow";
import { BulkBar } from "./BulkBar";
import { headerState, toggleAll, toggleOne, visibleSelection } from "./selection";
import type {
  KursunBypassMachineOption,
  KursunDistributionAssignedRow,
} from "./types";

interface Props {
  machineId: string;
  machineName: string;
  rows: KursunDistributionAssignedRow[];
  /** Taşıma hedefleri — bu makine hariç tutulur (kendine taşıma anlamsız). */
  machines: KursunBypassMachineOption[];
  busy: boolean;
  canReorder: boolean;
  selected: string[];
  onSelectedChange: (next: string[]) => void;
  onReorder: (machineId: string, activeId: string, overId: string) => void;
  onToggleUrgent: (row: KursunDistributionAssignedRow) => void;
  onComplete: (row: KursunDistributionAssignedRow) => void;
  /** Tekil "Havuza Al" (satır butonu) — onaylı. */
  onCancelOne: (row: KursunDistributionAssignedRow) => void;
  /** TOPLU havuza alma (seçili adım id'leri verilir). */
  onCancelBulk: (stepIds: string[]) => void;
  /** TOPLU taşıma — seçili adım id'leri + hedef makine. */
  onMoveBulk: (stepIds: string[], targetMachineId: string) => void;
}

/**
 * BİR MAKİNENİN SEKMESİ — o makinede bekleyen işler.
 *
 * Eski tasarımda tüm makineler alt alta "gruplar" hâlindeydi; makine sayısı
 * arttıkça sayfa uzuyor ve toplu seçim iki makineye birden taşabiliyordu.
 * Sekme bunu yapısal olarak çözer: ekranda TEK makine vardır, dolayısıyla
 * "seçtiklerim hangi makineye ait" sorusu hiç doğmaz.
 *
 * ⚠️ SÜRÜKLEME SEKMENİN İÇİNDE KALIR (kendi `DndContext`'i). Satırı başka
 * makineye sürüklemek mümkün değildir — makine değiştirmek bir yeniden ATAMA'dır
 * ve **Taşı** aksiyonuyla, açıkça hedef seçilerek yapılır.
 */
export function MachinePanel({
  machineId,
  machineName,
  rows,
  machines,
  busy,
  canReorder,
  selected,
  onSelectedChange,
  onReorder,
  onToggleUrgent,
  onComplete,
  onCancelOne,
  onCancelBulk,
  onMoveBulk,
}: Props) {
  const [cancelTarget, setCancelTarget] = useState<KursunDistributionAssignedRow | null>(
    null,
  );
  const [moveTarget, setMoveTarget] = useState<string>("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = rows.map((r) => r.workOrderStepId);
  const picked = visibleSelection(selected, ids);
  const pickedMeters = rows
    .filter((r) => picked.includes(r.workOrderStepId))
    .reduce((s, r) => s + r.totalMeters, 0);
  // Kendine taşıma anlamsız — hedef listesinden bu makine düşer.
  const targets = machines.filter((m) => m.id !== machineId);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    onReorder(machineId, String(active.id), String(over.id));
  };

  return (
    <div className="space-y-2">
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
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1"
              disabled={busy}
              onClick={() => onCancelBulk(picked)}
            >
              <Inbox className="h-3.5 w-3.5" />
              Havuza Al
            </Button>

            <Select
              value={moveTarget}
              onValueChange={setMoveTarget}
              disabled={busy || targets.length === 0}
            >
              <SelectTrigger className="h-8 w-48 text-xs">
                <SelectValue
                  placeholder={
                    targets.length === 0 ? "Başka makine yok" : "Taşınacak makine"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {targets.map((m) => (
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
              disabled={busy || !moveTarget}
              onClick={() => {
                onMoveBulk(picked, moveTarget);
                setMoveTarget("");
              }}
            >
              <Send className="h-3.5 w-3.5" />
              Taşı
            </Button>
          </PermissionGate>
        }
      />

      {rows.length === 0 ? (
        <div className="text-muted-foreground flex h-24 items-center justify-center rounded-md border border-dashed text-sm">
          {machineName} makinesine dağıtılmış iş yok.
        </div>
      ) : (
        <div className="rounded-md border">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <ul className="divide-y">
                {rows.map((row, idx) => (
                  <AssignedRow
                    key={row.assignmentId}
                    row={row}
                    index={idx}
                    selected={picked.includes(row.workOrderStepId)}
                    onToggleSelect={() =>
                      onSelectedChange(toggleOne(selected, row.workOrderStepId))
                    }
                    busy={busy}
                    canReorder={canReorder}
                    onCancelRequest={setCancelTarget}
                    onToggleUrgent={onToggleUrgent}
                    onComplete={onComplete}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </div>
      )}

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        title="Havuza al"
        description={
          cancelTarget
            ? `${cancelTarget.workOrderNumber} iş emrinin kurşun dağıtımı "${machineName}" makinesinden kaldırılacak.\n\n` +
              `Kapsam: ${cancelTarget.openRollCount} top · ${formatNumber(cancelTarget.totalMeters, 0)} m` +
              (cancelTarget.batchNumbers.length > 0
                ? `\nParti: ${cancelTarget.batchNumbers.join(", ")}`
                : "") +
              `\nKart: ${cancelTarget.travelerCardNumber ?? "—"}\n\n` +
              "İş havuza (bekleyen kuyruğa) döner. Adımın istasyonuna ve toplara DOKUNULMAZ."
            : undefined
        }
        confirmLabel="Havuza al"
        destructive
        isPending={busy}
        onConfirm={() => {
          if (!cancelTarget) return;
          onCancelOne(cancelTarget);
          setCancelTarget(null);
        }}
      />
    </div>
  );
}
