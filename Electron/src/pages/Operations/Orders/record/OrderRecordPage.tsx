// =============================================================================
// SİPARİŞ — TAM KAYIT SAYFASI (`operations/orders/:id`, 2026-11-12)
// =============================================================================
// Kimlik şeridi + eylemler (izin/modül kapılı) + sayı kartları (hazır ve dolu olanlar) + sekmeler.
// Sekme yalnız kapısı açık VE verisi varsa görünür (`order-record-tabs`); etkin sekme URL'de `?sekme=`.
// Termin düz bilgi: gün sayacı / gecikme rozeti yok (kullanıcı kararı).
// =============================================================================
import { useEffect, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { FileX } from "lucide-react";
import { toneForKey } from "@/components/ui/icon-tile";
import { Button } from "@/components/ui/button";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { RecordPageShell } from "@/components/record/RecordPageShell";
import { RecordAvatar, RecordEmpty } from "@/components/record/RecordBits";
import { usePricingEnabled } from "@/hooks/usePricingEnabled";
import { useTabsStore } from "@/store/tabs";
import type { Order } from "../types";
import { ORDER_LIST_PATH, ORDER_TAB_PARAM, orderRecordPath } from "./order-record";
import { useOrderRecordTabs, type OrderTabKey } from "./order-record-tabs";
import { OrderStatusChip, dayText } from "./OrderRecordBits";
import { OrderRecordActions } from "./OrderRecordActions";
import { OrderGeneralTab, orderStatCards } from "./OrderGeneralTab";
import { OrderLinesTab } from "./OrderLinesTab";
import { OrderProductionTab } from "./OrderProductionTab";
import { OrderDocumentsTab, OrderHistoryTab, OrderShipmentsTab } from "./OrderOtherTabs";
import { useOrderFormHost } from "./useOrderFormHost";
import { useOrderMovements } from "./useOrderMovements";
import { useOrderAccess, useOrderRecord } from "./useOrderRecordData";

const PARENT = { label: "Siparişler", to: ORDER_LIST_PATH };

/** Sekme çubuğunda sipariş no (cari kayıt sayfası emsali). */
function useOrderTabTitle(id: string, title: string | undefined) {
  useEffect(() => {
    if (!title) return;
    const tab = useTabsStore.getState().tabs.find((t) => t.path.split("?")[0] === orderRecordPath(id));
    if (tab) useTabsStore.getState().updateTabTitle(tab.id, title);
  }, [id, title]);
}

export function OrderRecordPage() {
  const { id = "" } = useParams();
  const q = useOrderRecord(id);
  useOrderTabTitle(id, q.data?.orderNumber);
  if (q.isLoading) return <OrderRecordMessage text="Yükleniyor…" />;
  if (q.isError || !q.data) {
    return <OrderRecordMessage text={q.isError ? "Sipariş alınamadı ya da bulunamadı." : "Sipariş bulunamadı."} action={q.isError ? <Button size="sm" variant="outline" onClick={() => void q.refetch()}>Tekrar dene</Button> : null} />;
  }
  return <OrderRecordView order={q.data} />;
}

function OrderRecordView({ order }: { order: Order }) {
  const [params, setParams] = useSearchParams();
  const access = useOrderAccess();
  const pricing = usePricingEnabled();
  const form = useOrderFormHost();
  const moves = useOrderMovements(order, access, 10);
  const tabs = useOrderRecordTabs(order, access);
  const asked = params.get(ORDER_TAB_PARAM);
  const active = (tabs.some((t) => t.key === asked) ? asked : "genel") as OrderTabKey;
  const setTab = (k: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (k === "genel") next.delete(ORDER_TAB_PARAM);
      else next.set(ORDER_TAB_PARAM, k);
      return next;
    }, { replace: true });

  const content: Record<OrderTabKey, () => ReactNode> = {
    genel: () => <OrderGeneralTab order={order} moves={moves} />,
    kalemler: () => <OrderLinesTab order={order} production={access.production} />,
    uretim: () => <OrderProductionTab order={order} access={access} />,
    sevkiyatlar: () => <OrderShipmentsTab orderId={order.id} canOpen={access.shipments} />,
    belgeler: () => <OrderDocumentsTab order={order} />,
    gecmis: () => <OrderHistoryTab orderId={order.id} />,
  };
  const subtitle = [order.customer?.name, dayText(order.orderDate), order.deadline ? `Termin ${dayText(order.deadline)}` : null].filter(Boolean).join(" · ");

  return (
    <>
      <RecordPageShell
        parent={PARENT}
        title={order.orderNumber}
        avatar={<RecordAvatar name={order.customer?.name ?? order.orderNumber} tone={toneForKey(order.customerId)} size="lg" />}
        badges={<span data-record-badges="" className="flex items-center gap-1"><OrderStatusChip order={order} /></span>}
        subtitle={<span className="truncate" title={subtitle}>{subtitle}</span>}
        actions={<OrderRecordActions order={order} onEdit={form.openEdit} />}
        stats={orderStatCards(order, pricing)}
        tabs={tabs}
        activeTab={active}
        onTabChange={setTab}
      >
        {content[active]()}
      </RecordPageShell>
      {form.dialogs}
    </>
  );
}

function OrderRecordMessage({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <PageShell>
      <PageBody className="p-6">
        <RecordEmpty icon={FileX} text={text} action={action} />
      </PageBody>
    </PageShell>
  );
}
