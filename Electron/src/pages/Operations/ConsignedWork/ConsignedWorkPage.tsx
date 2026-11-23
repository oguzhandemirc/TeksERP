// İÇERİDEKİ İŞLER (ister 3.2) — müşteri başına içerideki emanet top/metre, durum kırılımıyla. Tek sunucu toplaması
// (`/api/consigned-work`); satır ya da hücre tıklaması Kumaş Stoğu'nu o sahibin süzgeciyle açar. Modül kapısı `ROUTE_MODULE`.
// Hazırlık kolonu (D4-J3) İKİNCİ HESAP DEĞİL: `ready-works?groupBy=customer` ucundan; `shipping:read` yoksa istek atılmaz.
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/layout/PageShell";
import { ListFooter, ListToolbar } from "@/components/layout/ListPage";
import { PageHeader } from "@/components/layout/PageHeader";
import { ToolbarToggle } from "@/components/data-table/ToolbarToggle";
import { RefreshButton } from "@/components/RefreshButton";
import { CONSIGNED_WORK_QUERY_KEY, getConsignedWork, type ConsignedOwnerRow } from "./service";
import { primaryBucket, rollsLinkFor } from "./consigned-links";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { getAllReadyWorks, READY_WORKS_QUERY_KEY } from "@/pages/Operations/ReadyWorks/service";
import { TotalsStrip, type ReadinessStatus } from "./ConsignedWorkTable";
import { ownerColumns } from "./consignedColumns";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { useListSearch } from "@/hooks/useListSearch";
import { useLocalTable } from "@/hooks/useLocalTable";
import { PageTabs } from "@/components/layout/PageTabs";
import { CONSIGNED_STATEMENT_QUERY_KEY } from "./statement/service";
import { ConsignedStatementView, STATEMENT_PARAMS } from "./statement/ConsignedStatementView";

/** Görünüm URL'de (`?view=ekstre`) — satırdaki "Ekstre" düğmesi ve derin bağlantı aynı yere iner. */
const VIEW_PARAM = "view";

export function ConsignedWorkPage() {
  const [sp, setSp] = useSearchParams();
  if (sp.get(VIEW_PARAM) === "ekstre") {
    return (
      <PageShell>
        <PageHeader
          title="İçerideki İşler"
          description="Emanet ekstresi — müşterinin bize bıraktığı malın dönem mutabakatı: açılış, giren, çıkan (BRÜT), fasondan doğrudan sevk, fire, kalan."
          actions={<RefreshButton queryKey={CONSIGNED_STATEMENT_QUERY_KEY} />}
        />
        <ViewTabs value="ekstre" onChange={(v) => setSp(v === "ekstre" ? { [VIEW_PARAM]: "ekstre" } : {}, { replace: true })} />
        <ConsignedStatementView />
      </PageShell>
    );
  }
  return <ConsignedNowView onStatement={(id) => setSp({ [VIEW_PARAM]: "ekstre", ...(id ? { [STATEMENT_PARAMS.customer]: id } : {}) })} />;
}

function ViewTabs({ value, onChange }: { value: "anlik" | "ekstre"; onChange: (v: string) => void }) {
  return <PageTabs label="Emanet görünümü" tabs={[{ key: "anlik", label: "Anlık durum" }, { key: "ekstre", label: "Emanet ekstresi" }]} active={value} onSelect={onChange} />;
}

/** Toplamlar gelmeden (yükleniyor/hata) kolon seti — yalnız boş/hata satırı çizilsin diye; değerler sıfır. */
const ZERO = { count: 0, qty: 0 };
const NO_TOTALS = { waiting: ZERO, waitingSemi: ZERO, inProcess: ZERO, ready: ZERO, other: ZERO, total: ZERO };

function emptyText(searching: boolean, onlyReady: boolean): string {
  if (searching) return "Aramaya uyan müşteri yok.";
  return onlyReady ? "Sevke hazır emaneti olan müşteri yok." : "İçeride emanet mal yok.";
}

function ConsignedNowView({ onStatement }: { onStatement: (customerId: string | null) => void }) {
  const navigate = useNavigate();
  const [onlyReady, setOnlyReady] = useState(false);
  const { search, setSearch, term } = useListSearch();
  const q = useQuery({ queryKey: [CONSIGNED_WORK_QUERY_KEY, onlyReady ? "ready" : "all", term ?? ""], queryFn: () => getConsignedWork(onlyReady, term) });
  const rows = q.data?.rows ?? [];
  const open = (row: ConsignedOwnerRow) => navigate(rollsLinkFor(row.ownerCustomerId, primaryBucket(row)));
  const canReadShipping = useRoleAccess().hasPermission("shipping:read");
  const readyQ = useQuery({
    queryKey: [READY_WORKS_QUERY_KEY, "customer-all"],
    queryFn: () => getAllReadyWorks("customer"),
    enabled: canReadShipping,
  });
  // Hazırlık ucu düşerse ana liste etkilenmez; hücre "yüklenemedi" der.
  const readinessStatus: ReadinessStatus = readyQ.isError ? "error" : readyQ.isPending ? "loading" : "ok";
  const readiness = useMemo(() => (canReadShipping ? new Map((readyQ.data ?? []).map((w) => [w.id, w])) : null), [canReadShipping, readyQ.data]);
  const totals = q.data?.totals;
  const columns = useMemo(
    () => ownerColumns({ totals: totals ?? NO_TOTALS, readiness, readinessStatus, onStatement: (r) => onStatement(r.ownerCustomerId) }),
    [totals, readiness, readinessStatus, onStatement],
  );
  const table = useLocalTable({ tableKey: "consigned-work:owners", data: rows, columns, getRowId: (r) => r.ownerCustomerId });

  return (
    <PageShell>
      <PageHeader
        title="İçerideki İşler"
        description="Müşterilerin işlenmek üzere bıraktığı (emanet) mal — müşteri başına top ve metre. Sevk edilen, hurdaya ayrılan ve iptal/tüketilmiş toplar sayılmaz; fasondaki ve karteladaki emanet içeride sayılır (Diğer). Satıra tıklayınca toplar o müşterinin filtreyiyle açılır."
        actions={<RefreshButton queryKey={CONSIGNED_WORK_QUERY_KEY} />}
      />
      <ViewTabs value="anlik" onChange={(v) => v === "ekstre" && onStatement(null)} />
      <ListToolbar className="flex-row items-center gap-1.5">
        <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Müşteri adı ya da kodu ara (toplamlar da süzülür)" />
        <ToolbarToggle checked={onlyReady} onCheckedChange={setOnlyReady} label="Yalnız sevke hazır" title="Yalnız sevke hazır (depoda) emaneti olan müşteriler; toplamlar da bu kapsamdan" />
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="İçerideki işler" />
        </div>
      </ListToolbar>
      {/* "HATA" ile "KAYIT YOK" ayrı ekranlar (DataTable.isError). */}
      <DataTable
        table={table}
        isLoading={q.isLoading}
        isError={q.isError}
        onRetry={() => void q.refetch()}
        errorText="Bu bir “içeride iş yok” cevabı değildir — istek reddedildi ya da sunucuya ulaşılamadı."
        emptyText={emptyText(!!term, onlyReady)}
        emptyDescription={!term && !onlyReady ? "Emanet top, girişte “Sahibi” seçilerek ya da gelen belge onayıyla doğar." : undefined}
        onRowClick={open}
        rowTitle={(r) => `${r.ownerName} toplarını aç`}
        exportName="İçerideki işler"
      />
      {!q.isLoading && !q.isError && <ListFooter loaded={rows.length} summary={q.data ? <TotalsStrip totals={q.data.totals} /> : undefined} />}
    </PageShell>
  );
}
