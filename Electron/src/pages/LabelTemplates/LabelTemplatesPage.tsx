// =============================================================================
// Etiket şablonları — TEK HAVUZ listesi (Etiket Stüdyosu v2)
// =============================================================================
// Tür sekmeleri kalktı: şablon türden bağımsızdır; nerede basılacağını ATAMALAR
// belirler (Atamalar sekmesi: bağlam varsayılanı · müşteri formu: müşteri ataması
// · cihaz kaydı: cihaz yönlendirmesi). Satırda boyut varyantı + atama rozetleri.

import { useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Star, Trash2, Pencil, PowerOff, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
import {
  labelKindLabels,
  labelTemplateService,
  type ContextDefaultRow,
  type LabelTemplate,
} from "@/services/labelTemplateService";
import { NewTemplateDialog } from "./NewTemplateDialog";

const QUERY_KEY = "label-templates";

export function LabelTemplatesPage({
  hideHeader,
  actionsPortal,
}: { hideHeader?: boolean; actionsPortal?: HTMLElement | null } = {}) {
  const navigate = useNavigate();
  const [newOpen, setNewOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [hardDeleting, setHardDeleting] = useState<{ id: string; name: string } | null>(null);

  const actions = (
    <>
      <RefreshButton queryKey={QUERY_KEY} />
      <PermissionGate permission="label-template:write">
        <Button size="sm" onClick={() => setNewOpen(true)} className="gap-1">
          <Plus className="h-4 w-4" /> Yeni Şablon
        </Button>
      </PermissionGate>
    </>
  );

  return (
    <div className="flex h-full flex-col">
      {!hideHeader && (
        <PageHeader
          title="Etiket Şablonları"
          description="Tek havuz — şablonlar türden bağımsız; nerede basılacağını Atamalar belirler."
          actions={actions}
        />
      )}

      <div className="flex-1 overflow-auto p-4">
        {hideHeader && !actionsPortal && (
          <div className="mb-3 flex items-center justify-end gap-2">{actions}</div>
        )}
        {hideHeader && actionsPortal && createPortal(actions, actionsPortal)}
        <PoolList
          onEdit={(id) => navigate(`/definitions/label-templates/${id}`)}
          onDelete={setDeletingId}
          onHardDelete={(t) => setHardDeleting({ id: t.id, name: t.name })}
        />
      </div>

      <NewTemplateDialog open={newOpen} onOpenChange={setNewOpen} />
      <DeleteConfirm id={deletingId} onClose={() => setDeletingId(null)} />
      <HardDeleteConfirm target={hardDeleting} onClose={() => setHardDeleting(null)} />
    </div>
  );
}

function PoolList({ onEdit, onDelete, onHardDelete }: {
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onHardDelete: (t: LabelTemplate) => void;
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
          onRestore={() => restoreMut.mutate(t.id)} onHardDelete={() => onHardDelete(t)} />
      ))}
    </ul>
  );
}

function PoolRow({ template: t, defaults, onEdit, onDelete, onRestore, onHardDelete }: {
  template: LabelTemplate;
  defaults: ContextDefaultRow[];
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onHardDelete: () => void;
}) {
  const defaultFor = defaults.filter((d) => d.templateId === t.id);
  const isAnyDefault = defaultFor.length > 0;
  return (
    <li className="flex flex-wrap items-center gap-2 p-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{t.name}</span>
          {defaultFor.map((d) => (
            <Badge key={d.kind} variant="muted" className="gap-1 text-[10px]">
              <Star className="h-3 w-3" /> {labelKindLabels[d.kind]} varsayılanı
            </Badge>
          ))}
          {!t.isActive && <Badge variant="outline" className="text-[10px]">Pasif</Badge>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          {(t.variants ?? []).length === 0 ? (
            <span title="Kanvas varyantı yok — eski akış düzeninde basılır">akış düzeni (varyantsız)</span>
          ) : (
            (t.variants ?? []).map((v) => (
              <span key={v.id} className="rounded border px-1 font-mono text-[10px]" title={v.name}>
                {v.isPrimary && "★"}{Number(v.widthMm)}×{Number(v.heightMm)}
              </span>
            ))
          )}
          {t.kind && <span>· eski tür: {labelKindLabels[t.kind]}</span>}
        </div>
      </div>
      <PermissionGate permission="label-template:write">
        <Button type="button" size="sm" variant="outline" onClick={onEdit} className="gap-1">
          <Pencil className="h-3.5 w-3.5" /> Stüdyoda Aç
        </Button>
        {!isAnyDefault && t.isActive && (
          <Button type="button" size="icon" variant="ghost" title="Pasife Al (geri alınabilir)"
            onClick={onDelete} className="h-8 w-8 text-destructive">
            <PowerOff className="h-3.5 w-3.5" />
          </Button>
        )}
        {!t.isActive && (
          <Button type="button" size="icon" variant="ghost" title="Aktifleştir"
            onClick={onRestore} className="h-8 w-8 text-primary">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
        {!isAnyDefault && (
          <Button type="button" size="icon" variant="ghost" title="Kalıcı Sil (GERİ ALINAMAZ)"
            onClick={onHardDelete} className="h-8 w-8 text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </PermissionGate>
    </li>
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
