import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertOctagon, Building2, GripVertical, Trash2, User } from "lucide-react";
import { safeFormat } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge, shippingQueueTones } from "@/components/operations/StatusBadge";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { cn } from "@/lib/utils";
import { shippingQueueStatusLabels, type ShippingQueueItem } from "./types";

interface Props {
  item: ShippingQueueItem;
  index: number;
  onToggleUrgent: () => void;
  onRemove: () => void;
  busy: boolean;
}

export function QueueRow({
  item,
  index,
  onToggleUrgent,
  onRemove,
  busy,
}: Props) {
  const sortable = useSortable({
    id: item.id,
    disabled: item.status !== "WAITING",
  });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  const draggable = item.status === "WAITING";
  const progressPct =
    item.order.totalRequestedQty > 0
      ? Math.min(
          100,
          Math.round(
            (item.order.totalAllocatedQty / item.order.totalRequestedQty) * 100,
          ),
        )
      : 0;

  return (
    <li ref={sortable.setNodeRef} style={style}>
      <Card
        className={cn(
          "transition-colors",
          item.isUrgent && "border-destructive/40 bg-destructive/5",
          sortable.isDragging && "ring-ring ring-2",
        )}
      >
        <CardContent className="flex items-start gap-3 p-3">
          <button
            type="button"
            {...sortable.attributes}
            {...sortable.listeners}
            disabled={!draggable}
            className={cn(
              "text-muted-foreground hover:text-foreground mt-1",
              draggable
                ? "cursor-grab active:cursor-grabbing"
                : "cursor-not-allowed opacity-30",
            )}
            aria-label="Sürükle"
          >
            <GripVertical className="h-4 w-4" />
          </button>

          <div className="bg-muted mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-mono text-xs">
            {index + 1}
          </div>

          {item.isUrgent && (
            <Badge variant="destructive" className="mt-1 gap-1 text-[10px]">
              <AlertOctagon className="h-3 w-3" /> ACİL
            </Badge>
          )}

          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold">
                {item.order.orderNumber}
              </span>
              <span className="truncate font-medium">
                {item.order.customer.name}
              </span>
              <StatusBadge
                status={item.status}
                labels={shippingQueueStatusLabels}
                tones={shippingQueueTones}
                className="text-[10px]"
              />
              {item.order.branch && (
                <Badge variant="muted" className="gap-1 px-1.5 text-[10px]">
                  <Building2 className="h-2.5 w-2.5" />
                  {item.order.branch.name}
                </Badge>
              )}
              <span className="text-muted-foreground text-[11px] tabular-nums">
                {item.order.lines.length} kalem ·{" "}
                {item.order.totalRequestedQty.toLocaleString("tr-TR")} m
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                <div
                  className={cn(
                    "h-full transition-all",
                    progressPct === 100
                      ? "bg-emerald-500"
                      : progressPct > 0
                        ? "bg-blue-500"
                        : "bg-muted-foreground/20",
                  )}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="text-muted-foreground text-[11px] tabular-nums">
                {item.order.totalAllocatedQty.toLocaleString("tr-TR")}/
                {item.order.totalRequestedQty.toLocaleString("tr-TR")} m ·{" "}
                {progressPct}%
              </span>
            </div>

            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              {item.order.deadline && (
                <DeadlineBadge deadline={item.order.deadline} />
              )}
              {item.assignedOperator && (
                <span className="inline-flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {item.assignedOperator.fullName}
                </span>
              )}
              {item.takenAt && (
                <span>Alındı: {safeFormat(item.takenAt, "dd.MM HH:mm")}</span>
              )}
              {item.completedAt && (
                <span>
                  Tamamlandı: {safeFormat(item.completedAt, "dd.MM HH:mm")}
                </span>
              )}
              {item.cancelledAt && item.cancelReason && (
                <span>İptal: {item.cancelReason}</span>
              )}
            </div>

            {item.note && (
              <p className="text-muted-foreground line-clamp-1 text-xs">
                Not: {item.note}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {(item.status === "WAITING" || item.status === "TAKEN") && (
              <Button
                type="button"
                size="sm"
                variant={item.isUrgent ? "destructive" : "outline"}
                className="gap-1"
                disabled={busy}
                onClick={onToggleUrgent}
              >
                <AlertOctagon className="h-3.5 w-3.5" />
                {item.isUrgent ? "Acil Kaldır" : "Acil Yap"}
              </Button>
            )}

            {item.status === "WAITING" && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="text-destructive h-8 w-8"
                disabled={busy}
                onClick={onRemove}
                aria-label="Kuyruktan çıkar"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </li>
  );
}
