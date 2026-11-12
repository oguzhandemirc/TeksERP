// Sipariş kayıt sayfası — sayı kartları + Genel sekmesi. Kart yalnız hazır ve dolu veriyle; tutar siparişin KENDİ
// para birimiyle (sunucunun `totalAmount`ı), toplanmaz. Termin düz tarih: gün sayacı / gecikme rozeti YOK.
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, CalendarClock, CalendarDays, Coins, Lock, PackageCheck, Ruler, Store, Truck, Undo2, User } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { SectionCard } from "@/components/ui/section-card";
import { RecordActivityList } from "@/components/record/RecordActivityList";
import { RecordFacts } from "@/components/record/RecordBits";
import { formatMeasure, formatMoney } from "@/lib/format";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { CoveragePanel } from "@/pages/Operations/WorkOrders/CoveragePanel";
import { returnsService } from "@/pages/Operations/Returns/service";
import type { Order } from "../types";
import { orderMetreFigures } from "./order-record";
import { dayText, movementWhen } from "./OrderRecordBits";
import type { OrderMovementsState } from "./useOrderMovements";

export function orderStatCards(order: Order, pricing: boolean): ReactNode[] {
  const cards: ReactNode[] = [];
  const f = orderMetreFigures(order);
  if (f) {
    cards.push(<StatCard key="req" layout="compact" label="İstenen" icon={Ruler} tone="violet" value={formatMeasure(f.requested, "m")} />);
    cards.push(<StatCard key="ship" layout="compact" label="Sevk edilen" icon={Truck} tone="blue" value={formatMeasure(f.shipped, "m")} hint={`%${f.pct}`} />);
    cards.push(<StatCard key="rem" layout="compact" label="Kalan" icon={PackageCheck} tone="teal" value={formatMeasure(f.remaining, "m")} />);
  }
  if (pricing && order.totalAmount && Number(order.totalAmount) > 0) {
    cards.push(<StatCard key="amount" layout="compact" label="Tutar" icon={Coins} tone="amber" value={formatMoney(order.totalAmount, order.currency)} />);
  }
  return cards;
}

function OrderReturnsFact({ orderId }: { orderId: string }) {
  const q = useQuery({ queryKey: ["returns", "order-summary", orderId], queryFn: () => returnsService.summaryForOrder(orderId), staleTime: 30_000 });
  if (!q.data || q.data.count === 0) return null;
  return (
    <p className="mt-3 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
      <Undo2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      <span className="text-muted-foreground">Gelen iade</span>
      <span className="ml-auto font-semibold tabular-nums">{q.data.count} top · {formatMeasure(q.data.totalQty, "m")}</span>
    </p>
  );
}

export function OrderGeneralTab({ order, moves }: { order: Order; moves: OrderMovementsState }) {
  const navigate = useNavigate();
  const open = order.status !== "CANCELLED" && order.status !== "COMPLETED";
  const branch = order.branch ? [order.branch.name, order.branch.district, order.branch.city].filter(Boolean).join(", ") : null;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-4">
        <SectionCard title="Sipariş bilgileri">
          <RecordFacts
            facts={[
              { key: "cust", label: "Müşteri", icon: User, value: order.customer ? `${order.customer.name} (${order.customer.code})` : null },
              { key: "branch", label: "Şube", icon: Store, value: branch },
              { key: "date", label: "Sipariş tarihi", icon: CalendarDays, value: dayText(order.orderDate) },
              { key: "deadline", label: "Termin", icon: CalendarClock, value: dayText(order.deadline) },
              { key: "cur", label: "Para birimi", icon: Coins, value: order.currency },
              { key: "done", label: "Tamamlandı", icon: CalendarCheck, value: order.completedAt ? fmtFactoryDateTime(order.completedAt) : null },
              { key: "close", label: "Kapatma sebebi", icon: Lock, value: order.manualCloseReason },
            ]}
          />
          <OrderReturnsFact orderId={order.id} />
        </SectionCard>
        {open && (
          <CoveragePanel lineIds={order.lines.filter((l) => l.cancelledAt == null).map((l) => l.id)} />
        )}
      </div>
      <SectionCard title="Son hareketler">
        <RecordActivityList
          loading={moves.loading}
          error={moves.error}
          onRetry={moves.retry}
          emptyText="Henüz hareket yok."
          items={moves.items.map((m) => ({ ...m, title: m.docNo, when: movementWhen(m.at), onOpen: m.to ? () => navigate(m.to!) : null }))}
        />
      </SectionCard>
    </div>
  );
}
