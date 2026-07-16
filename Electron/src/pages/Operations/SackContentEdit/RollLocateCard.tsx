import { MapPin, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { shipmentStatusLabels, type LocatedRoll } from "./types";

const ROLL_STATUS_LABEL: Record<string, string> = {
  STOCK: "Stokta",
  IN_PRODUCTION: "Üretimde",
  AT_SUBCONTRACTOR: "Fasonda",
  WAREHOUSE: "Hazır Depo",
  SHIPPED: "Sevk Edildi",
  FIRE: "Fire",
  SCRAP: "Hurda",
  CANCELLED: "İptal",
};

/** "Bu top nerede?" cevabı — barkod okutulunca liste üstünde gösterilir. */
export function RollLocateCard({ roll, onClear }: { roll: LocatedRoll; onClear: () => void }) {
  // Birleşik ad (ürün + renk + en) — boş parçalar atlanır.
  const rollName = [
    roll.item.name,
    roll.color?.name,
    roll.width != null ? `${roll.width}cm` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const location = roll.sack
    ? `Çuval ${roll.sack.sackNo}`
    : roll.shipment
      ? "Sevkiyatta (çuvalsız)"
      : (ROLL_STATUS_LABEL[roll.status] ?? roll.status);

  return (
    <div className="mx-6 mt-4 flex items-start gap-3 rounded-lg border-2 border-primary/50 bg-primary/5 px-4 py-3 shadow-sm">
      <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-base font-semibold">{roll.barcode}</span>
          <Badge variant="outline" className="text-[10px]">
            {ROLL_STATUS_LABEL[roll.status] ?? roll.status}
          </Badge>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {rollName || roll.item.name} ·{" "}
          {roll.currentQty.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 })} m
        </div>
        <div className="mt-1.5 text-sm">
          <span className="font-semibold">Yeri: </span>
          <span className="font-medium text-primary">{location}</span>
          {roll.shipment && (
            <>
              {" — "}
              {roll.shipment.shipmentNo} ({shipmentStatusLabels[roll.shipment.status]}) ·{" "}
              {roll.shipment.customer.name}
              {roll.shipment.branch
                ? ` / ${roll.shipment.branch.name}${roll.shipment.branch.code ? ` (${roll.shipment.branch.code})` : ""}`
                : ""}
            </>
          )}
        </div>
      </div>
      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onClear} aria-label="Kapat">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
