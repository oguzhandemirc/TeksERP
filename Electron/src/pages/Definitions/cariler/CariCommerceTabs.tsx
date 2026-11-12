// Cari kayıt sayfası — satış sekmeleri: Siparişler · Sevkiyatlar · Fiyat listeleri. Her biri MEVCUT liste ucunu
// carinin süzgeciyle kullanır (son 50); satır ilgili kaydın ekranını açar. Sevk metresi BRÜT.
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { IconTileTone } from "@/components/ui/icon-tile";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { RecordTable } from "@/components/record/RecordTable";
import { ToneChip } from "@/components/record/RecordBits";
import { formatNumber } from "@/lib/format";
import { orderStatusLabels, type OrderStatus } from "@/types/enums";
import { shipmentStatusLabels, type ShipmentStatus } from "@/pages/Operations/Shipments/types";
import { priceListService } from "@/pages/Cost/PriceLists/service";
import { EMPTY_PRICE_LIST_FILTER, PRICE_LIST_STATUS_LABEL, priceListLabel, type PriceListStatus } from "@/pages/Cost/PriceLists/pl-types";
import { fetchRecentOrders, fetchRecentShipments, orderPath, shipmentPath } from "./cari-sources";
import { metre } from "./cari-movements";
import { gunCari } from "./cari-time";

export const CARI_TAB_LIMIT = 50;
const LIMIT = CARI_TAB_LIMIT;

// Sorgu tanımları dışa açık: kayıt sayfası aynı anahtarla yoklar (boş sekme çizilmez), sekme önbellekten okur.
export const cariOrdersQuery = (customerId: string) => ({ queryKey: ["orders", "cari-tab", customerId], queryFn: () => fetchRecentOrders(customerId, LIMIT) });
export const cariShipmentsQuery = (customerId: string) => ({ queryKey: ["shipments", "cari-tab", customerId], queryFn: () => fetchRecentShipments(customerId, LIMIT) });
export const cariPricesQuery = (customerId: string) => ({
  queryKey: ["price-lists", "cari-tab", customerId],
  queryFn: () => priceListService.list({ ...EMPTY_PRICE_LIST_FILTER, scope: "customer", customerId }, null, LIMIT).then((r) => r.data),
});
const ORDER_TONE: Record<OrderStatus, IconTileTone> = { PENDING: "amber", APPROVED: "blue", PARTIAL_SHIPPED: "violet", COMPLETED: "green", CANCELLED: "rose" };
const SHIPMENT_TONE: Record<ShipmentStatus, IconTileTone> = { PLANNED: "sky", DISPATCHED: "green", CANCELLED: "rose" };
const PRICE_TONE: Record<PriceListStatus, IconTileTone> = { DRAFT: "amber", PUBLISHED: "green", ARCHIVED: "violet" };

function AllLink({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return <Button variant="ghost" size="sm" onClick={() => navigate(to)}>{label}</Button>;
}

export function CariOrdersTab({ customerId }: { customerId: string }) {
  const navigate = useNavigate();
  const q = useQuery(cariOrdersQuery(customerId));
  return (
    <SectionCard title="Siparişler" description={`En yeni ${LIMIT} sipariş`} action={<AllLink to={`/operations/orders?filter[customerId]=${customerId}`} label="Tümünü aç" />} flush>
      <RecordTable
        rows={q.data ?? []}
        loading={q.isLoading}
        error={q.isError}
        onRetry={() => void q.refetch()}
        emptyText="Bu carinin siparişi yok."
        rowKey={(o) => o.id}
        onRowClick={(o) => navigate(orderPath(o.id))}
        rowMuted={(o) => o.status === "CANCELLED"}
        columns={[
          { key: "no", label: "Sipariş", render: (o) => <span className="font-semibold tabular-nums">{o.orderNumber}</span> },
          { key: "date", label: "Tarih", render: (o) => gunCari(o.orderDate) },
          { key: "status", label: "Durum", render: (o) => <ToneChip tone={ORDER_TONE[o.status]}>{orderStatusLabels[o.status]}</ToneChip> },
          { key: "qty", label: "Miktar", align: "right", render: (o) => metre((o.lines ?? []).reduce((s, l) => s + (Number(l.quantity) || 0), 0)) ?? "—" },
          { key: "shipped", label: "Gönderilen", align: "right", render: (o) => metre(o.shippedQty) ?? "—" },
        ]}
      />
    </SectionCard>
  );
}

export function CariShipmentsTab({ customerId }: { customerId: string }) {
  const navigate = useNavigate();
  const q = useQuery(cariShipmentsQuery(customerId));
  return (
    <SectionCard title="Sevkiyatlar" description={`En yeni ${LIMIT} sevk · metre brüt (sevk anı)`} action={<AllLink to={`/operations/shipments?filter[customerId]=${customerId}`} label="Tümünü aç" />} flush>
      <RecordTable
        rows={q.data ?? []}
        loading={q.isLoading}
        error={q.isError}
        onRetry={() => void q.refetch()}
        emptyText="Bu cariye sevk yok."
        rowKey={(s) => `${s.kind}:${s.id}`}
        onRowClick={(s) => navigate(shipmentPath(s))}
        rowMuted={(s) => s.status === "CANCELLED"}
        columns={[
          { key: "no", label: "Sevk", render: (s) => <span className="font-semibold tabular-nums">{s.shipmentNo}</span> },
          { key: "date", label: "Tarih", render: (s) => gunCari(s.dispatchedAt ?? s.createdAt) },
          { key: "status", label: "Durum", render: (s) => <ToneChip tone={SHIPMENT_TONE[s.status]}>{s.kind === "DIRECT" ? "Doğrudan · " : ""}{shipmentStatusLabels[s.status]}</ToneChip> },
          { key: "rolls", label: "Top", align: "right", render: (s) => formatNumber(s._count?.rolls ?? 0, 0) },
          { key: "m", label: "Metre", align: "right", render: (s) => metre(s.totalMeters) ?? "—" },
          { key: "inv", label: "Fatura no", render: (s) => s.invoiceNo ?? <span className="text-muted-foreground">—</span> },
        ]}
      />
    </SectionCard>
  );
}

export function CariPricesTab({ customerId }: { customerId: string }) {
  const navigate = useNavigate();
  const q = useQuery(cariPricesQuery(customerId));
  return (
    <SectionCard title="Fiyat listeleri" description="Bu cariye özel listeler" flush>
      <RecordTable
        rows={q.data ?? []}
        loading={q.isLoading}
        error={q.isError}
        onRetry={() => void q.refetch()}
        emptyText="Bu cariye özel fiyat listesi yok; genel liste geçerli."
        rowKey={(l) => l.id}
        onRowClick={(l) => navigate(`/cost/price-lists/${l.id}`)}
        columns={[
          { key: "no", label: "Liste", render: (l) => <span className="font-semibold tabular-nums">{priceListLabel(l)}</span> },
          { key: "name", label: "Ad", className: "max-w-[18rem] truncate", title: (l) => l.name, render: (l) => l.name },
          { key: "cur", label: "Para birimi", render: (l) => l.currency },
          { key: "status", label: "Durum", render: (l) => <ToneChip tone={PRICE_TONE[l.status]}>{PRICE_LIST_STATUS_LABEL[l.status]}</ToneChip> },
          { key: "valid", label: "Geçerlilik", render: (l) => `${gunCari(l.validFromDate)} – ${gunCari(l.validUntilDate)}` },
          { key: "lines", label: "Kalem", align: "right", render: (l) => formatNumber(l._count?.lines ?? 0, 0) },
        ]}
      />
    </SectionCard>
  );
}
