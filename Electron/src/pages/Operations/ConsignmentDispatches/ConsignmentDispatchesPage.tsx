// =============================================================================
// EMANET ÇIKIŞ (F5/P3) — müşterinin emanet leventini / ipliğini sahibine geri veren belgeler. `consignment:read`.
// Süzme + cursor + özet şeridi SUNUCUDA (tek where); modül kapısı `ROUTE_MODULE` (`emanetEnabled`).
// Top bu belgeye girmez — emanet top normal sevkiyattan çıkar.
// =============================================================================
import { useState } from "react";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { Plus } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { ListFooter, ListToolbar } from "@/components/layout/ListPage";
import { PageHeader } from "@/components/layout/PageHeader";
import { PermissionGate } from "@/components/PermissionGate";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import { CONSIGNMENT_DISPATCHES_QUERY_KEY } from "./service";
import { EMPTY_CONSIGNMENT_FILTER, type ConsignmentDispatchListFilter } from "./types";
import { useConsignmentList } from "./useConsignmentList";
import { ConsignmentDispatchFilters, ConsignmentSummaryStrip } from "./ConsignmentDispatchFilters";
import { CONSIGNMENT_DISPATCH_COLUMNS } from "./ConsignmentDispatchTable";
import { ConsignmentDispatchDetailSheet } from "./ConsignmentDispatchDetailSheet";
import { ConsignmentDispatchFormDialog } from "./ConsignmentDispatchFormDialog";
import { ConsignmentCancelDialog } from "./ConsignmentCancelDialog";

export function ConsignmentDispatchesPage() {
  const [f, setF] = useState<ConsignmentDispatchListFilter>(EMPTY_CONSIGNMENT_FILTER);
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const l = useConsignmentList(f);
  const table = useLocalTable({ tableKey: "consignment:dispatches", data: l.rows, columns: CONSIGNMENT_DISPATCH_COLUMNS });
  const filtered = JSON.stringify(f) !== JSON.stringify(EMPTY_CONSIGNMENT_FILTER);
  return (
    <PageShell>
      <PageHeader
        title="Emanet Çıkış"
        description="Müşterinin bıraktığı emanet levent ve ipliğin sahibine geri verilişi. Kayıtlı belge değişmez; yanlışsa iptal edilir ve ters kayıt düşer."
        actions={
          <div className="flex gap-2">
            <RefreshButton queryKey={[CONSIGNMENT_DISPATCHES_QUERY_KEY, "list"]} />
            <PermissionGate permission="consignment:write">
              <Button onClick={() => setFormOpen(true)}><Plus className="mr-1 h-4 w-4" />Yeni Emanet Çıkışı</Button>
            </PermissionGate>
          </div>
        }
      />
      <ListToolbar className="flex-row flex-wrap items-center">
        <ConsignmentDispatchFilters value={f} onChange={setF} />
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Emanet çıkışları" />
        </div>
      </ListToolbar>
      {/* "HATA" ile "KAYIT YOK" ayrı ekranlar (DataTable.isError); yüklü satır varken hata satırı tabloyu silmez. */}
      <DataTable
        table={table}
        isLoading={l.isLoading}
        isError={l.isError}
        onRetry={l.refetch}
        errorText="Bu bir “belge yok” cevabı değildir — yeni çıkış açmadan önce tekrar deneyin."
        emptyText={filtered ? "Filtreye uyan emanet çıkışı yok." : "Henüz emanet çıkışı yok."}
        emptyDescription={filtered ? undefined : "“Yeni Emanet Çıkışı” ile müşterinin leventini ya da ipliğini sahibine verin."}
        onRowClick={(r) => setDetailId(r.id)}
        loadMore={{ hasMore: l.hasMore, isFetchingMore: l.isFetchingMore, onLoadMore: l.loadMore }}
        exportName="Emanet çıkışları"
      />
      {!l.isLoading && (
        <ListFooter loaded={l.rows.length} total={l.summary?.count ?? null} hasMore={l.hasMore} isFetchingMore={l.isFetchingMore} summary={l.summary ? <ConsignmentSummaryStrip summary={l.summary} /> : undefined} />
      )}
      <ConsignmentDispatchFormDialog open={formOpen} onOpenChange={setFormOpen} onCreated={(d) => { setFormOpen(false); setDetailId(d.id); }} />
      <ConsignmentDispatchDetailSheet dispatchId={detailId} onClose={() => setDetailId(null)} onCancel={setCancelId} />
      <ConsignmentCancelDialog dispatchId={cancelId} onOpenChange={(o) => !o && setCancelId(null)} />
    </PageShell>
  );
}
