import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertOctagon, GripVertical, Package, Share2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { safeFormat } from "@/lib/format";
import type { KursunQueueItem } from "./types";

interface Props {
  item: KursunQueueItem;
  /** Kuyruktaki sıra (düz liste — gruplama yok). */
  index: number;
  onToggleUrgent: () => void;
  busy: boolean;
  /** Sıralama yetkisi (quality:write). Yoksa sürükleme kapatılır — backend 403 döner. */
  canReorder: boolean;
}

export function KursunQueueRow({
  item,
  index,
  onToggleUrgent,
  busy,
  canReorder,
}: Props) {
  const sortable = useSortable({ id: item.workOrderStepId, disabled: !canReorder });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <li ref={sortable.setNodeRef} style={style}>
      <Card
        className={cn(
          "transition-colors",
          item.isUrgent && "border-destructive/40 bg-destructive/5",
          sortable.isDragging && "ring-ring ring-2",
        )}
      >
        <CardContent className="flex items-center gap-3 p-3">
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

          {item.isUrgent && (
            <Badge variant="destructive" className="gap-1 text-[10px]">
              <AlertOctagon className="h-3 w-3" /> ACİL
            </Badge>
          )}

          {/* KARIŞIK REJİM rozeti: bayrak yeni açıldı, bir kısım iş hâlâ tablet
              akışında bekliyor. Makine adı da yazılır — planlamacı hangi işin
              hangi kurşun makinesine düştüğünü satırdan görsün (gruplama YOK,
              o yüzey Kurşun Dağıtım ekranıdır). */}
          {item.bypassAssigned && (
            <Badge
              variant="outline"
              className="gap-1 text-[10px]"
              title="Bu iş kurşun dağıtımına verildi — kurşun/KK2 tablette okutulmayacak, Tambur kartı okuttuğunda tamamlanmış sayılacak."
            >
              <Share2 className="h-3 w-3" />
              {item.bypassMachineName ? `Bypass · ${item.bypassMachineName}` : "Bypass"}
            </Badge>
          )}

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold">
                {item.travelerCardNumber ?? "—"}
              </span>
              <span className="truncate font-medium">
                {item.itemName ?? "—"}
              </span>
              {item.colorName ? (
                <Badge variant="muted" className="gap-1.5 px-2 text-[10px]">
                  {item.colorHex && (
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full border border-border"
                      style={{ backgroundColor: item.colorHex }}
                      aria-hidden
                    />
                  )}
                  {item.colorName}
                </Badge>
              ) : (
                <Badge variant="muted" className="text-[10px]">
                  Renk —
                </Badge>
              )}
            </div>

            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
              <span className="font-mono">Parti: {item.batchNumber}</span>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Package className="h-3 w-3" />
                {item.openRollCount} top ·{" "}
                {item.totalCurrentQty.toLocaleString("tr-TR", { useGrouping: false })} m
              </span>
              {item.oldestEnteredAt && (
                <span>
                  İlk giriş: {safeFormat(item.oldestEnteredAt, "dd.MM HH:mm")}
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
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
          </div>
        </CardContent>
      </Card>
    </li>
  );
}
