// Yetki şablonları — ortak DataTable sütunları (ad + sistem/pasif rozeti, yetki sayısı, açıklama, eylemler).
import { useMemo, useRef } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Lock, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocalTable } from "@/hooks/useLocalTable";
import { safeFormat } from "@/lib/format";
import type { PermissionTemplate } from "@/services/permissionTemplateService";

export interface TemplateRowActions {
  onEdit: (t: PermissionTemplate) => void;
  onRemove: (t: PermissionTemplate) => void;
  onReactivate: (t: PermissionTemplate) => void;
  reactivating: boolean;
}

const SYSTEM_HINT =
  "Sistem rolü — sürümle birlikte gelir ve yeni yetkiler eklendikçe otomatik güncellenir. Silinmez, pasifleştirilir.";

function RowActions({ t, a }: { t: PermissionTemplate; a: TemplateRowActions }) {
  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="icon" className="h-7 w-7" title="Düzenle" onClick={() => a.onEdit(t)}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      {t.isActive ? (
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title={t.code ? "Pasifleştir" : "Sil"} onClick={() => a.onRemove(t)}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Geri aç" disabled={a.reactivating} onClick={() => a.onReactivate(t)}>
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function templateColumns(actions: { current: TemplateRowActions }): ColumnDef<PermissionTemplate>[] {
  return [
    {
      accessorKey: "name",
      header: "Ad",
      meta: { label: "Ad" },
      cell: ({ row: { original: t } }) => (
        <div className="flex min-w-0 items-center gap-1.5 font-medium">
          <span className="truncate">{t.name}</span>
          {t.code && (
            <Badge variant="muted" className="shrink-0 gap-1 font-normal" title={SYSTEM_HINT}>
              <Lock className="h-3 w-3" /> sistem
            </Badge>
          )}
          {!t.isActive && <Badge variant="destructive" className="shrink-0 font-normal">pasif</Badge>}
        </div>
      ),
    },
    {
      id: "permissionCount",
      accessorFn: (t) => t.permissions.length,
      header: "Yetki Sayısı",
      meta: { label: "Yetki Sayısı", align: "right" },
      cell: ({ row }) => <Badge variant="muted">{row.original.permissions.length}</Badge>,
    },
    {
      id: "description",
      header: "Açıklama",
      meta: { label: "Açıklama", exportValue: (t) => t.description ?? "" },
      cell: ({ row: { original: t } }) =>
        t.description ? <span className="text-sm text-muted-foreground">{t.description}</span> : <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: "createdAt",
      header: "Oluşturma",
      meta: { label: "Oluşturma", exportValue: (t) => safeFormat(t.createdAt, "dd.MM.yyyy") },
      cell: ({ row }) => <span className="tabular-nums">{safeFormat(row.original.createdAt, "dd.MM.yyyy")}</span>,
    },
    { id: "actions", header: "", size: 96, enableSorting: false, cell: ({ row }) => <RowActions t={row.original} a={actions.current} /> },
  ];
}

export function useTemplatesTable(rows: PermissionTemplate[], actions: TemplateRowActions) {
  // Eylem geri çağrıları her render'da yenidir; sütunlar bir kez kurulur, düğmeler güncel eylemi okur.
  const ref = useRef(actions);
  ref.current = actions;
  const columns = useMemo(() => templateColumns(ref), []);
  return useLocalTable({ tableKey: "access:permission-templates", data: rows, columns });
}
