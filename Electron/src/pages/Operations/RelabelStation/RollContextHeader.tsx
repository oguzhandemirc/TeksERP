import { AlertTriangle, MapPin, PackageX, Printer, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { rollStatusLabels, type RollStatus } from "@/types/enums";
import { shipmentStatusLabels, type ShipmentStatus } from "@/pages/Operations/Shipments/types";
import type { RelabelContext, RelabelLastLabelSnapshot } from "./types";

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-muted-foreground">
      <Tag className="h-8 w-8 opacity-50" />
      <p className="max-w-sm text-sm">
        Barkodu okut veya yaz — topun spec'ini düzelt (renk/kalite/en/özellik) ya da
        farklı bir müşteri için etiketi yeniden bas.
      </p>
    </div>
  );
}

/** Okutulan topun künyesi + konum/guard satırı. showClear=false → "Temizle" gizlenir
 *  (modalda gereksiz; Dialog'un kendi kapatma tuşu var). */
export function RollContextHeader({
  ctx,
  onClear,
  showClear = true,
}: {
  ctx: RelabelContext;
  onClear: () => void;
  showClear?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold">
              {ctx.barcode ?? "— (barkodsuz açık kumaş)"}
            </span>
            <Badge variant="outline">{rollStatusLabels[ctx.status as RollStatus] ?? ctx.status}</Badge>
            {ctx.markedForKartela && (
              <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100">Kartelalık</Badge>
            )}
            {ctx.labelDirty && (
              <Badge
                className="gap-1 bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300"
                title="Veri/metraj düzeltildi; topun üstündeki fiziksel etiket eski — yeniden basılmalı."
              >
                <AlertTriangle className="h-3 w-3" /> Etiket güncel değil
              </Badge>
            )}
          </div>
          <div className="text-sm font-medium">
            {ctx.item.code} — {ctx.item.name}
          </div>
          {/* Renk/Kalite/En aşağıdaki formda düzenlenebilir → burada tekrar etme.
              Yalnız salt-okunur miktarları göster (metraj/ağırlık). */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>Metraj: {ctx.currentQty} mt</span>
            {ctx.weightKg != null && <span>Ağırlık: {ctx.weightKg} kg</span>}
          </div>
          {(ctx.shipment || ctx.sack) && (
            <div className="flex items-center gap-1 text-xs text-amber-700">
              <MapPin className="h-3 w-3 shrink-0" />
              {ctx.shipment && (
                <span>
                  Sevkiyat {ctx.shipment.shipmentNo} (
                  {shipmentStatusLabels[ctx.shipment.status as ShipmentStatus] ?? ctx.shipment.status})
                </span>
              )}
              {ctx.sack && (
                <span>
                  {" · "}Çuval #{ctx.sack.seq}
                  {ctx.sack.sackNo ? ` (${ctx.sack.sackNo})` : ""}
                </span>
              )}
            </div>
          )}
        </div>
        {showClear && (
          <Button size="sm" variant="ghost" onClick={onClear} className="gap-1">
            <PackageX className="h-3.5 w-3.5" /> Temizle
          </Button>
        )}
      </div>
    </div>
  );
}

/** Son basılan etiketin künyesi ("A") — başka müşteriye basmadan önce referans. */
export function LastLabelBanner({ snap }: { snap: RelabelLastLabelSnapshot | null }) {
  if (!snap || snap.stock || !snap.customerName) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        <Printer className="h-3.5 w-3.5 shrink-0" />
        Bu top için müşteri etiketi henüz basılmadı
        {snap?.stock ? " (son baskı: stok/müşterisiz)" : ""}.
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
      <Printer className="h-3.5 w-3.5 shrink-0" />
      <span>
        Son basıldığı yer (A): <strong>{snap.customerName}</strong>
        {snap.orderNumber ? ` · ${snap.orderNumber}` : ""}
        {snap.printedAt ? ` · ${new Date(snap.printedAt).toLocaleString("tr-TR")}` : ""}
        {snap.operatorName ? ` · ${snap.operatorName}` : ""}
      </span>
    </div>
  );
}
