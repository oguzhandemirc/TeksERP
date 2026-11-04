import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatFactory } from "@/lib/factory-time";
import { Card, CardContent } from "@/components/ui/card";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { WhereCell } from "./OrderWhereCells";
import { fmtNum, orderShipText, stepTrailText, woDetailLines } from "./order-where-text";
import { orderService } from "./service";
import type { Order, OrderWhereStep, OrderWhereWorkOrder } from "./types";

const STEP_CLASS: Record<OrderWhereStep["asama"], string> = {
  GECTI: "text-success",
  BURADA: "font-semibold text-info",
  SIRADA: "text-muted-foreground",
};

/** Rota ilerleme çizgisi: `✓ Ham kontrol → ● Fason (Akın Boya, 8 top, 3 gündür) → ○ Tambur`. */
export function StepTrail({ wo }: { wo: OrderWhereWorkOrder }) {
  if (wo.adimlar.length === 0) return null;
  return (
    <div data-testid="where-trail" className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs">
      {wo.adimlar.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && <span className="text-muted-foreground">→</span>}
          <span className={cn(STEP_CLASS[s.asama], s.asama === "BURADA" && s.fasonTop > 0 && "text-warning")}>
            {stepTrailText(s, wo)}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/** Bir iş emrinin kartı: no + kumaş/renk/hedef, ilerleme çizgisi, aşama başına top/metre, son hareket. */
export function WhereWoCard({ wo }: { wo: OrderWhereWorkOrder }) {
  const subtitle = [wo.kumas, wo.renk, wo.hedefMetre != null ? `hedef ${fmtNum(wo.hedefMetre)} m` : null]
    .filter(Boolean)
    .join(" · ");
  const lines = woDetailLines(wo);
  return (
    <li data-testid="where-wo" className="space-y-1 rounded-md border p-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-xs font-semibold">{wo.no}</span>
        {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
      </div>
      <StepTrail wo={wo} />
      {lines.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {/* Aşama tablet okutmasıyla güncellenir; son hareket ekranın ne kadar taze olduğunu söyler. */}
      <div className="text-[11px] text-muted-foreground">
        Son hareket: {wo.sonHareket ? formatFactory(wo.sonHareket, "dd.MM.yyyy HH:mm") : "kayıt yok"}
      </div>
    </li>
  );
}

/**
 * Sipariş detayında "Nerede?" — bağlı her iş emri için ilerleme kartı. Sipariş başına
 * TEK istek (`GET /api/orders/:id/where`). Üretim kapalıyken istek atılmaz; eski
 * sunucuda (uç yok) ya da hata anında kart çizilmez, panel akışı bozulmaz.
 */
export function OrderWhereCard({ order, open }: { order: Pick<Order, "id" | "status" | "shippedQty" | "manualClosedById" | "lines">; open: boolean }) {
  const productionEnabled = useFeatureFlags().data?.data?.productionEnabled ?? true;
  const q = useQuery({
    queryKey: ["orders", "where", order.id],
    queryFn: () => orderService.getWhere(order.id).catch(() => null),
    enabled: open && productionEnabled && !!order.id,
    staleTime: 30_000,
  });
  const data = q.data?.data ?? null;
  if (!productionEnabled || !data) return null;
  return (
    <Card data-testid="order-where-card">
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" /> Nerede?
        </div>
        <WhereCell order={{ nerede: data.nerede, manualClosedById: order.manualClosedById }} />
        <div className="text-xs">{orderShipText(order)}</div>
        {data.isEmirleri.length > 0 && (
          <ul className="space-y-1.5">
            {data.isEmirleri.map((wo) => (
              <WhereWoCard key={wo.id} wo={wo} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
