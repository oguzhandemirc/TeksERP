import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { safeFormat } from "@/lib/format";
import { shippingQueueService, type OrphanRoll } from "./service";

const QUERY_KEY = "orphan-rolls";

export function OrphanRollsSection() {
  const qc = useQueryClient();
  const [selectedLine, setSelectedLine] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: [QUERY_KEY],
    queryFn: () => shippingQueueService.orphanRolls(),
  });

  const rolls = query.data?.data ?? [];

  const assignMut = useMutation({
    mutationFn: ({
      rollId,
      orderLineId,
    }: {
      rollId: string;
      orderLineId: string;
    }) => shippingQueueService.assignOrphanRoll(rollId, orderLineId),
    onSuccess: (res) => {
      toast.success(res.message ?? "Top siparişe bağlandı");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      void qc.invalidateQueries({ queryKey: ["ready-orders"] });
      void qc.invalidateQueries({ queryKey: ["shipping-queue"] });
    },
  });

  if (query.isLoading) {
    return (
      <section className="rounded-md border">
        <div className="border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Atanmamış Hazır Toplar</h2>
        </div>
        <div className="space-y-2 p-2">
          <Skeleton className="h-12 w-full" />
        </div>
      </section>
    );
  }

  if (rolls.length === 0) return null;

  return (
    <section className="rounded-md border border-amber-300 bg-amber-50/40 dark:bg-amber-950/10">
      <header className="flex items-center justify-between gap-2 border-b border-amber-300 px-3 py-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <div>
            <h2 className="text-sm font-semibold">Atanmamış Hazır Toplar</h2>
            <p className="text-muted-foreground text-xs">
              Eski paketlemeden kalan, siparişe bağlanmamış toplar — uygun
              satıra bağla veya "Stoktan Sevkiyat" ile gönder.
            </p>
          </div>
        </div>
        <Badge variant="destructive" className="text-[10px]">
          {rolls.length} top
        </Badge>
      </header>
      <ul className="divide-y">
        {rolls.map((roll) => (
          <OrphanRollRow
            key={roll.rollId}
            roll={roll}
            selectedLineId={selectedLine[roll.rollId] ?? ""}
            onSelectLine={(lineId) =>
              setSelectedLine((s) => ({ ...s, [roll.rollId]: lineId }))
            }
            onAssign={() => {
              const lineId = selectedLine[roll.rollId];
              if (!lineId) {
                toast.error("Önce sipariş satırı seçin");
                return;
              }
              assignMut.mutate({ rollId: roll.rollId, orderLineId: lineId });
            }}
            isAssigning={assignMut.isPending}
          />
        ))}
      </ul>
    </section>
  );
}

interface RowProps {
  roll: OrphanRoll;
  selectedLineId: string;
  onSelectLine: (lineId: string) => void;
  onAssign: () => void;
  isAssigning: boolean;
}

function OrphanRollRow({
  roll,
  selectedLineId,
  onSelectLine,
  onAssign,
  isAssigning,
}: RowProps) {
  const matchingLines =
    roll.plannedOrder?.lines.filter((l) => l.itemId === roll.itemId) ?? [];
  const hasMatchingLines = matchingLines.length > 0;

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-semibold">
            {roll.barcode}
          </span>
          <span className="text-muted-foreground font-mono text-[10px]">
            {roll.itemCode}
          </span>
          <span className="font-medium">{roll.itemName}</span>
          {roll.variantName && (
            <Badge variant="muted" className="text-[10px]">
              {roll.variantName}
            </Badge>
          )}
          <Badge variant="muted" className="text-[10px]">
            {roll.qualityGrade}
          </Badge>
          <span className="text-muted-foreground text-xs tabular-nums">
            {roll.currentQty.toFixed(1)} m
            {roll.weightKg != null && ` · ${roll.weightKg.toFixed(1)} kg`}
            {roll.width != null && ` · ${roll.width} cm`}
          </span>
        </div>
        <div className="text-muted-foreground text-[11px]">
          {roll.plannedOrder ? (
            <>
              Planlı sipariş:{" "}
              <span className="font-mono">{roll.plannedOrder.orderNumber}</span>
              {" · "}
              {roll.plannedOrder.customerName}
              {roll.plannedOrder.deadline && (
                <>
                  {" · Termin: "}
                  {safeFormat(roll.plannedOrder.deadline, "dd.MM.yyyy")}
                </>
              )}
            </>
          ) : (
            <span className="italic">Planlı sipariş bilgisi yok (stok)</span>
          )}
          {roll.packagingDate && (
            <>
              {" · "}Paketleme:{" "}
              {safeFormat(roll.packagingDate, "dd.MM.yyyy HH:mm")}
            </>
          )}
        </div>
      </div>

      {hasMatchingLines ? (
        <div className="flex shrink-0 items-center gap-2">
          <Select value={selectedLineId} onValueChange={onSelectLine}>
            <SelectTrigger className="h-8 w-72 text-xs">
              <SelectValue placeholder="Sipariş satırı seç..." />
            </SelectTrigger>
            <SelectContent>
              {matchingLines.map((line) => (
                <SelectItem key={line.lineId} value={line.lineId}>
                  <span className="font-mono text-[10px]">{line.itemCode}</span>
                  {" · "}
                  {line.itemName}
                  {line.colorName && ` · ${line.colorName}`}
                  {line.variantName && ` · ${line.variantName}`}
                  {line.width != null && ` · ${line.width}cm`}
                  {" · "}
                  {line.requestedQty.toLocaleString("tr-TR")}m
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!selectedLineId || isAssigning}
            onClick={onAssign}
            className="gap-1.5"
          >
            <Link2 className="h-3.5 w-3.5" /> Bağla
          </Button>
        </div>
      ) : (
        <Badge variant="outline" className="text-[10px]">
          Eşleşen satır yok — stoktan sevk edin
        </Badge>
      )}
    </li>
  );
}
