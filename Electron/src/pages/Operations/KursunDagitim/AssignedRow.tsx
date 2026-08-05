import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  GripVertical,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PermissionGate } from "@/components/PermissionGate";
import { cn } from "@/lib/utils";
import { safeFormat } from "@/lib/format";
import { RowIdentity } from "./RowIdentity";
import type { KursunDistributionAssignedRow } from "./types";

interface Props {
  row: KursunDistributionAssignedRow;
  /** Makine İÇİNDEKİ sıra. */
  index: number;
  selected: boolean;
  onToggleSelect: () => void;
  busy: boolean;
  /** Sürükleme açık mı (kuyruk sıralama yetkisi). */
  canReorder: boolean;
  onCancelRequest: (row: KursunDistributionAssignedRow) => void;
  onToggleUrgent: (row: KursunDistributionAssignedRow) => void;
  onComplete: (row: KursunDistributionAssignedRow) => void;
}

/**
 * Bir makinedeki TEK iş satırı.
 *
 * Sürükleme kimliği `workOrderStepId`'dir (`assignmentId` DEĞİL): sıralama
 * `WorkOrderStep.priority` yazar ve backend'e giden payload adım id'si ister —
 * iki kimlik ayrışırsa sürükleme sessizce yanlış satırı numaralar. SEÇİM de aynı
 * kimliği kullanır (`selection.ts` başlığındaki gerekçe).
 */
export function AssignedRow({
  row,
  index,
  selected,
  onToggleSelect,
  busy,
  canReorder,
  onCancelRequest,
  onToggleUrgent,
  onComplete,
}: Props) {
  const sortable = useSortable({ id: row.workOrderStepId, disabled: !canReorder });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <li ref={sortable.setNodeRef} style={style}>
      <Card
        className={cn(
          "rounded-none border-0 shadow-none",
          row.isUrgent && "bg-destructive/5",
          row.stale && "bg-warning/5",
          selected && "bg-primary/5",
          sortable.isDragging && "ring-ring ring-2",
        )}
      >
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
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

          <div className="text-muted-foreground shrink-0 text-right text-[11px]">
            <div>{safeFormat(row.assignedAt, "dd.MM HH:mm")}</div>
            <div>{row.assignedByName ?? "—"}</div>
          </div>

          <PermissionGate permission="workorder:distribute">
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant={row.isUrgent ? "destructive" : "outline"}
                className="gap-1"
                disabled={busy}
                onClick={() => onToggleUrgent(row)}
              >
                <AlertOctagon className="h-3.5 w-3.5" />
                {row.isUrgent ? "Acil Kaldır" : "Acil Yap"}
              </Button>

              {row.isLastStep && (
                <Button
                  type="button"
                  size="sm"
                  className="bg-success text-success-foreground hover:bg-success/90 gap-1"
                  disabled={busy}
                  onClick={() => onComplete(row)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  İşi Bitir
                </Button>
              )}

              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={busy}
                onClick={() => onCancelRequest(row)}
              >
                <X className="h-3.5 w-3.5" />
                Havuza Al
              </Button>
            </div>
          </PermissionGate>

          {row.stale && (
            <div className="text-warning-foreground border-warning/50 bg-warning/10 flex w-full items-start gap-2 rounded-md border p-2 text-[11px]">
              <AlertTriangle className="text-warning mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <Badge variant="outline" className="mr-1 text-[10px]">
                  Bayat dağıtım
                </Badge>
                {row.staleReason ?? "Bu atama artık anlamsız — kaldırılması önerilir."}
              </span>
            </div>
          )}

          {row.notes && (
            <div className="text-muted-foreground w-full text-[11px]">
              Not: {row.notes}
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  );
}
