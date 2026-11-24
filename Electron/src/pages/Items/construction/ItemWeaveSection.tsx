// Ürün penceresi > Desen (B19): desen kartını kısa listeden seç ya da aynı pencereden yeni desen kartı aç (kod · ad · örgü türü);
// armür planı ve tezgâh dosyası Desen Kartları ekranında doldurulur.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Controller, type UseFormReturn } from "react-hook-form";
import { Grid3x3, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/forms/FormField";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { WeaveDesignCreateDialog } from "@/pages/WeaveDesigns/WeaveDesignCreateDialog";
import { weaveDesignApi } from "@/pages/WeaveDesigns/service";
import { WEAVE_KIND_LABEL, type WeaveDesignKind } from "@/pages/WeaveDesigns/types";
import { weaveDesignPickerService, type WeaveDesignRef } from "../construction-service";
import type { ItemFormValues } from "../schema";

const kindLabel = (k: string) => WEAVE_KIND_LABEL[k as WeaveDesignKind] ?? k;

export function ItemWeaveSection({ form, canWrite }: { form: UseFormReturn<ItemFormValues>; canWrite: boolean }) {
  const [creating, setCreating] = useState(false);
  const designId = form.watch("weaveDesignId");
  const design = useQuery({ queryKey: ["weave-designs", "detail", designId], queryFn: () => weaveDesignApi.get(designId), enabled: !!designId });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <FormField label="Desen kartı" error={form.formState.errors.weaveDesignId} info="Örgü türü, armür planı ve tezgâh desen dosyası">
          <Controller
            control={form.control}
            name="weaveDesignId"
            render={({ field }) => (
              <EntityPickerModal<WeaveDesignRef>
                value={field.value || null}
                onChange={(id) => field.onChange(id ?? "")}
                service={weaveDesignPickerService}
                queryKey="weave-designs-item"
                getLabel={(d) => d.name}
                getSubLabel={(d) => `${d.code} · ${kindLabel(d.kind)}`}
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
      {designId && design.data && (
        <div className="rounded-md border bg-muted/20 p-4 text-sm" data-testid="weave-summary">
          <p className="font-medium">{design.data.name} <span className="font-mono text-xs text-muted-foreground">{design.data.code}</span></p>
          <p className="text-muted-foreground">
            {kindLabel(design.data.kind)}
            {design.data.frameCount ? ` · ${design.data.frameCount} çerçeve` : ""}
            {design.data.loomFileName ? ` · tezgâh dosyası ${design.data.loomFileName}` : ""}
          </p>
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
