// Test türü kataloğu — tür ekle/düzenle, pasife al (silme yok: sonuçlar türe bağlı), hazır liste.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListPlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { apiErrorText } from "@/lib/api-error";
import { labTestTypeService, type LabTestType } from "./service";
import { labTypeColumns } from "./labTypeColumns";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { LabTypeFormDialog } from "./LabTypeFormDialog";
import { LabPresetDialog } from "./LabPresetDialog";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";

export function LabTypesPanel() {
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const [editing, setEditing] = useState<LabTestType | "new" | null>(null);
  const [presetOpen, setPresetOpen] = useState(false);
  const q = useQuery({ queryKey: ["lab-test-types", "all"], queryFn: () => labTestTypeService.list(false) });
  const toggle = useMutation({
    mutationFn: (t: LabTestType) => labTestTypeService.update(t.id, {
      code: t.code, name: t.name, method: t.method, resultKind: t.resultKind, scaleMax: t.scaleMax, unit: t.unit,
      specMin: t.specMin === null ? null : Number(t.specMin), specMax: t.specMax === null ? null : Number(t.specMax), isActive: !t.isActive,
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["lab-test-types"] }),
  });
  const rows = q.data ?? [];
  const canWrite = hasPermission("labtest:write");
  const columns = useMemo(() => labTypeColumns(canWrite, toggle.isPending, setEditing, toggle.mutate), [canWrite, toggle.isPending, toggle.mutate]);
  const table = useLocalTable({ tableKey: "lab-test-types", data: rows, columns });
  return (
    <>
      <ListToolbar className="flex-row flex-wrap items-center">
        <PermissionGate permission="labtest:write">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setEditing("new")}><Plus className="mr-1 h-4 w-4" />Yeni tür</Button>
            <Button size="sm" variant="outline" onClick={() => setPresetOpen(true)}><ListPlus className="mr-1 h-4 w-4" />Hazır listeden ekle</Button>
          </div>
        </PermissionGate>
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Test türleri" />
        </div>
      </ListToolbar>
      {!q.isLoading && !q.isError && rows.length > 0 ? (
        <DataTable table={table} exportName="Test türleri" />
      ) : (
      <ListBody>
        {q.isLoading ? <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
          : q.isError ? <ListMessage className="text-sm text-destructive">{apiErrorText(q.error, "Test türleri okunamadı.")}</ListMessage>
          : <ListMessage><div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Katalog boş. “Hazır listeden ekle” ile gramaj, haslık gibi yaygın testleri tek adımda ekleyin.</div></ListMessage>}
      </ListBody>
      )}
      <ListFooter loaded={rows.length} />
      {editing && <LabTypeFormDialog initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {presetOpen && <LabPresetDialog onClose={() => setPresetOpen(false)} />}
    </>
  );
}
