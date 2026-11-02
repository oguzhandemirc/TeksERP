// Test türü kataloğu — tür ekle/düzenle, pasife al (silme yok: sonuçlar türe bağlı), hazır liste.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListPlus, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { apiErrorText } from "@/lib/api-error";
import { labTestTypeService, type LabTestType } from "./service";
import { KIND_LABEL, specRangeText } from "./labTestRules";
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
  return (
    <>
      <PermissionGate permission="labtest:write">
        <ListToolbar>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setEditing("new")}><Plus className="mr-1 h-4 w-4" />Yeni tür</Button>
            <Button size="sm" variant="outline" onClick={() => setPresetOpen(true)}><ListPlus className="mr-1 h-4 w-4" />Hazır listeden ekle</Button>
          </div>
        </ListToolbar>
      </PermissionGate>
      <ListBody>
        {q.isLoading ? <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
          : q.isError ? <ListMessage className="text-sm text-destructive">{apiErrorText(q.error, "Test türleri okunamadı.")}</ListMessage>
          : rows.length === 0 ? <ListMessage><div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Katalog boş. “Hazır listeden ekle” ile gramaj, haslık gibi yaygın testleri tek adımda ekleyin.</div></ListMessage>
          : (
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr><th className="p-3 text-left">Kod</th><th className="p-3 text-left">Ad</th><th className="p-3 text-left">Yöntem</th><th className="p-3 text-left">Biçim</th><th className="p-3 text-left">Varsayılan sınır</th><th className="p-3 text-left">Durum</th>{canWrite && <th className="p-3" />}</tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="p-3 font-mono text-xs">{t.code}</td>
                    <td className="p-3">{t.name}</td>
                    <td className="p-3 text-muted-foreground">{t.method ?? "—"}</td>
                    <td className="p-3">{KIND_LABEL[t.resultKind]}{t.unit ? ` · ${t.unit}` : ""}</td>
                    <td className="p-3 tabular-nums">{specRangeText(t.specMin, t.specMax, t.resultKind) ?? "—"}</td>
                    <td className="p-3">{t.isActive ? <Badge variant="outline">Etkin</Badge> : <Badge variant="muted">Pasif</Badge>}</td>
                    {canWrite && (
                      <td className="whitespace-nowrap p-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Düzenle</Button>
                        <Button size="sm" variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate(t)}>{t.isActive ? "Pasife al" : "Etkinleştir"}</Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </ListBody>
      <ListFooter loaded={rows.length} />
      {editing && <LabTypeFormDialog initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {presetOpen && <LabPresetDialog onClose={() => setPresetOpen(false)} />}
    </>
  );
}
