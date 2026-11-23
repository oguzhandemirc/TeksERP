// =============================================================================
// "DOKUMA İŞ EMRİ OLUŞTUR" — Dokuma menüsünün oluşturma girişi (İE ayrımı 2026-11-23)
// =============================================================================
// Terbiye seçicisinin dokuma karşılığı: 1. satır Standart (Dokuma İş Emri), 2. satır Özel dokuma iş emirleri
// (şablonlar + "Yeni özel dokuma iş emri"). Seçim dokuma iş emirleri listesine oluşturma diyaloğu AÇIK gider;
// şablon formu ön-doldurur (`preset`). Kapı: route `weavingorder:write` + `ROUTE_MODULE` dokuma; uç `requireDokumaEnabled`.
// =============================================================================
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Pencil, Plus, Spool, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { hubTone } from "@/components/hub/HubCard";
import { TERIM } from "@/lib/terim";
import { screenTitle } from "@/components/layout/screen-title";
import { useTabsStore } from "@/store/tabs";
import { SeciciKaro, PickerRow } from "@/pages/Operations/WorkOrders/oie/SeciciKaro";
import { WEAVING_ORDERS_PATH, type WeavingNavState } from "@/pages/Operations/WorkOrders/oie/nav";
import { WEAVING_KIND_LABEL } from "../types";
import { orderTemplates, templateHint, templatePayload, templateToPreset, type TemplateFormValues } from "./preset";
import { WEAVING_TEMPLATES_KEY, weavingTemplateService } from "./service";
import { WeavingTemplateFormDialog } from "./WeavingTemplateFormDialog";
import type { WeavingOrderTemplate } from "./types";

/** Diyalog anahtarı: `null` kapalı · `"new"` oluştur · kayıt = düzenle. */
type Editing = null | "new" | WeavingOrderTemplate;

function useTemplateMutations(onDone: () => void) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: WEAVING_TEMPLATES_KEY });
  const save = useMutation({
    mutationFn: ({ id, values }: { id: string | null; values: TemplateFormValues }) =>
      id ? weavingTemplateService.update(id, templatePayload(values)) : weavingTemplateService.create(templatePayload(values)),
    onSuccess: () => { toast.success("Şablon kaydedildi"); void refresh(); onDone(); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => weavingTemplateService.deactivate(id),
    onSuccess: () => { toast.success("Şablon kaldırıldı"); void refresh(); },
  });
  return { save, remove };
}

export function DokumaIsEmriOlusturPage() {
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<WeavingOrderTemplate | null>(null);
  const { save, remove } = useTemplateMutations(() => setEditing(null));
  const q = useQuery({ queryKey: WEAVING_TEMPLATES_KEY, queryFn: weavingTemplateService.listActive, staleTime: 60_000 });
  const open = (state: WeavingNavState) => navigateActive(WEAVING_ORDERS_PATH, { state });
  // Liste okunamadıysa şablon yok sayılır (standart giriş durmaz).
  const templates = orderTemplates(q.data ?? []);
  return (
    <PageShell>
      <PageHeader
        title={screenTitle("/operations/weaving-orders/new")}
        description="Standart dokuma iş emri ya da kendi tanımladığınız ön-dolu özel dokuma iş emri."
        parent={{ label: TERIM.dokumaIsEmri.cogul, to: WEAVING_ORDERS_PATH }}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-6" data-testid="wo-picker">
        <PickerRow title="Standart" icon={Layers} testId="wo-row-standard">
          <SeciciKaro icon={Spool} tone={hubTone(1)} title={TERIM.dokumaIsEmri.tekil} hint="Ne dokunacak, ne kadar, kimde" testId="wo-standard" onClick={() => open({ openNew: true })} />
        </PickerRow>
        <PickerRow title={`Özel ${TERIM.dokumaIsEmri.cogulKucuk}`} icon={Zap} testId="wo-row-templates">
          {q.isLoading && <Skeleton className="h-28 w-full" />}
          {templates.map((t, i) => (
            <SeciciKaro key={t.id} icon={Zap} tone={hubTone(i + 2)} title={t.name} hint={templateHint(t, WEAVING_KIND_LABEL)} testId="wo-template"
              onClick={() => open({ openNew: true, preset: templateToPreset(t) })}
              aside={<TemplateActions onEdit={() => setEditing(t)} onRemove={() => setRemoving(t)} />} />
          ))}
          <SeciciKaro icon={Plus} tone="text-muted-foreground" dashed title={`Yeni özel ${TERIM.dokumaIsEmri.tekilKucuk}`}
            hint="Ön-dolu şablon tanımla — kısayol olarak burada çıkar" testId="wo-new-template" onClick={() => setEditing("new")} />
        </PickerRow>
      </div>
      {editing !== null && (
        <WeavingTemplateFormDialog
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          isSubmitting={save.isPending}
          onSubmit={(values) => save.mutateAsync({ id: editing === "new" ? null : editing.id, values })}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`“${removing?.name ?? ""}” şablonu kaldırılsın mı?`}
        description="Şablon listeden kalkar; bu şablonla açılmış dokuma iş emirleri değişmez."
        confirmLabel="Kaldır"
        destructive
        onConfirm={() => (removing ? remove.mutateAsync(removing.id).then(() => setRemoving(null)) : undefined)}
      />
    </PageShell>
  );
}

function TemplateActions({ onEdit, onRemove }: { onEdit: () => void; onRemove: () => void }) {
  return (
    <div className="flex gap-1">
      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Şablonu düzenle" title="Düzenle" data-testid="wo-template-edit" onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Şablonu kaldır" title="Kaldır" data-testid="wo-template-remove" onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
