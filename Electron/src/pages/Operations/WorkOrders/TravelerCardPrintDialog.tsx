import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Printer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { workOrderTypeLabels } from "@/types/enums";
import { safeFormat, formatNumber } from "@/lib/format";
import { workOrderService } from "./service";
import type { WorkOrder, TravelerCard } from "./types";

interface Props {
  workOrder: WorkOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TravelerCardPrintDialog({ workOrder, open, onOpenChange }: Props) {
  const cardQuery = useQuery({
    queryKey: ["traveler-cards", workOrder?.id],
    queryFn: () => workOrderService.getTravelerCardHistory(workOrder!.id),
    enabled: open && Boolean(workOrder?.id),
    staleTime: 30_000,
  });

  const activeCard = useMemo<TravelerCard | null>(() => {
    const cards = cardQuery.data?.data ?? [];
    return cards.find((c) => c.status === "ACTIVE") ?? cards[0] ?? null;
  }, [cardQuery.data?.data]);

  const sortedSteps = useMemo(
    () => (workOrder?.steps ? [...workOrder.steps].sort((a, b) => a.stepSequence - b.stepSequence) : []),
    [workOrder?.steps],
  );

  const handlePrint = () => {
    window.print();
  };

  if (!workOrder) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col">
        <DialogHeader className="print:hidden">
          <DialogTitle>Refakat Kartı</DialogTitle>
          <DialogDescription>
            İş emri ile birlikte üretim sahasında dolaşacak kart. Yazdır butonuyla
            sistem yazıcı diyaloğunu aç.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto print:overflow-visible">
          {cardQuery.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}

          {!cardQuery.isLoading && (
            <div className="print-area space-y-4 rounded-md border p-6">
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Refakat Kartı
                </div>
                <div className="font-mono text-2xl font-bold">{workOrder.batchNumber}</div>
                <div className="text-xs text-muted-foreground">
                  {workOrderTypeLabels[workOrder.type]}
                  {workOrder.routeTemplate && <> · {workOrder.routeTemplate.name}</>}
                </div>
              </div>
              <div className="text-right">
                {activeCard ? (
                  <>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      Kart No
                    </div>
                    <div className="font-mono text-base font-semibold">
                      {activeCard.cardNumber}
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      v{activeCard.version} · {safeFormat(activeCard.printedAt, "dd.MM.yyyy HH:mm")}
                    </div>
                  </>
                ) : (
                  <div className="text-xs italic text-muted-foreground">
                    Aktif kart bulunamadı
                  </div>
                )}
              </div>
            </div>

            {activeCard && (
              <div className="flex items-center justify-center gap-6 rounded-md bg-muted/40 py-4">
                <div className="rounded-md bg-white p-2">
                  <QRCodeSVG
                    value={activeCard.barcode}
                    size={150}
                    level="M"
                    marginSize={0}
                  />
                </div>
                <div className="flex flex-col">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Barkod
                  </div>
                  <div className="font-mono text-lg font-bold tracking-widest">
                    {activeCard.barcode}
                  </div>
                  <div className="mt-2 text-[10px] text-muted-foreground">
                    Tabletle QR'ı okut veya barkodu manuel gir.
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              {workOrder.targetItem && (
                <>
                  <div className="text-muted-foreground">Hedef Ürün</div>
                  <div className="font-medium">
                    <span className="font-mono mr-1">{workOrder.targetItem.code}</span>
                    {workOrder.targetItem.name}
                  </div>
                </>
              )}
              {workOrder.targetItem?.color && (
                <>
                  <div className="text-muted-foreground">Renk</div>
                  <div>{workOrder.targetItem.color.name}</div>
                </>
              )}
              {workOrder.width != null && (
                <>
                  <div className="text-muted-foreground">En</div>
                  <div>{workOrder.width} cm</div>
                </>
              )}
              {workOrder.targetQuantity != null && (
                <>
                  <div className="text-muted-foreground">Hedef Metraj</div>
                  <div>{formatNumber(workOrder.targetQuantity, 0)} m</div>
                </>
              )}
              {workOrder.recipeNo && (
                <>
                  <div className="text-muted-foreground">Reçete No</div>
                  <div className="font-mono">{workOrder.recipeNo}</div>
                </>
              )}
              <div className="text-muted-foreground">Planlı Başlangıç</div>
              <div>{safeFormat(workOrder.plannedStartDate, "dd.MM.yyyy") || "—"}</div>
              <div className="text-muted-foreground">Planlı Bitiş</div>
              <div>{safeFormat(workOrder.plannedEndDate, "dd.MM.yyyy") || "—"}</div>
            </div>

            {workOrder.targetProperties && workOrder.targetProperties.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Üretim Özellikleri
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {workOrder.targetProperties.map((p) => (
                    <span
                      key={p.propertyId}
                      className="rounded border px-1.5 py-0.5"
                    >
                      {p.property.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                Rota Adımları
              </div>
              <ol className="space-y-0.5 text-sm">
                {sortedSteps.map((step) => (
                  <li
                    key={step.id}
                    className="flex items-center gap-2 border-b border-dashed py-1 last:border-b-0"
                  >
                    <span className="w-6 text-center font-mono text-xs">
                      {step.stepSequence}.
                    </span>
                    <span className="flex-1 font-medium">
                      {step.station?.name ?? "—"}
                    </span>
                    {step.station?.code && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {step.station.code}
                      </span>
                    )}
                    {step.station?.type === "EXTERNAL" && (
                      <span className="rounded border px-1 text-[9px] uppercase text-muted-foreground">
                        Fason
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>

            {workOrder.orderLinks && workOrder.orderLinks.length > 0 && (
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Bağlı Siparişler
                </div>
                <ul className="space-y-0.5 text-xs">
                  {workOrder.orderLinks.map((link) => {
                    const ol = link.orderLine;
                    return (
                      <li
                        key={link.orderLineId}
                        className="flex items-center gap-2 border-b border-dashed py-1 last:border-b-0"
                      >
                        <span className="font-mono">
                          {ol?.order?.orderNumber ?? "—"}
                        </span>
                        <span className="text-muted-foreground">·</span>
                        <span>{ol?.order?.customer?.name ?? "—"}</span>
                        <span className="ml-auto">
                          {ol?.item?.name}
                          {ol?.quantity != null && (
                            <span className="ml-1 text-muted-foreground">
                              ({formatNumber(ol.quantity, 0)} m)
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="border-t pt-2 text-[10px] text-muted-foreground">
              Bu kart üretim sahasında topla birlikte dolaşır. Her istasyonda barkod okutulur.
            </div>
          </div>
          )}
        </div>

        <DialogFooter className="print:hidden">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          <Button type="button" onClick={handlePrint} disabled={!activeCard} className="gap-1">
            <Printer className="h-4 w-4" /> Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
