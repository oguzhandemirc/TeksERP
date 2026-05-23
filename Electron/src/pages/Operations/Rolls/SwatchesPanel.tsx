import { useQuery } from "@tanstack/react-query";
import { Palette, Ruler, Boxes } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { safeFormat } from "@/lib/format";
import { swatchService } from "./swatchService";

export function SwatchesPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["swatches", { limit: 200 }],
    queryFn: () => swatchService.list({ limit: 200 }),
  });

  const swatches = data?.data ?? [];

  return (
    <div className="flex flex-1 flex-col overflow-auto p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Boxes className="h-4 w-4 text-muted-foreground" />
        Kartela Envanteri
        <Badge variant="secondary">{swatches.length}</Badge>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : swatches.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Henüz kartela basılmadı. Kartelalar Tambur ekranından üretilir.
        </p>
      ) : (
        <div className="space-y-2">
          {swatches.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/40"
            >
              <Palette className="h-5 w-5 shrink-0 text-purple-500" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{s.barcode}</span>
                  <Badge variant="outline" className="text-[10px]">
                    No: {s.cardNumber}
                  </Badge>
                  {s.item && (
                    <Badge variant="outline" className="text-[10px]">
                      {s.item.code} {s.item.name}
                    </Badge>
                  )}
                  {s.color && (
                    <Badge variant="secondary" className="gap-1 text-[10px]">
                      {s.color.hex && (
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: s.color.hex }}
                        />
                      )}
                      {s.color.name}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Ruler className="h-3 w-3" /> {s.length.toFixed(2)} m
                  </span>
                  {s.width != null && <span>En: {s.width} cm</span>}
                  {s.workOrder && <span>Parti: {s.workOrder.batchNumber}</span>}
                  {s.parentRoll && s.parentRoll.barcode && (
                    <span>Kaynak: {s.parentRoll.barcode}</span>
                  )}
                  <span className="tabular-nums">
                    {safeFormat(s.createdAt, "dd.MM.yyyy HH:mm")}
                  </span>
                </div>
                {s.purpose && (
                  <p className="mt-1 text-[11px] italic text-muted-foreground">
                    {s.purpose}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
