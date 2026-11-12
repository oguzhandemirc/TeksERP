import { useMemo, useState } from "react";
import { foldedIncludes } from "@/lib/search-fold";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { safeFormat } from "@/lib/format";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { RefreshButton } from "@/components/RefreshButton";
import { ListExportMenu } from "@/components/data-table/ListExportMenu";
import type { ExportColumn } from "@/lib/list-export";
import {
  permissionTemplateService,
  type PermissionTemplate,
} from "@/services/permissionTemplateService";
import { TemplateFormDialog } from "./TemplateFormDialog";
import { useTemplatesTable } from "./templateColumns";

const QUERY_KEY = "permission-templates";

// Dışa aktarım sütunları — ekrandaki kolonların (Ad · Yetki Sayısı · Açıklama ·
// Oluşturma) ve satır rozetlerinin (sistem / pasif) düz karşılığı.
const TEMPLATE_EXPORT_COLUMNS: ExportColumn<PermissionTemplate>[] = [
  { label: "Ad", value: (t) => t.name },
  { label: "Kod", value: (t) => t.code ?? "" },
  { label: "Sistem Rolü", value: (t) => (t.code ? "Evet" : "Hayır") },
  { label: "Durum", value: (t) => (t.isActive ? "Aktif" : "Pasif") },
  { label: "Yetki Sayısı", value: (t) => t.permissions.length, summable: true },
  { label: "Açıklama", value: (t) => t.description ?? "" },
  { label: "Oluşturma", value: (t) => safeFormat(t.createdAt, "dd.MM.yyyy HH:mm") },
];

export function TemplatesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PermissionTemplate | null>(null);
  const [removing, setRemoving] = useState<PermissionTemplate | null>(null);

  const query = useQuery({
    queryKey: [QUERY_KEY],
    queryFn: permissionTemplateService.list,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const filtered = useMemo(() => {
    const list = query.data?.data ?? [];
    if (!search) return list;
    // ⚠️ Terime ÖN İŞLEM UYGULAMA: `search.toLowerCase()` Türkçede BOZUKTUR
    // ("ŞAHİN" → "şahi̇n", i + U+0307) ve katlamadan sonra da nokta kalır →
    // büyük İ içeren her arama 0 satır dönerdi. Ham terimi ver.
    const q = search;
    return list.filter(
      (t) =>
        foldedIncludes(t.name, q) || foldedIncludes(t.description, q),
    );
  }, [query.data, search]);

  const invalidate = () => qc.invalidateQueries({ queryKey: [QUERY_KEY] });

  const createMut = useMutation({
    mutationFn: permissionTemplateService.create,
    onSuccess: () => {
      toast.success("Şablon oluşturuldu.");
      invalidate();
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof permissionTemplateService.update>[1] }) =>
      permissionTemplateService.update(id, data),
    onSuccess: () => {
      toast.success("Şablon güncellendi.");
      invalidate();
    },
  });

  const removeMut = useMutation({
    mutationFn: permissionTemplateService.remove,
    onSuccess: (_data, id) => {
      const t = (query.data?.data ?? []).find((x) => x.id === id);
      toast.success(t?.code ? "Rol pasifleştirildi." : "Şablon silindi.");
      invalidate();
    },
  });

  const reactivateMut = useMutation({
    mutationFn: (id: string) => permissionTemplateService.update(id, { isActive: true }),
    onSuccess: () => {
      toast.success("Rol geri açıldı.");
      invalidate();
    },
  });

  const table = useTemplatesTable(filtered, {
    onEdit: (t) => {
      setEditing(t);
      setFormOpen(true);
    },
    onRemove: setRemoving,
    onReactivate: (t) => reactivateMut.mutate(t.id),
    reactivating: reactivateMut.isPending,
  });

  const onSubmit = async (values: {
    name: string;
    description?: string | null;
    permissionIds: string[];
  }) => {
    if (editing) {
      await updateMut.mutateAsync({ id: editing.id, data: values });
    } else {
      await createMut.mutateAsync(values);
    }
    setFormOpen(false);
    setEditing(null);
  };

  return (
    <PageShell>
      <PageHeader
        title="Yetki Şablonları"
        actions={
          <>
            <RefreshButton queryKey={QUERY_KEY} />
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Yeni Şablon
            </Button>
          </>
        }
      />

      <ListToolbar className="flex-row flex-wrap items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ara…"
          title="Şablon adı ya da açıklamasıyla ara"
          aria-label="Şablon adı ya da açıklamasıyla ara"
          className="h-8 w-64 text-sm"
        />
        <div className="ml-auto flex items-center gap-1.5">
          {/* Dosya kendi sütunlarıyla iner (kod, sistem rolü, durum) — tablo menüsünde ikinci indirme yok. */}
          <DataTableTools table={table} compact hideExport />
          <ListExportMenu
            name="Yetki Şablonları"
            rows={filtered}
            columns={TEMPLATE_EXPORT_COLUMNS}
            notes={[
              "Liste ekrandaki aramaya göredir.",
              "Pasifleştirilmiş roller de dosyaya girer (Durum sütununda işaretli).",
              "Yetki Sayısı = role bağlı yetki adedi; yetki kodları dosyaya yazılmaz.",
            ]}
          />
        </div>
      </ListToolbar>

      {!query.isLoading && filtered.length > 0 ? (
        <DataTable table={table} exportName="Yetki Şablonları" rowClassName={(t) => (t.isActive ? undefined : "opacity-60")} />
      ) : (
        <ListBody>
          {query.isLoading ? (
            <ListMessage className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </ListMessage>
          ) : (
            <p className="py-10 text-center text-muted-foreground">Şablon bulunamadı.</p>
          )}
        </ListBody>
      )}

      <TemplateFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        initial={editing}
        onSubmit={onSubmit}
        isSubmitting={createMut.isPending || updateMut.isPending}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing?.code ? "Rolü pasifleştir" : "Şablonu sil"}
        description={
          removing?.code
            ? "Bu bir SİSTEM rolüdür ve silinmez — pasifleştirilir. Sebep: sistem rolleri sürümle birlikte gelir, sert silinseydi sunucu her açıldığında geri gelirdi. Pasif rol yetki atama ekranındaki listede görünmez; istediğinde geri açabilirsin. Mevcut kullanıcıların yetkileri ETKİLENMEZ (rol uygulandığında yetkiler kopyalanır)."
            : "Şablonu silmek mevcut kullanıcılara yansımaz (yetkiler kopya tutulur). Devam edilsin mi?"
        }
        confirmLabel={removing?.code ? "Pasifleştir" : "Sil"}
        destructive
        isPending={removeMut.isPending}
        onConfirm={async () => {
          if (!removing) return;
          await removeMut.mutateAsync(removing.id);
          setRemoving(null);
        }}
      />
    </PageShell>
  );
}
