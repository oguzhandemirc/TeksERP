// Ürün penceresi > Desen (B19): desen kartını kısa listeden seç ya da aynı pencereden yeni desen kartı aç (kod · ad ·
// mekanizma · örgü); armür ızgarası / jakar bilgileri Desen Kartları ekranında doldurulur.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Controller, type UseFormReturn } from "react-hook-form";
import { Grid3x3, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/forms/FormField";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { WeaveDesignCreateDialog } from "@/pages/WeaveDesigns/WeaveDesignCreateDialog";
import { weaveDesignApi } from "@/pages/WeaveDesigns/service";
import type { WeaveDesign } from "@/pages/WeaveDesigns/types";
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
      d.repeatWidthCm && d.repeatCm ? `rapor ${d.repeatWidthCm} × ${d.repeatCm} cm` : null,
      d.loomFileName ? `desen dosyası ${d.loomFileName}` : null,
    ].filter((x): x is string => !!x);
  }
  return [];
}

export function ItemWeaveSection({ form, canWrite }: { form: UseFormReturn<ItemFormValues>; canWrite: boolean }) {
  const [creating, setCreating] = useState(false);
  const designId = form.watch("weaveDesignId");
  const design = useQuery({ queryKey: ["weave-designs", "detail", designId], queryFn: () => weaveDesignApi.get(designId), enabled: !!designId });
  const d = design.data;
  const cls = d ? resolveWeaveClass(d) : null;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <FormField label="Desen kartı" error={form.formState.errors.weaveDesignId} info="Mekanizma (Eksantrik · Armür · Jakar), örgü, armür ızgarası ya da jakar desen dosyası">
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
                quickAddLabel={canWrite ? "Yeni desen kartı" : undefined}
                onQuickAdd={canWrite ? () => setCreating(true) : undefined}
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
        </div>
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
