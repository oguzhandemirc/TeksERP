// Üretim sekmesi — bağlı iş emirleri ("Nerede?" ucu: aşama, hazır/giden metre, son hareket) ve bağlı dokuma işleri.
// Kaynak kapalıysa bölüm çizilmez; satır yalnız hedef ekran açılabiliyorsa tıklanır.
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { IconTileTone } from "@/components/ui/icon-tile";
import { SectionCard } from "@/components/ui/section-card";
import { RecordTable } from "@/components/record/RecordTable";
import { ToneChip } from "@/components/record/RecordBits";
import { formatMeasure, formatQty } from "@/lib/format";
import { formatFactory } from "@/lib/factory-time";
import { TERIM } from "@/lib/terim";
import { workOrderStatusLabels, type WorkOrderStatus } from "@/types/enums";
import { WEAVING_STATUS_META, type WeavingOrderStatus } from "@/pages/Operations/WeavingOrders/types";
import { orderService } from "../service";
import type { Order, OrderWhereWorkOrder } from "../types";
import { linkedWorkOrders } from "./order-movements";
import { dayText } from "./OrderRecordBits";
import { orderWeavingQuery, type OrderAccess } from "./useOrderRecordData";

const WO_TONE: Record<WorkOrderStatus, IconTileTone> = { PLANNED: "sky", IN_PROGRESS: "violet", COMPLETED: "green", CANCELLED: "rose", SUPERSEDED: "teal" };
const WEAVING_TONE: Record<WeavingOrderStatus, IconTileTone> = { PLANNED: "sky", IN_PROGRESS: "violet", COMPLETED: "green", CANCELLED: "rose" };

/** "Nerede?" ucu yoksa (eski sunucu/hata) kalem bağından no + durum. */
function woRows(order: Order, where: OrderWhereWorkOrder[] | undefined): OrderWhereWorkOrder[] {
  if (where && where.length > 0) return where;
  return linkedWorkOrders(order.lines).map((w) => ({ id: w.id, no: w.workOrderNumber, durum: w.status, kumas: null, renk: null, hedefMetre: null, adimlar: [], fason: [], hazir: { topSayisi: 0, metre: 0 }, gitti: { topSayisi: 0, metre: 0 }, sonHareket: null }));
}

const currentStep = (w: OrderWhereWorkOrder) => w.adimlar.filter((s) => s.asama === "BURADA").map((s) => s.ad).join(", ") || null;

function WorkOrdersSection({ order, canOpen }: { order: Order; canOpen: boolean }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["orders", "where", order.id], queryFn: () => orderService.getWhere(order.id).catch(() => null), staleTime: 30_000 });
  const rows = woRows(order, q.data?.data?.isEmirleri);
  if (!q.isLoading && rows.length === 0) return null;
  return (
    <SectionCard title={TERIM.terbiyeIsEmri.cogul} flush>
      <RecordTable
        rows={rows}
        loading={q.isLoading}
        rowKey={(w) => w.id}
        onRowClick={canOpen ? (w) => navigate(`/operations/work-orders/${w.id}`) : null}
        rowMuted={(w) => w.durum === "CANCELLED" || w.durum === "SUPERSEDED"}
        emptyText="Bağlı kayıt yok."
        columns={[
          { key: "no", label: "No", render: (w) => <span className="font-mono font-semibold">{w.no}</span> },
          { key: "item", label: "Kumaş", className: "max-w-[16rem] truncate", title: (w) => [w.kumas, w.renk].filter(Boolean).join(" · "), render: (w) => [w.kumas, w.renk].filter(Boolean).join(" · ") || "—" },
          { key: "status", label: "Durum", render: (w) => <ToneChip tone={WO_TONE[w.durum]}>{workOrderStatusLabels[w.durum]}</ToneChip> },
          { key: "step", label: "Aşama", className: "max-w-[12rem] truncate", title: currentStep, render: (w) => currentStep(w) ?? "—" },
          { key: "target", label: "Hedef", align: "right", render: (w) => (w.hedefMetre != null ? formatMeasure(w.hedefMetre, "m") : "—") },
          { key: "ready", label: "Hazır", align: "right", render: (w) => (w.hazir.metre > 0 ? formatMeasure(w.hazir.metre, "m") : "—") },
          { key: "gone", label: "Giden", align: "right", render: (w) => (w.gitti.metre > 0 ? formatMeasure(w.gitti.metre, "m") : "—") },
          { key: "last", label: "Son hareket", render: (w) => (w.sonHareket ? formatFactory(w.sonHareket, "dd.MM.yyyy HH:mm") : "—") },
        ]}
      />
    </SectionCard>
  );
}

function WeavingSection({ orderId }: { orderId: string }) {
  const q = useQuery(orderWeavingQuery(orderId));
  if (!q.isLoading && (q.data ?? []).length === 0) return null;
  return (
    <SectionCard title={TERIM.dokumaIsEmri.cogul} flush>
      <RecordTable
        rows={q.data ?? []}
        loading={q.isLoading}
        error={q.isError}
        onRetry={() => void q.refetch()}
        rowKey={(w) => w.id}
        rowMuted={(w) => w.status === "CANCELLED"}
        emptyText="Bağlı kayıt yok."
        columns={[
          { key: "no", label: "No", render: (w) => <span className="font-mono font-semibold">{w.weavingOrderNumber}</span> },
          { key: "item", label: "Kumaş", className: "max-w-[16rem] truncate", title: (w) => [w.item?.name, w.color?.name].filter(Boolean).join(" · "), render: (w) => [w.item?.name, w.color?.name].filter(Boolean).join(" · ") || "—" },
          { key: "status", label: "Durum", render: (w) => <ToneChip tone={WEAVING_TONE[w.status]}>{WEAVING_STATUS_META[w.status].label}</ToneChip> },
          { key: "planned", label: "Planlanan", align: "right", render: (w) => (w.plannedM != null ? formatMeasure(w.plannedM, "m") : "—") },
          { key: "rolls", label: "Top", align: "right", render: (w) => (w.producedRollCount != null ? formatQty(w.producedRollCount) : "—") },
          { key: "opened", label: "Açılış", render: (w) => dayText(w.createdAt) ?? "—" },
        ]}
      />
    </SectionCard>
  );
}

export function OrderProductionTab({ order, access }: { order: Order; access: OrderAccess }) {
  return (
    <div className="space-y-4">
      {access.workOrders && <WorkOrdersSection order={order} canOpen={access.workOrders} />}
      {access.weaving && <WeavingSection orderId={order.id} />}
    </div>
  );
}
