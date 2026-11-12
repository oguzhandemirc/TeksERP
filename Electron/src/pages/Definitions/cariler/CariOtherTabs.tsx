// Cari kayıt sayfası — Fason · Alışlar · Geçmiş sekmeleri. Her biri MEVCUT bir okuma ucunu carinin süzgeciyle
// kullanır (son 50). Geçmiş yalnız AYAK İZİ gösterimidir: buradan sayı/durum türetilmez.
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { IconTileTone } from "@/components/ui/icon-tile";
import { SectionCard } from "@/components/ui/section-card";
import { RecordTable } from "@/components/record/RecordTable";
import { ToneChip } from "@/components/record/RecordBits";
import { TERIM } from "@/lib/terim";
import { systemLogService } from "@/services/systemLogService";
import type { SystemLogListItem } from "@/types/systemLog";
import { listGoodsReceipts } from "@/pages/Operations/GoodsReceipts/service";
import { listPurchaseOrders, type PurchaseOrderStatus } from "@/pages/Operations/PurchaseOrders/service";
import { PO_STATUS_LABEL, RECEIPT_STATUS_LABEL } from "@/pages/Operations/PurchaseOrders/labels";
import { formatFactory } from "@/lib/factory-time";
import { formatNumber } from "@/lib/format";
import { fetchFasonDispatches } from "./cari-sources";
import { metre } from "./cari-movements";
import { gunCari } from "./cari-time";
import { CARI_TAB_LIMIT as LIMIT } from "./CariCommerceTabs";

const PO_TONE: Record<PurchaseOrderStatus, IconTileTone> = { OPEN: "blue", PARTIAL: "violet", CLOSED: "green", CANCELLED: "rose" };

export const cariFasonQuery = (subcontractorId: string) => ({ queryKey: ["subcontractor", "dispatches", "cari-tab", subcontractorId], queryFn: () => fetchFasonDispatches(subcontractorId, LIMIT) });
export const cariPurchaseOrdersQuery = (supplierId: string) => ({
  queryKey: ["purchase-orders", "cari-tab", supplierId],
  queryFn: () => listPurchaseOrders({ page: 1, pageSize: LIMIT, supplierId }).then((r) => r.data),
});
export const cariReceiptsQuery = (supplierId: string) => ({
  queryKey: ["goods-receipts", "cari-tab", supplierId],
  queryFn: () => listGoodsReceipts({ page: 1, pageSize: LIMIT, filter: { supplierId } }).then((r) => r.data),
});
export const cariHistoryQuery = (customerId: string) => ({
  queryKey: ["system-logs", "cari-tab", customerId],
  queryFn: () => systemLogService.list({ tableName: "CUSTOMER", recordId: customerId, limit: LIMIT }).then((r) => r.data),
});

export function CariFasonTab({ subcontractorId, canOpenWorkOrder }: { subcontractorId: string; canOpenWorkOrder: boolean }) {
  const navigate = useNavigate();
  const q = useQuery(cariFasonQuery(subcontractorId));
  return (
    <SectionCard title="Fasona gidenler" description={`En yeni ${LIMIT} fason sevki`} flush>
      <RecordTable
        rows={q.data ?? []}
        loading={q.isLoading}
        error={q.isError}
        onRetry={() => void q.refetch()}
        emptyText="Bu fasoncuya sevk yok."
        rowKey={(d) => d.id}
        onRowClick={canOpenWorkOrder ? (d) => d.workOrder && navigate(`/operations/work-orders/${d.workOrder.id}`) : null}
        rowMuted={(d) => Boolean(d.cancelledAt)}
        columns={[
          { key: "no", label: "Sevk", render: (d) => <span className="font-semibold tabular-nums">{d.dispatchNo}</span> },
          { key: "date", label: "Tarih", render: (d) => gunCari(d.dispatchedAt) },
          { key: "wo", label: TERIM.terbiyeIsEmri.cumleBasi.yalin, render: (d) => d.workOrder?.workOrderNumber ?? "—" },
          { key: "status", label: "Durum", render: (d) => (d.cancelledAt ? <ToneChip tone="rose">İptal</ToneChip> : <ToneChip tone="amber">Gönderildi</ToneChip>) },
          { key: "qty", label: "Miktar", align: "right", render: (d) => metre(d.totalQty) ?? "—" },
        ]}
      />
    </SectionCard>
  );
}

export function CariPurchasesTab({ supplierId, showOrders, showReceipts }: { supplierId: string; showOrders: boolean; showReceipts: boolean }) {
  const navigate = useNavigate();
  const po = useQuery({ ...cariPurchaseOrdersQuery(supplierId), enabled: showOrders });
  const gr = useQuery({ ...cariReceiptsQuery(supplierId), enabled: showReceipts });
  return (
    <div className="space-y-4">
      {showOrders && (
        <SectionCard title="Alış siparişleri" description={`En yeni ${LIMIT} sipariş`} flush>
          <RecordTable
            rows={po.data ?? []}
            loading={po.isLoading}
            error={po.isError}
            onRetry={() => void po.refetch()}
            emptyText="Bu tedarikçiye alış siparişi yok."
            rowKey={(o) => o.id}
            onRowClick={(o) => navigate(`/operations/purchase-orders?focus=${o.id}`)}
            rowMuted={(o) => o.status === "CANCELLED"}
            columns={[
              { key: "no", label: "Sipariş", render: (o) => <span className="font-semibold tabular-nums">{o.orderNo}</span> },
              { key: "date", label: "Tarih", render: (o) => gunCari(o.orderDate) },
              { key: "status", label: "Durum", render: (o) => <ToneChip tone={PO_TONE[o.status]}>{PO_STATUS_LABEL[o.status]}</ToneChip> },
              { key: "cur", label: "Para birimi", render: (o) => o.currency },
              { key: "lines", label: "Kalem", align: "right", render: (o) => formatNumber(o._count.lines, 0) },
              { key: "gr", label: "Mal kabul", align: "right", render: (o) => formatNumber(o._count.goodsReceipts, 0) },
            ]}
          />
        </SectionCard>
      )}
      {showReceipts && (
        <SectionCard title="Mal kabulleri" description={`En yeni ${LIMIT} fiş`} flush>
          <RecordTable
            rows={gr.data ?? []}
            loading={gr.isLoading}
            error={gr.isError}
            onRetry={() => void gr.refetch()}
            emptyText="Bu tedarikçiden mal kabulü yok."
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/operations/goods-receipts?focus=${r.id}`)}
            rowMuted={(r) => r.status === "CANCELLED"}
            columns={[
              { key: "no", label: "Fiş", render: (r) => <span className="font-semibold tabular-nums">{r.receiptNo}</span> },
              { key: "date", label: "Tarih", render: (r) => gunCari(r.createdAt) },
              { key: "status", label: "Durum", render: (r) => <ToneChip tone={r.status === "CANCELLED" ? "rose" : "green"}>{RECEIPT_STATUS_LABEL[r.status]}</ToneChip> },
              { key: "note", label: "İrsaliye", render: (r) => r.deliveryNoteNo ?? "—" },
              { key: "wh", label: "Depo", className: "max-w-[14rem] truncate", title: (r) => r.warehouse?.name, render: (r) => r.warehouse?.name ?? "—" },
            ]}
          />
        </SectionCard>
      )}
    </div>
  );
}

/** Sunucunun Türkçe cümlesi (`anlati.metin`, parçaların düz hâli); eski backend göndermezse işlem + tablo.
 *  Parçaları çizmek yalnız AuditNarrativeRow'un işi (tek çizici bekçisi). */
export const historyText = (l: Pick<SystemLogListItem, "anlati" | "action" | "tableName">): string =>
  l.anlati?.metin ?? `${l.action} · ${l.tableName}`;

export function CariHistoryTab({ customerId }: { customerId: string }) {
  const q = useQuery(cariHistoryQuery(customerId));
  return (
    <SectionCard title="Geçmiş" description="Kartta yapılan değişiklikler (en yeni önce)" flush>
      <RecordTable
        rows={q.data ?? []}
        loading={q.isLoading}
        error={q.isError}
        onRetry={() => void q.refetch()}
        emptyText="Kayıtlı değişiklik yok."
        rowKey={(l) => l.id}
        columns={[
          { key: "at", label: "Zaman", render: (l) => formatFactory(l.createdAt, "dd.MM.yyyy HH:mm") },
          { key: "who", label: "Kullanıcı", className: "max-w-[12rem] truncate", title: (l) => l.user?.fullName, render: (l) => l.user?.fullName ?? "Sistem" },
          { key: "what", label: "Değişiklik", className: "max-w-[36rem] truncate", title: historyText, render: historyText },
        ]}
      />
    </SectionCard>
  );
}
