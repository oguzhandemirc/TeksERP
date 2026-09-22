import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Globe, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { cn } from "@/lib/utils";
import { sackStoreService } from "./service";
import { destinationLabels, type SackStoreShipment, type ShipmentDestination } from "./types";
import { destinationSourceLabels, useDestinationLock } from "@/pages/Operations/SackContentEdit/destinationDefault";

/**
 * Planlı sevkiyatın yönü. Yön cariden/şubeden kilitliyse yalnız "karttaki yöne
 * eşitle" (sevkiyat eski değeri dondurduysa); zincir boşsa ilk seçim — sunucu
 * onu karta yazar. Sevk edilmiş sevkiyatta yön değişmez (sunucu PLANNED ister).
 */
export function ShipmentDestinationAlign({ shipment, onMutated }: { shipment: SackStoreShipment; onMutated: () => void }) {
  const lockQ = useDestinationLock(shipment.customer.id, shipment.branch?.id ?? null);
  const lock = lockQ.data;
  const destMut = useMutation({
    mutationFn: (d: ShipmentDestination) => sackStoreService.setDestination(shipment.id, d),
    onSuccess: (res) => {
      toast.success(res.message ?? "Güncellendi");
      void lockQ.refetch();
      onMutated();
    },
  });
  const current = <Badge variant="outline">{destinationLabels[shipment.destination]}</Badge>;
  const planned = shipment.status === "PLANNED";

  if (lock?.destination) {
    const differs = lock.destination !== shipment.destination;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        {current}
        {lock.source && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Lock className="h-3 w-3" /> {destinationSourceLabels[lock.source]} {destinationLabels[lock.destination]}
          </span>
        )}
        {differs && planned && (
          <PermissionGate permission="shipping:write">
            <Button size="sm" variant="outline" className="h-6 text-[11px]" disabled={destMut.isPending} onClick={() => destMut.mutate(lock.destination!)}>
              Karttaki yöne eşitle ({destinationLabels[lock.destination]})
            </Button>
          </PermissionGate>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Globe className="h-3.5 w-3.5 text-muted-foreground" />
      <PermissionGate permission="shipping:write" fallback={current}>
        {planned && lock ? (
          <div className="flex items-center gap-1 rounded-md border p-0.5">
            {(["DOMESTIC", "EXPORT"] as const).map((d) => (
              <button
                key={d}
                type="button"
                disabled={destMut.isPending}
                onClick={() => destMut.mutate(d)}
                className={cn(
                  "rounded px-2 py-0.5 font-medium transition-colors",
                  shipment.destination === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {destinationLabels[d]}
              </button>
            ))}
          </div>
        ) : (
          current
        )}
      </PermissionGate>
      {planned && lock && (
        <span className="text-[10px] text-muted-foreground">
          Seçim {shipment.branch ? "şubenin" : "carinin"} kartına yazılır ve kilitlenir.
        </span>
      )}
    </div>
  );
}
