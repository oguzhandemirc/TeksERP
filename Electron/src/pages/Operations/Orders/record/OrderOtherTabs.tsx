// Sevkiyatlar (BRÜT metre; satırdan sevk detayına) · Belgeler (sipariş teyidi sürümleri; açma/basma mevcut
// düğmeyle) · Geçmiş (audit anlatısı; yalnız gösterim — sayı/karar türetilmez).
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { SectionCard } from "@/components/ui/section-card";
import { RecordTable } from "@/components/record/RecordTable";
import { ToneChip } from "@/components/record/RecordBits";
import { formatMeasure, formatQty } from "@/lib/format";
import { formatFactory } from "@/lib/factory-time";
import type { SystemLogListItem } from "@/types/systemLog";
import type { PrintedDocStatus } from "@/services/printedDocumentService";
import { shipmentStatusLabels } from "@/pages/Operations/Shipments/types";
import { OrderConfirmationButton } from "../OrderConfirmationButton";
import type { Order } from "../types";
import { shipmentRoute } from "./order-movements";
import { dayText } from "./OrderRecordBits";
import { orderDocVersionsQuery, orderHistoryQuery, orderShipmentsQuery } from "./useOrderRecordData";

export function OrderShipmentsTab({ orderId, canOpen }: { orderId: string; canOpen: boolean }) {
  const navigate = useNavigate();
  const q = useQuery(orderShipmentsQuery(orderId));
  const d = q.data?.data;
  const sum = d ? [`Sevk edilen ${formatMeasure(d.dispatchedTotal, "m")}`, d.plannedTotal > 0 ? `Bekleyen ${formatMeasure(d.plannedTotal, "m")}` : null].filter(Boolean).join(" · ") : undefined;
  return (
    <SectionCard title="Sevkiyatlar" description={sum} flush>
      <RecordTable
        rows={d?.shipments ?? []}
        loading={q.isLoading}
        error={q.isError}
        onRetry={() => void q.refetch()}
        rowKey={(r) => r.shipmentId || r.shipmentNo}
        onRowClick={canOpen ? (r) => { const to = shipmentRoute(r); if (to) void navigate(to); } : null}
        emptyText="Bu siparişe sevkiyat yok."
        columns={[
          { key: "no", label: "Sevk no", render: (r) => <span className="font-mono font-semibold">{r.shipmentNo}</span> },
          { key: "date", label: "Tarih", render: (r) => dayText(r.date) ?? "—" },
          { key: "kind", label: "Durum", render: (r) => (r.kind === "DIRECT" ? <ToneChip tone="green">Fason direkt</ToneChip> : <ToneChip tone={r.status === "DISPATCHED" ? "blue" : "amber"}>{shipmentStatusLabels[r.status]}</ToneChip>) },
          { key: "branch", label: "Şube", className: "max-w-[12rem] truncate", title: (r) => r.branchName, render: (r) => r.branchName ?? "—" },
          { key: "sacks", label: "Çuval", align: "right", render: (r) => (r.sackCount > 0 ? formatQty(r.sackCount) : "—") },
          { key: "qty", label: "Metre", align: "right", render: (r) => <span className="font-semibold">{formatMeasure(r.qty, "m")}</span> },
        ]}
      />
    </SectionCard>
  );
}

const DOC_STATUS: Record<PrintedDocStatus, { label: string; tone: "green" | "teal" | "rose" }> = {
  ACTIVE: { label: "Geçerli", tone: "green" },
  SUPERSEDED: { label: "Eski sürüm", tone: "teal" },
  VOIDED: { label: "İptal", tone: "rose" },
};

export function OrderDocumentsTab({ order }: { order: Order }) {
  const q = useQuery(orderDocVersionsQuery(order.id));
  return (
    <SectionCard title="Sipariş teyidi" description="Basılan sürümler (en yeni önce)" action={<OrderConfirmationButton order={order} />} flush>
      <RecordTable
        rows={q.data ?? []}
        loading={q.isLoading}
        error={q.isError}
        onRetry={() => void q.refetch()}
        rowKey={(v) => v.id}
        rowMuted={(v) => v.status !== "ACTIVE"}
        emptyText="Henüz sipariş teyidi basılmadı."
        columns={[
          { key: "no", label: "Belge no", render: (v) => <span className="font-mono font-semibold">{v.documentNo}</span> },
          { key: "ver", label: "Sürüm", align: "right", render: (v) => formatQty(v.version) },
          { key: "status", label: "Durum", render: (v) => <ToneChip tone={DOC_STATUS[v.status].tone}>{DOC_STATUS[v.status].label}</ToneChip> },
          { key: "at", label: "Zaman", render: (v) => formatFactory(v.createdAt, "dd.MM.yyyy HH:mm") },
          { key: "who", label: "Basan", className: "max-w-[12rem] truncate", title: (v) => v.printedBy?.fullName, render: (v) => v.printedBy?.fullName ?? "—" },
          { key: "why", label: "Sebep", className: "max-w-[20rem] truncate", title: (v) => v.voidReason ?? v.reissueReason, render: (v) => v.voidReason ?? v.reissueReason ?? "—" },
        ]}
      />
    </SectionCard>
  );
}

/** Sunucunun Türkçe cümlesi; eski backend göndermezse işlem + tablo. */
const historyText = (l: Pick<SystemLogListItem, "anlati" | "action" | "tableName">): string => l.anlati?.metin ?? `${l.action} · ${l.tableName}`;

export function OrderHistoryTab({ orderId }: { orderId: string }) {
  const q = useQuery(orderHistoryQuery(orderId));
  return (
    <SectionCard title="Geçmiş" description="Siparişte yapılan değişiklikler (en yeni önce)" flush>
      <RecordTable
        rows={q.data ?? []}
        loading={q.isLoading}
        error={q.isError}
        onRetry={() => void q.refetch()}
        rowKey={(l) => l.id}
        emptyText="Kayıtlı değişiklik yok."
        columns={[
          { key: "at", label: "Zaman", render: (l) => formatFactory(l.createdAt, "dd.MM.yyyy HH:mm") },
          { key: "who", label: "Kullanıcı", className: "max-w-[12rem] truncate", title: (l) => l.user?.fullName, render: (l) => l.user?.fullName ?? "Sistem" },
          { key: "what", label: "Değişiklik", className: "max-w-[36rem] truncate", title: historyText, render: historyText },
        ]}
      />
    </SectionCard>
  );
}
