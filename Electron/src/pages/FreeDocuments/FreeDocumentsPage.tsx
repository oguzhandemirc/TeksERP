import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { safeFormat } from "@/lib/format";
import { freeDocumentService, type FreeDocument, type FreeDocumentRow } from "@/services/freeDocumentService";
import { FreeDocumentEditor, FREE_DOCS_QUERY_KEY } from "./FreeDocumentEditor";
import { FreeDocumentPrintDialog } from "./FreeDocumentPrintDialog";

/**
 * Serbest Belgeler — sisteme bağlı olmayan, admin'in elle yazdığı belgeler
 * (üst yazı, tutanak, dekont, duyuru). Liste + oluştur/düzenle + yazdır/PDF.
 */
export function FreeDocumentsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<FreeDocument | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [printDoc, setPrintDoc] = useState<FreeDocumentRow | null>(null);
  const [confirmDel, setConfirmDel] = useState<FreeDocumentRow | null>(null);

  const listQ = useQuery({ queryKey: FREE_DOCS_QUERY_KEY, queryFn: () => freeDocumentService.list() });
  const rows = listQ.data?.data ?? [];

  const delMut = useMutation({
    mutationFn: (id: string) => freeDocumentService.deactivate(id),
    onSuccess: () => {
      toast.success("Belge pasifleştirildi.");
      void qc.invalidateQueries({ queryKey: FREE_DOCS_QUERY_KEY });
    },
  });

  const openNew = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = async (id: string) => {
    const res = await freeDocumentService.get(id);
    setEditing(res.data);
    setEditorOpen(true);
  };

  return (
    <PageShell>
      <PageHeader
        title="Serbest Belgeler"
        actions={
          <div className="flex items-center gap-2">
            <PermissionGate permission="admin:settings">
              <Button size="sm" onClick={openNew}>
                <Plus className="mr-1 h-4 w-4" /> Yeni Belge
              </Button>
            </PermissionGate>
            <RefreshButton queryKey={FREE_DOCS_QUERY_KEY} />
          </div>
        }
      />
      <PageBody className="p-4">
        {listQ.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <FileText className="h-10 w-10 opacity-40" />
            <p className="text-sm">Henüz serbest belge yok.</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-md border bg-card px-3 py-2">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.title}</div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">{r.documentNo}</span>
                    {r.recipient ? ` · ${r.recipient}` : ""} · {safeFormat(r.createdAt, "dd.MM.yyyy")}
                  </div>
                </div>
                <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => setPrintDoc(r)}>
                  <Printer className="h-3.5 w-3.5" /> Yazdır
                </Button>
                <PermissionGate permission="admin:settings">
                  <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => openEdit(r.id)}>
                    <Pencil className="h-3.5 w-3.5" /> Düzenle
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-destructive hover:text-destructive"
                    onClick={() => setConfirmDel(r)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </PermissionGate>
              </div>
            ))}
          </div>
        )}
      </PageBody>

      <FreeDocumentEditor open={editorOpen} onOpenChange={setEditorOpen} initial={editing} />
      <FreeDocumentPrintDialog doc={printDoc} open={Boolean(printDoc)} onOpenChange={(o) => !o && setPrintDoc(null)} />
      <ConfirmDialog
        open={Boolean(confirmDel)}
        onOpenChange={(o) => !o && setConfirmDel(null)}
        title="Belgeyi pasifleştir"
        description={`"${confirmDel?.title ?? ""}" belgesi listeden kaldırılacak (kayıt silinmez).`}
        confirmLabel="Pasifleştir"
        cancelLabel="Vazgeç"
        destructive
        onConfirm={() => {
          if (confirmDel) delMut.mutate(confirmDel.id);
          setConfirmDel(null);
        }}
      />
    </PageShell>
  );
}
