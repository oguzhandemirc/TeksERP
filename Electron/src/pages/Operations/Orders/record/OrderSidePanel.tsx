// Sipariş — yan panel (hızlı bakış): kimlik + istenen/sevk/kalan metre + kalem özeti (ilk 5) + son hareketler
// + hızlı eylemler. Liste görünür kalır; "Tam sayfa" kayıt sayfasına gider.
import { useNavigate } from "react-router-dom";
import { CalendarClock, CalendarDays, Coins, Store } from "lucide-react";
import { RecordSidePanel } from "@/components/record/RecordSidePanel";
import { RecordActivityList } from "@/components/record/RecordActivityList";
import { RecordFacts, RecordSectionTitle } from "@/components/record/RecordBits";
import { usePricingEnabled } from "@/hooks/usePricingEnabled";
import { formatMoney } from "@/lib/format";
import type { Order } from "../types";
import { activeLineBriefs, ORDER_TAB_PARAM, orderMetreFigures, orderRecordPath } from "./order-record";
import { dayText, movementWhen, OrderIdentity, OrderLineBriefList, OrderMetreBlock } from "./OrderRecordBits";
import { OrderQuickActions } from "./OrderQuickActions";
import { useOrderAccess } from "./useOrderRecordData";
import { useOrderMovements } from "./useOrderMovements";

export const PANEL_LINE_LIMIT = 5;

interface Props {
  order: Order;
  onClose: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onEdit: ((o: Order) => void) | null;
}

export function OrderSidePanel({ order, onClose, onPrev, onNext, onEdit }: Props) {
  const navigate = useNavigate();
  const access = useOrderAccess();
  const pricing = usePricingEnabled();
  const moves = useOrderMovements(order, access);
  const figures = orderMetreFigures(order);
  const lineCount = activeLineBriefs(order.lines).length;
  const full = orderRecordPath(order.id);
  return (
    <RecordSidePanel
      label={`Sipariş: ${order.orderNumber}`}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
      onOpenFull={() => navigate(full)}
      header={<OrderIdentity order={order} />}
      footer={<OrderQuickActions order={order} onEdit={onEdit} />}
    >
      {figures && <OrderMetreBlock figures={figures} />}
      <RecordFacts
        facts={[
          { key: "date", label: "Sipariş tarihi", icon: CalendarDays, value: dayText(order.orderDate) },
          { key: "branch", label: "Şube", icon: Store, value: order.branch?.name },
          { key: "deadline", label: "Termin", icon: CalendarClock, value: dayText(order.deadline) },
          { key: "amount", label: "Tutar", icon: Coins, value: pricing && order.totalAmount ? formatMoney(order.totalAmount, order.currency) : null },
        ]}
      />
      <section>
        <RecordSectionTitle
          action={
            lineCount > PANEL_LINE_LIMIT ? (
              <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => navigate(`${full}?${ORDER_TAB_PARAM}=kalemler`)}>
                Tümü ({lineCount})
              </button>
            ) : null
          }
        >
          Kalemler
        </RecordSectionTitle>
        <OrderLineBriefList order={order} max={PANEL_LINE_LIMIT} />
      </section>
      <section>
        <RecordSectionTitle>Son hareketler</RecordSectionTitle>
        <RecordActivityList
          loading={moves.loading}
          error={moves.error}
          onRetry={moves.retry}
          emptyText="Henüz hareket yok."
          items={moves.items.map((m) => ({ ...m, title: m.docNo, when: movementWhen(m.at), onOpen: m.to ? () => navigate(m.to!) : null }))}
        />
      </section>
    </RecordSidePanel>
  );
}
