import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Star, StarOff, Trash2, Pencil, PowerOff, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
import {
  LabelKind,
  labelKindLabels,
  labelTemplateService,
  type LabelTemplate,
} from "@/services/labelTemplateService";
import { NewTemplateDialog } from "./NewTemplateDialog";

const QUERY_KEY = "label-templates";

export function LabelTemplatesPage({ hideHeader }: { hideHeader?: boolean } = {}) {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  // Aktif tür URL'de (?kind=) — düzenle→geri dönünce hatırlanır (yoksa Bitmiş).
  const kindParam = sp.get("kind");
  const activeKind: LabelKind = (Object.keys(labelKindLabels) as LabelKind[]).includes(kindParam as LabelKind)
    ? (kindParam as LabelKind)
    : LabelKind.ROLL_FINISHED;
  const setActiveKind = (k: LabelKind) => {
    const n = new URLSearchParams(sp);
    n.set("kind", k);
    setSp(n, { replace: true });
  };
  const [newOpen, setNewOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [hardDeleting, setHardDeleting] = useState<{ id: string; name: string } | null>(null);

  // Düzenleme sayfası, aynı tür+sekmeye dönebilmek için türü URL'den okur.
  const handleEdit = (id: string) =>
    navigate(`/definitions/label-templates/${id}`);

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
          title="Etiket Standartları"
          description="Top, kartela ve sevkiyat etiketlerinin alan listesi, sırası ve görünümü."
          actions={actions}
        />
      )}

      <div className="flex-1 overflow-auto p-4">
        <Tabs value={activeKind} onValueChange={(v) => setActiveKind(v as LabelKind)}>
          {hideHeader && (
            <div className="mb-3 flex items-center justify-end gap-2">{actions}</div>
          )}
          <TabsList>
            {(Object.keys(labelKindLabels) as LabelKind[]).map((k) => (
              <TabsTrigger key={k} value={k}>
                {labelKindLabels[k]}
              </TabsTrigger>
            ))}
          </TabsList>

          {(Object.keys(labelKindLabels) as LabelKind[]).map((k) => (
            <TabsContent key={k} value={k} className="mt-3">
              <TemplateList
                kind={k}
                onEdit={handleEdit}
                onDelete={setDeletingId}
                onHardDelete={(t) => setHardDeleting({ id: t.id, name: t.name })}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <NewTemplateDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        defaultKind={activeKind}
      />

      <DeleteConfirm
        id={deletingId}
        onClose={() => setDeletingId(null)}
      />

      <HardDeleteConfirm
        target={hardDeleting}
        onClose={() => setHardDeleting(null)}
      />
    </div>
  );
}

function TemplateList({
  kind,
  onEdit,
  onDelete,
  onHardDelete,
}: {
  kind: LabelKind;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onHardDelete: (t: LabelTemplate) => void;
}) {
  const qc = useQueryClient();
  const queryKey = [QUERY_KEY, kind];
  const query = useQuery({
    queryKey,
    queryFn: () => labelTemplateService.list(kind),
  });

  const setDefaultMut = useMutation({
    mutationFn: (id: string) => labelTemplateService.setDefault(id),
    onSuccess: () => {
      toast.success("Varsayılan şablon güncellendi.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  // Pasif şablonu geri aktifleştir (users kalıbı: pasife alma GERİ ALINABİLİR).
  const restoreMut = useMutation({
    mutationFn: (id: string) => labelTemplateService.update(id, { isActive: true }),
    onSuccess: () => {
      toast.success("Şablon aktifleştirildi.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  if (query.isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }

  const rows = query.data?.data ?? [];
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Bu tür için tanımlı template yok.
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-md border">
      {rows.map((t) => (
        <TemplateRow
          key={t.id}
          template={t}
          onSetDefault={() => setDefaultMut.mutate(t.id)}
          onEdit={() => onEdit(t.id)}
          onDelete={() => onDelete(t.id)}
          onRestore={() => restoreMut.mutate(t.id)}
          onHardDelete={() => onHardDelete(t)}
        />
      ))}
    </ul>
  );
}

function TemplateRow({
  template,
  onSetDefault,
  onEdit,
  onDelete,
  onRestore,
  onHardDelete,
}: {
  template: LabelTemplate;
  onSetDefault: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onHardDelete: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 p-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{template.name}</span>
          {template.isDefault && (
            <Badge variant="muted" className="gap-1 text-[10px]">
              <Star className="h-3 w-3" /> Varsayılan
            </Badge>
          )}
          {!template.isActive && (
            <Badge variant="outline" className="text-[10px]">
              Pasif
            </Badge>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {template.fields.filter((f) => f.isVisible).length} görünür alan ·{" "}
          {template.fields.length} toplam
        </div>
      </div>
      <PermissionGate permission="label-template:write">
        {!template.isDefault && template.isActive && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1"
            onClick={onSetDefault}
          >
            <StarOff className="h-3.5 w-3.5" /> Varsayılan Yap
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" onClick={onEdit} className="gap-1">
          <Pencil className="h-3.5 w-3.5" /> Düzenle
        </Button>
        {/* Pasife Al (aktifse) / Aktifleştir (pasifse) — GERİ ALINABİLİR */}
        {!template.isDefault && template.isActive && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            title="Pasife Al (geri alınabilir)"
            onClick={onDelete}
            className="h-8 w-8 text-destructive"
          >
            <PowerOff className="h-3.5 w-3.5" />
          </Button>
        )}
        {!template.isActive && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            title="Aktifleştir"
            onClick={onRestore}
            className="h-8 w-8 text-primary"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
        {/* Kalıcı Sil — GERİ ALINAMAZ (default şablonda kapalı; backend de reddeder) */}
        {!template.isDefault && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            title="Kalıcı Sil (GERİ ALINAMAZ)"
            onClick={onHardDelete}
            className="h-8 w-8 text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </PermissionGate>
    </li>
  );
}

function DeleteConfirm({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
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
      description="Varsayılan şablonlar pasifleştirilemez. Önce başka bir şablonu varsayılan yapın."
      confirmLabel="Pasifleştir"
      destructive
      onConfirm={() => {
        if (id) mut.mutate();
      }}
    />
  );
}

function HardDeleteConfirm({
  target,
  onClose,
}: {
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
          ? `"${target.name}" KALICI olarak silinecek — bu işlem GERİ ALINAMAZ. Kayıt yalnız ` +
            `veri bütünlüğü için arka planda saklanır; listelerde görünmez, aktifleştirilemez. ` +
            `Cihazlardaki şablon yönlendirmeleri kaldırılır, şablon adı serbest kalır. ` +
            `Geçici olarak durdurmak istiyorsanız "Pasife Al"ı kullanın.`
          : ""
      }
      confirmLabel="Kalıcı Sil"
      destructive
      isPending={mut.isPending}
      onConfirm={() => {
        if (target) mut.mutate();
      }}
    />
  );
}
