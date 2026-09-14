// =============================================================================
// LEVENTLER — plan · sar · hazır levent stoğu · Faz 3 tezgah bağı (tak · sök · tüket · düzelt · bitir · hurda · geri al)
// =============================================================================
// ⚠️ REJİM: ekran DEVERE modülüne aittir. Karo `isWarpBeamsVisible`; asıl sed backend
// `requireDevereEnabled`. Okuma `warpbeam:read` (route), yazma `warpbeam:write`, sarım
// iptali · hurda · geri alma `warpbeam:cancel` (satır menüsü `PermissionGate`). Faz 3 menüsü
// `devere.mountTracking` açıkken çizilir — kapalıyken ekran Faz 1b ile BİREBİR aynı.
// ⚠️ "HATA" ile "KAYIT YOK" ayrı ekranlardır (`DataTable.isError`). SÜZME SUNUCUDA.
// =============================================================================
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { RefreshButton } from "@/components/RefreshButton";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { useDataTable } from "@/hooks/useDataTable";
import { useDevereMountTracking } from "@/hooks/usePricingEnabled";
import { warpSpecService } from "@/pages/WarpSpecs/service";
import { warpBeamColumns } from "./columns";
import { warpBeamService } from "./service";
import { WarpBeamFormDialog } from "./WarpBeamFormDialog";
import { WindDialog } from "./WindDialog";
import { CancelDialog } from "./CancelDialog";
import { WarpBeamRowMenu } from "./WarpBeamRowMenu";
import { BeamActionDialogs } from "./tezgah/BeamActionDialogs";
import { WARP_BEAMS_QUERY_KEY, useWarpBeamMutations } from "./useWarpBeamMutations";
import { toPlanPayload, usePageDialog, type BeamActionKind } from "./usePageActions";
import { WARP_BEAM_ORIGIN_LABEL, WARP_BEAM_STATUSES, WARP_BEAM_STATUS_META, type WarpBeam, type WarpBeamOrigin } from "./types";

const FILTERS: FilterDef[] = [
  { kind: "multi-select", key: "status", label: "Durum", options: WARP_BEAM_STATUSES.map((s) => ({ value: s, label: WARP_BEAM_STATUS_META[s].label })) },
  { kind: "select", key: "originKind", label: "Köken", options: (Object.keys(WARP_BEAM_ORIGIN_LABEL) as WarpBeamOrigin[]).map((k) => ({ value: k, label: WARP_BEAM_ORIGIN_LABEL[k] })) },
  { kind: "lookup", key: "warpSpecId", label: "Çözgü kartı", service: warpSpecService, queryKey: "warp-specs-beam-filter" },
];

const swallow = () => undefined;
const BEAM_ACTION_KINDS = new Set<string>(["mount", "dismount", "consume", "adjust", "exhaust", "scrap", "undo"]);

export function WarpBeamsPage() {
  const { dialog, setDialog, actions } = usePageDialog();
  const { save, deleteDraft, wind, cancel, act } = useWarpBeamMutations(() => setDialog(null));
  const mountTracking = useDevereMountTracking();
  const { table, query, search, setSearch, pagination, fetchAll } = useDataTable<WarpBeam>({
    queryKey: WARP_BEAMS_QUERY_KEY,
    fetchFn: warpBeamService.listCursor,
    columns: warpBeamColumns,
    defaultPageSize: 50,
    enableSelection: false,
  });
  const formTarget = dialog?.kind === "new" ? null : dialog?.kind === "edit" ? dialog.target : undefined;

  return (
    <PageShell>
      <PageHeader
        title="Leventler"
        description="Levent planla, sar (iplik brüt çıkar, dip ayrı döner), hazır levent stoğunu gör. Kalan metre defterden türetilir."
        actions={
          <div className="flex items-center gap-2">
            <PermissionGate permission="warpbeam:write">
              <Button size="sm" onClick={() => setDialog({ kind: "new" })}>
                <Plus className="mr-1 h-4 w-4" />
                Yeni Levent
              </Button>
            </PermissionGate>
            <RefreshButton queryKey={WARP_BEAMS_QUERY_KEY} />
          </div>
        }
      />
      <DataTableToolbar fetchAll={fetchAll} search={search} onSearchChange={setSearch} placeholder="Levent no, gövde no veya çözgü kartı ara..." />
      <FilterBar filters={FILTERS} />
      <DataTable<WarpBeam>
        table={table}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        errorText="Bu bir “kayıt yok” cevabı DEĞİLDİR — istek reddedildi ya da sunucuya ulaşamadı (modül kapalı, yetki yok, ağ)."
        pagination={pagination}
        emptyText="Levent yok. Planlamak için “Yeni Levent”."
        onRowClick={(r) => r.status === "PLANNED" && actions.onEdit(r)}
        rowContextMenu={(r) => <WarpBeamRowMenu row={r} mountTracking={mountTracking} {...actions} />}
      />
      {/* Diyaloglar KOŞULLU mount: her açılış taze bileşen ve taze `clientToken`. */}
      {formTarget !== undefined && (
        <WarpBeamFormDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          initial={formTarget}
          isSubmitting={save.isPending}
          onSubmit={(v, clientToken) =>
            save
              .mutateAsync({
                id: formTarget?.id ?? null,
                clientToken,
                body: toPlanPayload(v),
              })
              .then(swallow, swallow)
          }
        />
      )}
      {dialog?.kind === "wind" && <WindDialog target={dialog.target} isPending={wind.isPending} onClose={() => setDialog(null)} onConfirm={(body) => wind.mutate({ id: dialog.target.id, body })} />}
      {dialog && BEAM_ACTION_KINDS.has(dialog.kind) && "target" in dialog && <BeamActionDialogs kind={dialog.kind as BeamActionKind} target={dialog.target} act={act} onClose={() => setDialog(null)} />}
      {dialog?.kind === "cancel" && <CancelDialog target={dialog.target} isPending={cancel.isPending} onClose={() => setDialog(null)} onConfirm={(reason) => cancel.mutate({ id: dialog.target.id, reason })} />}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title={`${dialog.target.beamNo} taslağı silinsin mi?`}
          description="Yalnız plandaki (hiç sarılmamış) levent silinir; deftere hiç yazmadığı için iz kalmaz. Sarılmış levent iptal edilir, silinmez."
          confirmLabel="Sil"
          destructive
          onConfirm={() => deleteDraft.mutate(dialog.target.id)}
          isPending={deleteDraft.isPending}
        />
      )}
    </PageShell>
  );
}
