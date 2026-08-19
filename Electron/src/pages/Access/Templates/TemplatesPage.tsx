import { useMemo, useState } from "react";
import { foldedIncludes } from "@/lib/search-fold";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, RotateCcw, Lock } from "lucide-react";
import { safeFormat } from "@/lib/format";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { RefreshButton } from "@/components/RefreshButton";
import { ListExportMenu } from "@/components/data-table/ListExportMenu";
import type { ExportColumn } from "@/lib/list-export";
import {
  permissionTemplateService,
  type PermissionTemplate,
} from "@/services/permissionTemplateService";
import { TemplateFormDialog } from "./TemplateFormDialog";

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

      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Şablon ara..."
          className="h-8 w-64 text-sm"
        />
        <div className="ml-auto">
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
      </div>

      <PageBody>
        <Table containerClassName="overflow-visible">
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>Ad</TableHead>
              <TableHead>Yetki Sayısı</TableHead>
              <TableHead>Açıklama</TableHead>
              <TableHead>Oluşturma</TableHead>
              <TableHead className="text-right">İşlem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  Şablon bulunamadı.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((t) => (
                <TableRow key={t.id} className={t.isActive ? undefined : "opacity-60"}>
                  <TableCell className="font-medium">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{t.name}</span>
                      {t.code && (
                        <Badge
                          variant="muted"
                          className="shrink-0 gap-1 font-normal"
                          title="Sistem rolü — sürümle birlikte gelir ve yeni yetkiler eklendikçe otomatik güncellenir. Silinmez, pasifleştirilir."
                        >
                          <Lock className="h-3 w-3" /> sistem
                        </Badge>
                      )}
                      {!t.isActive && (
                        <Badge variant="destructive" className="shrink-0 font-normal">
                          pasif
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="muted">{t.permissions.length}</Badge>
                  </TableCell>
                  <TableCell>
                    {t.description ? (
                      <span className="line-clamp-1 text-sm text-muted-foreground">
                        {t.description}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{safeFormat(t.createdAt, "dd.MM.yyyy")}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Düzenle"
                        onClick={() => {
                          setEditing(t);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {t.isActive ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          title={t.code ? "Pasifleştir" : "Sil"}
                          onClick={() => setRemoving(t)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Geri aç"
                          disabled={reactivateMut.isPending}
                          onClick={() => reactivateMut.mutate(t.id)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </PageBody>

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
