// Kalemler sekmesi — sıkı tablo + sheet'teki iki kalem eylemi AYNEN: uyumlu kalemlerden iş emri oluştur
// (tek İE = tek kumaş/renk/en; kural `line-wo-selection`) ve kalem iptali (mevcut önizlemeli diyalog).
import { useMemo, useState } from "react";
import { Factory } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { RecordTable } from "@/components/record/RecordTable";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { usePricingEnabled } from "@/hooks/usePricingEnabled";
import { TERIM } from "@/lib/terim";
import { useTabsStore } from "@/store/tabs";
import { buildPicked } from "@/pages/Operations/WorkOrders/OrderPickerDialog";
import { OrderLineCancelDialog } from "../OrderLineCancelDialog";
import { diffLabel, lineRem, lineSig } from "../line-wo-selection";
import { useOrderLineCustomerNames } from "../useOrderLineCustomerNames";
import type { Order, OrderLine } from "../types";
import { isOrderEditable } from "./order-record";
import { orderLineColumns, type LineRowState } from "./order-line-columns";

function useLineSelection(order: Order) {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const selected = order.lines.filter((l) => ids.has(l.id));
  const anchor = selected[0];
  const rowState = (l: OrderLine): LineRowState => {
    const rem = lineRem(l);
    const open = l.cancelledAt == null && (rem === null || rem > 0);
    const dimmed = open && anchor != null && lineSig(l) !== lineSig(anchor);
    return { selectable: open, selected: ids.has(l.id), disabledReason: dimmed && anchor ? `${diffLabel(anchor, l)} — seçilemez` : null };
  };
  const toggle = (l: OrderLine) =>
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(l.id)) next.delete(l.id);
      else next.add(l.id);
      return next;
    });
  return { selected, rowState, toggle, clear: () => setIds(new Set()) };
}

export function OrderLinesTab({ order, production }: { order: Order; production: boolean }) {
  const { hasPermission } = useRoleAccess();
  const pricing = usePricingEnabled();
  const openTab = useTabsStore((s) => s.openTab);
  const [cancelLineId, setCancelLineId] = useState<string | null>(null);
  const customerNames = useOrderLineCustomerNames(order, true);
  const sel = useLineSelection(order);
  const woSelect = production && isOrderEditable(order) && hasPermission("workorder:write");
  const canCancel = hasPermission("order:write");
  const columns = orderLineColumns({
    currency: order.currency,
    pricing,
    canCancel,
    woSelect,
    rowState: sel.rowState,
    onToggle: sel.toggle,
    onCancel: (l) => setCancelLineId(l.id),
    customerName: (l) => { const c = customerNames(l); return [c.item, c.color].filter(Boolean).join(" · ") || null; },
  });
  const active = useMemo(() => order.lines.filter((l) => l.cancelledAt == null).length, [order.lines]);
  const cancelled = order.lines.length - active;
  const createWo = () => {
    // Seçili kalemler İE formuna tohumlanır; yeni sekmede açılır, bu sayfa yerinde kalır.
    const picked = sel.selected.map((l) => buildPicked(order, { ...l, openQty: lineRem(l) }));
    openTab("/operations/work-orders/new", { forceNew: true, state: { seedPickedLines: picked } });
    sel.clear();
  };
  return (
    <SectionCard
      title="Kalemler"
      description={`${active} kalem${cancelled > 0 ? ` · ${cancelled} iptal` : ""}`}
      action={
        woSelect ? (
          <Button size="sm" className="gap-1.5" onClick={createWo} disabled={sel.selected.length === 0} title={sel.selected.length === 0 ? "Önce aynı kumaş · renk · en kalemleri seç" : undefined}>
            <Factory className="h-3.5 w-3.5" />
            {TERIM.terbiyeIsEmri.cumleBasi.yalin} oluştur{sel.selected.length > 0 ? ` (${sel.selected.length})` : ""}
          </Button>
        ) : null
      }
      flush
    >
      <RecordTable rows={order.lines} rowKey={(l) => l.id} rowMuted={(l) => Boolean(l.cancelledAt)} columns={columns} emptyText="Kalem yok." />
      <OrderLineCancelDialog open={Boolean(cancelLineId)} onOpenChange={(o) => !o && setCancelLineId(null)} orderId={order.id} lineId={cancelLineId} onCancelled={() => setCancelLineId(null)} />
    </SectionCard>
  );
}
