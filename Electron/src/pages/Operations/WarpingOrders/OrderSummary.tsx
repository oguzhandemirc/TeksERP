// Sipariş sayfası üst bilgi bloğu: hedef · levent satırları · termin · ücret · fire · müşteri siparişi · not.
import type { ReactNode } from "react";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { beamLinesText, dueText, feeText, fmtM, trimNum } from "./order-model";
import type { WarpingOrder } from "./types";

function Item({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function OrderSummary({ o }: { o: WarpingOrder }) {
  const due = dueText(o.expectedReturnAt, o.status);
  const reed = [
    o.warpSpec.reedNo && `tarak ${o.warpSpec.reedNo}`,
    o.warpSpec.reedWidthCm && `${trimNum(o.warpSpec.reedWidthCm)} cm`,
    o.warpSpec.endsPerDent && `dişe ${o.warpSpec.endsPerDent} tel`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
      {/* Başlık açıklaması yalnız ⓘ ipucunda görünür; kart ve devereci gövdede de okunmalı. */}
      <Item label="Çözgü kartı" className="sm:col-span-2">
        <span className="font-medium">{o.warpSpec.name}</span>{" "}
        <span className="font-mono text-xs text-muted-foreground">{o.warpSpec.code}</span>
      </Item>
      <Item label="Devereci" className="sm:col-span-2">
        <span className="font-medium">{o.subcontractor.name}</span>
      </Item>
      <Item label="Hedef">
        <span className="font-medium tabular-nums">{fmtM(o.targetLengthM)} m</span> · {o.beamCount} levent
        <span className="block text-xs text-muted-foreground">{beamLinesText(o.beamLines)}</span>
      </Item>
      <Item label="Termin">
        <span className={cn(due.late && "font-medium text-destructive")}>{due.text}</span>
      </Item>
      <Item label="Devere ücreti">{feeText(o.fee)}</Item>
      <Item label="Fire">
        Sabit {fmtM(o.fixedWasteM)} m · tolerans{" "}
        {o.wasteTolerancePct === null ? "denetim yok" : `%${trimNum(o.wasteTolerancePct)}`}
      </Item>
      <Item label="Müşteri siparişi">
        {o.salesOrders.length === 0
          ? "Bağsız — stoğa çözgü"
          : o.salesOrders.map((s) => `${s.orderNumber} (${s.customerName})`).join(", ")}
      </Item>
      <Item label="Ek tel grubu">
        {o.extraSpecs.length === 0 ? "—" : o.extraSpecs.map((x) => x.code).join(", ")}
      </Item>
      <Item label="Tarak">{reed || "—"}</Item>
      <Item label="Açılış">{fmtFactoryDateTime(o.createdAt)}</Item>
      {o.warpSpec.sequenceNote && (
        <Item label="Dizilim" className="sm:col-span-2">
          {o.warpSpec.sequenceNote}
        </Item>
      )}
      {o.notes && (
        <Item label="Not" className="sm:col-span-2">
          {o.notes}
        </Item>
      )}
      {o.cancelledAt && (
        <Item label="İptal" className="sm:col-span-2">
          {fmtFactoryDateTime(o.cancelledAt)} — {o.cancelReason ?? "sebep yok"}
        </Item>
      )}
    </dl>
  );
}
