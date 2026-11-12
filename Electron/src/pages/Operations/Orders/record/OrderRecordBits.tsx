// Sipariş kayıt kalıbı — küçük parçalar: kimlik, metre özeti (istenen/sevk/kalan + çubuk), kalem özeti.
// Termin düz tarihtir: gün sayacı / gecikme rozeti YOK (kullanıcı kararı).
import { toneForKey } from "@/components/ui/icon-tile";
import { AnimatedProgress } from "@/components/motion/AnimatedProgress";
import { RecordAvatar, ToneChip } from "@/components/record/RecordBits";
import { formatDisplay, formatMeasure, safeFormat } from "@/lib/format";
import { factoryDayKey, formatFactory } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import type { Order } from "../types";
import { activeLineBriefs, orderStatusChip, type OrderMetreFigures } from "./order-record";

export const dayText = (iso: string | null | undefined) => (iso ? safeFormat(iso, "dd.MM.yyyy") : null);

/** Hareket zamanı: bugünse saat, değilse gün (fabrika dilimi). */
export function movementWhen(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  return factoryDayKey(iso) === factoryDayKey(now) ? formatFactory(iso, "HH:mm") : formatFactory(iso, "dd.MM.yyyy");
}

export function OrderStatusChip({ order, className }: { order: Pick<Order, "status" | "shippedQty" | "manualClosedById" | "lines">; className?: string }) {
  const chip = orderStatusChip(order);
  return <ToneChip tone={chip.tone} className={cn("whitespace-nowrap", className)}>{chip.label}</ToneChip>;
}

export function OrderIdentity({ order }: { order: Order }) {
  const sub = order.customer?.name ?? "";
  return (
    <div className="flex min-w-0 items-center gap-3">
      <RecordAvatar name={order.customer?.name ?? order.orderNumber} tone={toneForKey(order.customerId)} />
      <div className="min-w-0">
        <p className="truncate font-mono text-base font-bold leading-tight" title={order.orderNumber}>{order.orderNumber}</p>
        <p className="truncate text-xs text-muted-foreground" title={sub}>{sub}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          <OrderStatusChip order={order} />
        </div>
      </div>
    </div>
  );
}

/** Üç sayı + sevk çubuğu (yan panel). */
export function OrderMetreBlock({ figures }: { figures: OrderMetreFigures }) {
  const cells = [
    { key: "req", label: "İstenen", value: figures.requested },
    { key: "ship", label: "Sevk edilen", value: figures.shipped },
    { key: "rem", label: "Kalan", value: figures.remaining },
  ];
  return (
    <section data-order-metre="" className="rounded-xl border border-border/70 bg-muted/30 p-3">
      <dl className="grid grid-cols-3 gap-2">
        {cells.map((c) => (
          <div key={c.key} className="min-w-0">
            <dt className="truncate text-[11px] font-medium text-muted-foreground">{c.label}</dt>
            <dd className="truncate text-base font-bold tabular-nums">{formatMeasure(c.value, "m")}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 flex items-center gap-2">
        <AnimatedProgress value={figures.pct} className="h-1.5 flex-1" />
        <span className="text-xs font-semibold tabular-nums text-muted-foreground">%{formatDisplay(figures.pct, 0)}</span>
      </div>
    </section>
  );
}

/** Kalem özeti — kumaş · renk · miktar; ilk `max` satır. */
export function OrderLineBriefList({ order, max }: { order: Pick<Order, "lines">; max: number }) {
  const lines = activeLineBriefs(order.lines);
  if (lines.length === 0) return <p className="py-2 text-sm text-muted-foreground">Aktif kalem yok.</p>;
  return (
    <ul className="divide-y divide-border/60">
      {lines.slice(0, max).map((l) => (
        <li key={l.key} className="flex items-center gap-2 py-1.5 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium" title={l.item}>{l.item}</span>
          {l.color && (
            <span className="flex max-w-[40%] shrink-0 items-center gap-1.5 truncate text-xs text-muted-foreground" title={l.color}>
              {l.hex && <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full border border-border" style={{ backgroundColor: l.hex }} />}
              <span className="truncate">{l.color}</span>
            </span>
          )}
          <span className="w-20 shrink-0 text-right font-semibold tabular-nums">{formatMeasure(l.qty, l.unit)}</span>
        </li>
      ))}
    </ul>
  );
}
