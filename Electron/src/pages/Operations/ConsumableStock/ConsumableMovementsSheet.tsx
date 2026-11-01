// Sarf kaleminin hareketleri — yeni → eski, sunucu cursor'ı; ters kayıtlar ve geri alınmış tüketim işaretli.
import { useInfiniteQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { factoryLocaleString } from "@/lib/factory-time";
import { CONSUMABLE_KIND_LABEL, listConsumableMovements, type ConsumableMovementRow, type ConsumableStockRow } from "./service";

function source(m: ConsumableMovementRow): string {
  if (m.receipt) return `Fiş ${m.receipt.receiptNo}`;
  if (m.roll) return `Top ${m.roll.barcode}${m.workOrder ? ` · ${m.workOrder.workOrderNumber}` : ""}`;
  return m.reason ?? "—";
}

export function ConsumableMovementsSheet({ row, onClose }: { row: ConsumableStockRow | null; onClose: () => void }) {
  const q = useInfiniteQuery({
    queryKey: ["consumable-movements", row?.itemId],
    queryFn: ({ pageParam }) => listConsumableMovements(row!.itemId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    enabled: Boolean(row),
  });
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? [];
  return (
    <Sheet open={Boolean(row)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col sm:max-w-[720px]">
        <SheetHeader>
          <SheetTitle className="pr-8">{row ? `${row.name} — hareketler` : "…"}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-auto">
          {q.isError ? (
            <p className="p-4 text-sm text-destructive">Hareketler yüklenemedi — bağlantıyı ve yetkinizi kontrol edin.</p>
          ) : rows.length === 0 && !q.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Bu kalem için henüz hareket yok.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="p-2">Tarih</th>
                  <th className="p-2">Hareket</th>
                  <th className="p-2 text-right">Miktar ({row?.unit})</th>
                  <th className="p-2">Kaynak</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="border-t">
                    <td className="p-2 whitespace-nowrap">{factoryLocaleString(m.createdAt)}</td>
                    <td className="p-2">
                      {CONSUMABLE_KIND_LABEL[m.kind]}
                      {m.reversed && <Badge variant="outline" className="ml-2">geri alındı</Badge>}
                    </td>
                    <td className="p-2 text-right tabular-nums">{m.signedQty}</td>
                    <td className="p-2">{source(m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {q.hasNextPage && (
          <Button variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            Daha fazla
          </Button>
        )}
      </SheetContent>
    </Sheet>
  );
}
