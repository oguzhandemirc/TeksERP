// =============================================================================
// Etiket şablonları — TEK HAVUZ listesi (Etiket Stüdyosu v2)
// =============================================================================
// Tür sekmeleri kalktı: şablon türden bağımsızdır; nerede basılacağını ATAMALAR
// belirler (Atamalar sekmesi: bağlam varsayılanı · müşteri formu: müşteri ataması
// · cihaz kaydı: cihaz yönlendirmesi). Satırda boyut varyantı + atama rozetleri.

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Upload } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
import {
  labelTemplateService,
  type LabelTemplateListRow,
  type TemplateEnvelope,
} from "@/services/labelTemplateService";
import { PoolRow } from "./TemplateRow";
import { NewTemplateDialog } from "./NewTemplateDialog";
import { TemplatePrintDialog } from "./TemplatePrintDialog";

const QUERY_KEY = "label-templates";

export function LabelTemplatesPage({
  hideHeader,
  actionsPortal,
}: { hideHeader?: boolean; actionsPortal?: HTMLElement | null } = {}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [hardDeleting, setHardDeleting] = useState<{ id: string; name: string } | null>(null);
  const [printing, setPrinting] = useState<LabelTemplateListRow | null>(null);

  const importMut = useMutation({
    mutationFn: (env: TemplateEnvelope) => labelTemplateService.importTemplate(env),
    onSuccess: (r) => {
      toast.success(`Şablon içe aktarıldı: ${r.data.name}`);
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // aynı dosyayı tekrar seçebilmek için sıfırla
    if (!file) return;
    try {
      const env = JSON.parse(await file.text()) as TemplateEnvelope;
      if (!env?.template?.name || !Array.isArray(env?.variants)) {
        toast.error("Geçersiz şablon dosyası.");
        return;
      }
      importMut.mutate(env);
    } catch {
      toast.error("Dosya okunamadı — geçerli bir .json şablon dosyası seçin.");
    }
  };

  const actions = (
    <>
      <RefreshButton queryKey={QUERY_KEY} />
      <PermissionGate permission="label-template:write">
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}
          disabled={importMut.isPending} className="gap-1">
          <Upload className="h-4 w-4" /> İçe Aktar
        </Button>
        <Button size="sm" onClick={() => setNewOpen(true)} className="gap-1">
          <Plus className="h-4 w-4" /> Yeni Şablon
        </Button>
      </PermissionGate>
    </>
  );

  return (
    <PageShell>
      {!hideHeader && (
        <PageHeader
          title="Etiket Şablonları"
          actions={actions}
        />
      )}

      <PageBody className="p-4">
        {hideHeader && !actionsPortal && (
          <div className="mb-3 flex items-center justify-end gap-2">{actions}</div>
        )}
        {hideHeader && actionsPortal && createPortal(actions, actionsPortal)}
        <PoolList
          onEdit={(id) => navigate(`/definitions/label-templates/${id}`)}
          onDelete={setDeletingId}
          onHardDelete={(t) => setHardDeleting({ id: t.id, name: t.name })}
          onPrint={setPrinting}
        />
      </PageBody>

      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onPickFile} />

      <NewTemplateDialog open={newOpen} onOpenChange={setNewOpen} />
      <DeleteConfirm id={deletingId} onClose={() => setDeletingId(null)} />
      <HardDeleteConfirm target={hardDeleting} onClose={() => setHardDeleting(null)} />
      {printing && (
        <TemplatePrintDialog
          template={printing}
          open
          onOpenChange={(o) => { if (!o) setPrinting(null); }}
        />
      )}
    </PageShell>
  );
}

function PoolList({ onEdit, onDelete, onHardDelete, onPrint }: {
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onHardDelete: (t: LabelTemplateListRow) => void;
  onPrint: (t: LabelTemplateListRow) => void;
}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [QUERY_KEY, "pool"],
    queryFn: () => labelTemplateService.list(),
  });
  const defaultsQ = useQuery({
    queryKey: ["label-context-defaults"],
    queryFn: () => labelTemplateService.listContextDefaults(),
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) => labelTemplateService.update(id, { isActive: true }),
    onSuccess: () => {
      toast.success("Şablon aktifleştirildi.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  const duplicateMut = useMutation({
    mutationFn: (id: string) => labelTemplateService.duplicate(id),
    onSuccess: (r) => {
      toast.success(`Çoğaltıldı: ${r.data.name}`);
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  const handleExport = async (t: LabelTemplateListRow) => {
    try {
      const env = await labelTemplateService.exportTemplate(t.id);
      const json = JSON.stringify(env, null, 2);
      const safeName = (t.name || "sablon").replace(/[^\w.-]+/g, "_");
      const filesApi = typeof window !== "undefined" ? window.api?.files : undefined;
      if (filesApi?.save) {
        const bytes = new TextEncoder().encode(json);
        let bin = "";
        for (const b of bytes) bin += String.fromCharCode(b);
        const res = await filesApi.save({ name: `${safeName}.json`, base64: btoa(bin) });
        if (res.saved) toast.success("Şablon dışa aktarıldı.");
        else if (res.error) toast.error(`Dışa aktarma başarısız: ${res.error}`);
        // (res.error yoksa = kullanıcı iptal etti → sessiz)
      } else {
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `${safeName}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast.success("Şablon indirildi.");
      }
    } catch {
      toast.error("Dışa aktarma başarısız.");
    }
  };

  if (query.isLoading) return <Skeleton className="h-40 w-full" />;
  const rows = query.data?.data ?? [];
  const defaults = defaultsQ.data ?? [];
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Havuzda şablon yok — "Yeni Şablon" ile başlayın.
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-md border">
      {rows.map((t) => (
        <PoolRow key={t.id} template={t} defaults={defaults}
          onEdit={() => onEdit(t.id)} onDelete={() => onDelete(t.id)}
          onRestore={() => restoreMut.mutate(t.id)} onHardDelete={() => onHardDelete(t)}
          onPrint={() => onPrint(t)} onExport={() => handleExport(t)}
          onDuplicate={() => duplicateMut.mutate(t.id)} />
      ))}
    </ul>
  );
}

function DeleteConfirm({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => labelTemplateService.remove(id!),
    onSuccess: () => {
      toast.success("Şablon pasifleştirildi.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      onClose();
    },
  });
  return (
    <ConfirmDialog
      open={Boolean(id)}
      onOpenChange={(open) => !open && onClose()}
      title="Şablon pasifleştirilsin mi?"
      description="Bağlam varsayılanı olan şablon pasifleştirilemez — önce Atamalar'dan varsayılanı değiştirin. Cihaz/müşteri atamaları varsayılana düşer."
      confirmLabel="Pasifleştir"
      destructive
      isPending={mut.isPending}
      onConfirm={() => { if (id) mut.mutate(); }}
    />
  );
}

function HardDeleteConfirm({ target, onClose }: {
  target: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => labelTemplateService.hardRemove(target!.id),
    onSuccess: () => {
      toast.success("Şablon kalıcı olarak silindi.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      onClose();
    },
  });
  return (
    <ConfirmDialog
      open={Boolean(target)}
      onOpenChange={(open) => !open && onClose()}
      title="Şablon KALICI silinsin mi?"
      description={
        target
          ? `"${target.name}" KALICI olarak silinecek — bu işlem GERİ ALINAMAZ. Cihaz VE müşteri ` +
            `atamaları kaldırılır (etkilenenler varsayılana düşer), boyut varyantları silinir, ` +
            `şablon adı serbest kalır. Geçici durdurmak için "Pasife Al"ı kullanın.`
          : ""
      }
      confirmLabel="Kalıcı Sil"
      destructive
      isPending={mut.isPending}
      onConfirm={() => { if (target) mut.mutate(); }}
    />
  );
}
