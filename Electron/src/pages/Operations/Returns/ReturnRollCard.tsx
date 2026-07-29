import type { ReturnLookupResult } from "./service";

const DEC = new Intl.NumberFormat("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

/** İade girişinde sorgulanan topun kimlik kartı (barkod, metraj, kumaş, müşteri/sevk). */
export function ReturnRollCard({ result }: { result: ReturnLookupResult }) {
  const roll = result.roll;
  return (
    <div className="space-y-1 rounded-md border bg-card/40 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-semibold">
          {roll.barcode ?? roll.id.slice(0, 8)}
        </span>
        <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
          {DEC.format(roll.currentQty)} m
        </span>
      </div>
      <div className="text-sm text-muted-foreground">
        {roll.item?.name ?? "—"}
        {roll.color ? ` · ${roll.color.name}` : ""}
        {roll.width != null ? ` · ${roll.width} cm` : ""}
        {roll.qualityGrade ? ` · ${roll.qualityGrade}` : ""}
      </div>
      <div className="text-xs text-muted-foreground">
        {result.customer?.name ?? "—"}
        {result.shipment ? ` · ${result.shipment.shipmentNo}` : ""}
      </div>
    </div>
  );
}
