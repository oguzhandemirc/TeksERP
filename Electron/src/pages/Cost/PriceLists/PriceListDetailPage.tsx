// =============================================================================
// FİYAT LİSTELERİ › LİSTE DETAYI (MAL-5) — `price-list:read`. Taslak + `price-list:write` → satır editörü;
// yayınlanan liste DEĞİŞMEZ (değişiklik revizyondur). Fiyat ve maliyet sunucudan; panel hesap yapmaz.
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { formatCalendarDay, formatFactory } from "@/lib/factory-time";
import { CommercialDocButton } from "../shared/CommercialDocButton";
import { CostQueryError } from "../shared/CostQueryState";
import { PriceListActions } from "./PriceListActions";
import { PriceListLinesEditor, PriceListLinesView } from "./PriceListLinesEditor";
import { PriceListStatusBadge } from "./PriceListStatusBadge";
import { priceListLabel, type PriceListDetail } from "./pl-types";
import { priceListService } from "./service";
import { priceListDetailKey } from "./usePriceListMutation";

export function PriceListDetailPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { hasPermission } = useRoleAccess();
  const [dirty, setDirty] = useState(false);
  const q = useQuery({ queryKey: priceListDetailKey(id), queryFn: () => priceListService.get(id), enabled: Boolean(id) });
  const list = q.data?.data;
  const editable = list?.status === "DRAFT" && hasPermission("price-list:write");
  return (
    <PageShell>
      <PageHeader
        title={list ? `Fiyat listesi ${priceListLabel(list)}` : "Fiyat listesi"}
        titleExtra={list ? <PriceListStatusBadge status={list.status} /> : undefined}
        description={list ? `${list.name} · ${list.customer ? list.customer.name : "Genel"} · ${list.currency}` : undefined}
        onBack={() => nav("/cost/price-lists")}
        parent={{ label: "Fiyat Listeleri", to: "/cost/price-lists" }}
        actions={list ? <CommercialDocButton docType="PRICE_LIST" sourceId={list.id} label={`Fiyat listesi ${priceListLabel(list)} · ${list.name}`} draft={list.status === "DRAFT"} /> : undefined}
      />
      <PageBody className="space-y-4 p-4 sm:p-6">
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : q.isError || !list ? (
          <CostQueryError error={q.error} what="Fiyat listesi" onRetry={() => void q.refetch()} />
        ) : (
          <>
            <PriceListActions list={list} dirtyLines={dirty} />
            <PriceListInfo list={list} />
            {editable ? (
              <PriceListLinesEditor key={`${list.id}:${list.updatedAt}`} list={list} onDirtyChange={setDirty} />
            ) : (
              <PriceListLinesView list={list} />
            )}
          </>
        )}
      </PageBody>
    </PageShell>
  );
}

function PriceListInfo({ list }: { list: PriceListDetail }) {
  const day = (v: string | null) => (v ? formatCalendarDay(v) : "…");
  return (
    <dl className="grid gap-x-6 gap-y-1 rounded-md border p-3 text-sm sm:grid-cols-3">
      <div><dt className="text-xs text-muted-foreground">Geçerlilik (bilgi)</dt><dd>{list.validFromDate || list.validUntilDate ? `${day(list.validFromDate)} – ${day(list.validUntilDate)}` : "—"}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Yayın</dt><dd>{list.publishedAt ? formatFactory(list.publishedAt, "dd.MM.yyyy HH:mm") : "—"}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Arşiv</dt><dd>{list.archivedAt ? formatFactory(list.archivedAt, "dd.MM.yyyy HH:mm") : "—"}</dd></div>
      {list.revisionNo > 1 && <div><dt className="text-xs text-muted-foreground">Sürüm</dt><dd>R{list.revisionNo}</dd></div>}
      {list.notes && <div className="sm:col-span-3"><dt className="text-xs text-muted-foreground">Not</dt><dd className="whitespace-pre-wrap">{list.notes}</dd></div>}
    </dl>
  );
}
