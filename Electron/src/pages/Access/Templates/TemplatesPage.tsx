import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { safeFormat } from "@/lib/format";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { RefreshButton } from "@/components/RefreshButton";
import {
  permissionTemplateService,
  type PermissionTemplate,
} from "@/services/permissionTemplateService";
import { TemplateFormDialog } from "./TemplateFormDialog";

const QUERY_KEY = "permission-templates";

export function TemplatesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PermissionTemplate | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: [QUERY_KEY],
    queryFn: permissionTemplateService.list,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const filtered = useMemo(() => {
    const list = query.data?.data ?? [];
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(
      (t) =>
        t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q),
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
    onSuccess: () => {
      toast.success("Şablon silindi.");
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
    <div className="flex h-full flex-col">
      <PageHeader
        title="Yetki Şablonları"
        description="Yetki kümelerini şablonla, kullanıcılara tek tıkla uygula."
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
      </div>

      <div className="flex-1 overflow-auto">
        <Table>
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
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
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
                        onClick={() => {
                          setEditing(t);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => setRemovingId(t.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
        open={Boolean(removingId)}
        onOpenChange={(open) => !open && setRemovingId(null)}
        title="Şablonu sil"
        description="Şablonu silmek mevcut kullanıcılara yansımaz (yetkiler kopya tutulur). Devam edilsin mi?"
        confirmLabel="Sil"
        destructive
        isPending={removeMut.isPending}
        onConfirm={async () => {
          if (!removingId) return;
          await removeMut.mutateAsync(removingId);
          setRemovingId(null);
        }}
      />
    </div>
  );
}
