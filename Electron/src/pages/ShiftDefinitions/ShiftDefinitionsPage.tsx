// =============================================================================
// VARDİYA TANIMLARI — katalog (kod · ad · saat · süre · mola · günler)
// =============================================================================
// ⚠️ REJİM: karo `isShiftDefinitionsVisible`; asıl sed backend `requireDokumaEnabled`.
// Yazma `loom:spec-manage`; arşiv bir durum geçişidir (silme yok), önce takvim etkisi gösterilir.
// ⚠️ "HATA" ile "KAYIT YOK" ayrı ekranlardır (`DataTable.isError`).
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PermissionGate } from "@/components/PermissionGate";
import { RefreshButton } from "@/components/RefreshButton";
import { DataTable } from "@/components/data-table/DataTable";
import { shiftDefinitionService } from "./service";
import { shiftColumns } from "./columns";
import { ShiftDefinitionFormDialog } from "./ShiftDefinitionFormDialog";
import { ShiftActiveDialog } from "./ShiftActiveDialog";
import { SHIFT_DEFINITIONS_QUERY_KEY, useShiftDefinitionMutations } from "./useShiftDefinitionMutations";
import type { ShiftDefinition } from "./types";

type DialogState = { kind: "form"; target: ShiftDefinition | null } | { kind: "active"; target: ShiftDefinition } | null;

export function ShiftDefinitionsPage() {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const query = useQuery({
    queryKey: [SHIFT_DEFINITIONS_QUERY_KEY, includeInactive],
    queryFn: () => shiftDefinitionService.list(includeInactive),
  });
  const rows = useMemo(() => query.data?.data ?? [], [query.data]);
  const { create, update, setActive } = useShiftDefinitionMutations(() => setDialog(null));
  const columns = useMemo(
    () =>
      shiftColumns((r) => (
        <PermissionGate permission="loom:spec-manage">
          <div className="flex justify-end gap-1">
            {r.isActive && (
              <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "form", target: r })}>
                Düzenle
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "active", target: r })}>
              {r.isActive ? "Arşivle" : "Geri al"}
            </Button>
          </div>
        </PermissionGate>
      )),
    [],
  );
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel(), enableRowSelection: false });

  return (
    <PageShell>
      <PageHeader
        title="Vardiya Tanımları"
        description="Vardiya kataloğu: başlangıç saati, süre, planlı mola, çalışılan günler. Değişiklik yalnız henüz başlamamış pencereleri etkiler; geçmiş ve mühürlü karneler değişmez."
        actions={
          <div className="flex items-center gap-2">
            <PermissionGate permission="loom:spec-manage">
              <Button size="sm" onClick={() => setDialog({ kind: "form", target: null })}>
                <Plus className="mr-1 h-4 w-4" />
                Yeni vardiya
              </Button>
            </PermissionGate>
            <RefreshButton queryKey={[SHIFT_DEFINITIONS_QUERY_KEY]} />
          </div>
        }
      />
      <div className="flex items-center gap-2">
        <Switch id="shift-inactive" checked={includeInactive} onCheckedChange={setIncludeInactive} />
        <Label htmlFor="shift-inactive">Arşivdekileri göster</Label>
      </div>
      <DataTable<ShiftDefinition>
        table={table}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        errorText="Bu bir “kayıt yok” cevabı DEĞİLDİR — istek reddedildi ya da sunucuya ulaşamadı (modül kapalı, yetki yok, ağ)."
        emptyText="Henüz vardiya tanımı yok."
        exportName="Vardiya tanımları"
      />
      {/* Diyaloglar KOŞULLU mount: her açılış taze durum. */}
      {dialog?.kind === "form" && (
        <ShiftDefinitionFormDialog
          target={dialog.target}
          isPending={create.isPending || update.isPending}
          onClose={() => setDialog(null)}
          onCreate={(body) => create.mutate(body)}
          onUpdate={(id, body) => update.mutate({ id, body })}
        />
      )}
      {dialog?.kind === "active" && (
        <ShiftActiveDialog
          target={dialog.target}
          isPending={setActive.isPending}
          onClose={() => setDialog(null)}
          onConfirm={() => setActive.mutate({ id: dialog.target.id, active: !dialog.target.isActive })}
        />
      )}
    </PageShell>
  );
}
