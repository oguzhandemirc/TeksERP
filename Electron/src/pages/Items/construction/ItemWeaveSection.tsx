// Ürün penceresi > Desen (B19): desen kartını kısa listeden seç ya da aynı pencereden yeni desen kartı aç (kod · ad ·
// mekanizma · örgü); armür ızgarası / jakar bilgileri Desen Kartları ekranında doldurulur.
// Kullanım yeri (kullanıcı 2026-11-25): desen burada düzenlenmez — "Örnek al" (yalnız yeni kart) ya da Desen Kartları ekranında aç.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Controller, type UseFormReturn } from "react-hook-form";
import { Copy, Grid3x3, Plus, SquareArrowOutUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/forms/FormField";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { WeaveDesignCopyDialog } from "@/pages/WeaveDesigns/WeaveDesignCopyDialog";
import { WeaveDesignCreateDialog } from "@/pages/WeaveDesigns/WeaveDesignCreateDialog";
import { weaveDesignApi } from "@/pages/WeaveDesigns/service";
import type { WeaveDesign } from "@/pages/WeaveDesigns/types";
import { useWeaveDesignRecordForm } from "@/pages/WeaveDesigns/useWeaveDesignRecordForm";
import { SHED_MECHANISM_LABEL, WEAVE_STRUCTURE_LABEL, resolveWeaveClass, weaveClassLabel } from "@/pages/WeaveDesigns/weave-class";
import { weaveDesignPickerService, type WeaveDesignRef } from "../construction-service";
import type { ItemFormValues } from "../schema";

/** Mekanizmaya ait kısa ayrıntı: Armür → çerçeve + .DOP, Jakar → kanca + rapor + dosya, Eksantrik → yok. */
export function mechanismDetail(d: WeaveDesign): string[] {
  const m = resolveWeaveClass(d).shedMechanism;
  if (m === "DOBBY") return [d.frameCount ? `${d.frameCount} çerçeve` : null, d.loomFileName ? `tezgâh dosyası ${d.loomFileName}` : null].filter((x): x is string => !!x);
  if (m === "JACQUARD") {
    return [
      d.hookCount ? `${d.hookCount} kanca` : null,
      d.repeatWidthCm && d.repeatCm ? `desen raporu ${d.repeatWidthCm} × ${d.repeatCm} cm` : null,
      d.loomFileName ? `desen dosyası ${d.loomFileName}` : null,
    ].filter((x): x is string => !!x);
  }
  return [];
}

// Sekme deposu tembel: statik import bütün rota ağacını ürün penceresine bağlardı.
function openWeaveDesign(id: string) {
  void import("@/store/tabs").then((m) => m.useTabsStore.getState().openTab(`/definitions/weave-designs/${id}`, { forceNew: true }));
}

export function ItemWeaveSection({ form, canWrite }: { form: UseFormReturn<ItemFormValues>; canWrite: boolean }) {
  const [creating, setCreating] = useState(false);
  const [copying, setCopying] = useState(false);
  const weaveForm = useWeaveDesignRecordForm();
  const designId = form.watch("weaveDesignId");
  const design = useQuery({ queryKey: ["weave-designs", "detail", designId], queryFn: () => weaveDesignApi.get(designId), enabled: !!designId });
  const d = design.data;
  const cls = d ? resolveWeaveClass(d) : null;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <FormField label="Desen kartı" error={form.formState.errors.weaveDesignId} info="Mekanizma (Eksantrik · Armür · Jakar), örgü, desen örgüsü ya da jakar desen dosyası">
          <Controller
            control={form.control}
            name="weaveDesignId"
            render={({ field }) => (
              <EntityPickerModal<WeaveDesignRef>
                value={field.value || null}
                onChange={(id) => field.onChange(id ?? "")}
                service={weaveDesignPickerService}
                queryKey="weave-designs-item"
                getLabel={(r) => r.name}
                getSubLabel={(r) => `${r.code} · ${weaveClassLabel(r)}`}
                icon={Grid3x3}
                nullable
                noneLabel="Desen kartı yok"
                title="Desen kartı seç"
                placeholder="Desen kartı seç"
                recordForm={weaveForm}
              />
            )}
          />
        </FormField>
        {canWrite && (
          <Button type="button" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 h-4 w-4" />Yeni desen kartı
          </Button>
        )}
      </div>
      {designId && d && cls && (
        <div className="rounded-md border bg-muted/20 p-4 text-sm" data-testid="weave-summary">
          <p className="font-medium">{d.name} <span className="font-mono text-xs text-muted-foreground">{d.code}</span></p>
          <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Mekanizma</dt><dd>{SHED_MECHANISM_LABEL[cls.shedMechanism]}</dd>
            <dt className="text-muted-foreground">Örgü</dt><dd>{cls.weaveStructure ? WEAVE_STRUCTURE_LABEL[cls.weaveStructure] : "Belirtilmedi"}</dd>
            {mechanismDetail(d).length > 0 && (<><dt className="text-muted-foreground">Ayrıntı</dt><dd>{mechanismDetail(d).join(" · ")}</dd></>)}
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            {canWrite && (
              <Button type="button" size="sm" variant="outline" onClick={() => setCopying(true)}>
                <Copy className="mr-1.5 h-4 w-4" />Örnek al (yalnız bu kumaş)
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={() => openWeaveDesign(d.id)}>
              <SquareArrowOutUpRight className="mr-1.5 h-4 w-4" />Desen Kartları ekranında aç
            </Button>
          </div>
        </div>
      )}
      {copying && d && (
        <WeaveDesignCopyDialog
          source={d}
          onClose={() => setCopying(false)}
          onCreated={(id) => form.setValue("weaveDesignId", id, { shouldDirty: true })}
        />
      )}
      {creating && (
        <WeaveDesignCreateDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => form.setValue("weaveDesignId", id, { shouldDirty: true })}
        />
      )}
    </div>
  );
}
