import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import type { OrderStatus } from "@/types/enums";
import { NeredeCell } from "./OrderNeredeCells";
import { orderQtyText, orderSevkText } from "./order-cell-text";
import { orderService } from "./service";
import type { OrderNeredeStep, OrderNeredeWorkOrder } from "./types";

const STEP_GLYPH: Record<OrderNeredeStep["state"], string> = { DONE: "✓", CURRENT: "●", TODO: "○" };

/** Rota ilerleme çizgisi: `✓ Ham kontrol → ● Boyahane (Fason) → ○ Tambur`. Yalnız ad + işaret; cümle sunucudan. */
export function StepTrail({ steps }: { steps: OrderNeredeStep[] }) {
  if (steps.length === 0) return null;
  return (
    <div data-testid="nerede-trail" className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs">
      {steps.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && <span className="text-muted-foreground">→</span>}
          <span
            className={cn(
              s.state === "DONE" && "text-success",
              s.state === "CURRENT" && (s.isExternal ? "font-semibold text-warning" : "font-semibold text-info"),
              s.state === "TODO" && "text-muted-foreground",
            )}
          >
            {STEP_GLYPH[s.state]} {s.name}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function qtyText(n: number | null, unit: string | null): string | null {
  if (n == null) return null;
  return orderQtyText(n, unit);
}

/** Bir iş emrinin kartı: başlık, ilerleme çizgisi, aşama başına top/metre, sevke hazır, son hareket. */
export function NeredeWoCard({ wo }: { wo: OrderNeredeWorkOrder }) {
  const busy = wo.steps.filter((s) => s.rollCount > 0);
  const target = qtyText(wo.targetQuantity, wo.unit);
  const subtitle = [wo.itemName, wo.colorName, target ? `hedef ${target}` : null].filter(Boolean).join(" · ");
  return (
    <li data-testid="nerede-wo" className="space-y-1 rounded-md border p-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-xs font-semibold">{wo.workOrderNumber}</span>
        {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
      </div>
      <StepTrail steps={wo.steps} />
      {(busy.length > 0 || wo.ready.text) && (
        <ul className="space-y-0.5 text-xs">
          {busy.map((s) => (
            <li key={s.id}>{s.text}</li>
          ))}
          {wo.ready.text && <li className="text-success">{wo.ready.text}</li>}
        </ul>
      )}
      <div className="text-[11px] text-muted-foreground">
        Son hareket: {wo.lastMovementText ?? "kayıt yok"}
      </div>
    </li>
  );
}

/**
 * Sipariş detayında "Nerede?" — bağlı her iş emri için ilerleme. Sipariş başına
 * TEK istek (`GET /api/orders/:id/nerede`). Eski sunucuda uç yoksa kart çizilmez.
 */
export function OrderNeredeCard({
  orderId,
  status,
  open,
}: {
  orderId: string;
  /** Onaysız/iptal siparişte sunucu cümlesi yerine durum etiketi yazılır (`orderSevkText`). */
  status: OrderStatus;
  open: boolean;
}) {
  const q = useQuery({
    queryKey: ["orders", "nerede", orderId],
    // Bilgi kartı: eski sunucuda (uç yok) ya da hata anında kart çizilmez, panel akışı bozulmaz.
    queryFn: () => orderService.getNerede(orderId).catch(() => null),
    enabled: open && !!orderId,
    staleTime: 30_000,
  });
  const data = q.data?.data ?? null;
  if (!data) return null;
  return (
    <Card data-testid="order-nerede-card">
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" /> Nerede?
        </div>
        <NeredeCell order={data} />
        <div className="text-xs">{orderSevkText({ status, sevk: data.sevk })}</div>
        {data.workOrders.length > 0 && (
          <ul className="space-y-1.5">
            {data.workOrders.map((wo) => (
              <NeredeWoCard key={wo.id} wo={wo} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
