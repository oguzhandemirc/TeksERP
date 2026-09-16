// =============================================================================
// DOKUMA İŞİ FORMU — alan grupları (diyalog gövdesi 80 satır tavanına sığsın diye)
// =============================================================================
// ⚠️ Çözgü kartı seçici yalnız DEVERE modülü açıkken çizilir: `/api/warp-specs`
// `requireDevereEnabled` arkasındadır, kapalı kurulumda seçici 403 yerdi.
// =============================================================================
import { Controller, type UseFormReturn } from "react-hook-form";
import { Package, Palette, Handshake, Ruler } from "lucide-react";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import { colorService } from "@/pages/Colors/service";
import type { Color } from "@/pages/Colors/types";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { warpSpecService } from "@/pages/WarpSpecs/service";
import type { WarpSpec } from "@/pages/WarpSpecs/types";
import type { WeavingOrderFormValues } from "./schema";
import { WEAVING_KIND_LABEL } from "./types";
import { DatePickerInput } from "@/components/forms/DatePickerInput";

type Form = UseFormReturn<WeavingOrderFormValues>;

/** Kumaş · renk · (devere açıksa) çözgü kartı. */
export function FabricFields({ form, devereEnabled }: { form: Form; devereEnabled: boolean }) {
  const err = form.formState.errors;
  return (
    <>
      <FormField label="Kumaş" error={err.itemId} required>
        <Controller
          control={form.control}
          name="itemId"
          render={({ field }) => (
            <EntityPickerModal<Item>
              value={field.value || null}
              onChange={(id) => field.onChange(id ?? "")}
              service={itemService}
              queryKey="items-weaving-fabric"
              filters={{ itemType: "FABRIC" }}
              getLabel={(i) => i.name}
              getSubLabel={(i) => i.code}
              icon={Package}
              title="Dokunacak kumaşı seç"
              placeholder="Kumaş seç"
            />
          )}
        />
      </FormField>
      <FormField label="Renk" error={err.colorId} hint="Ham dokumada boş bırakılır; renk sonraki adımlarda gelir.">
        <Controller
          control={form.control}
          name="colorId"
          render={({ field }) => (
            <EntityPickerModal<Color>
              value={field.value || null}
              onChange={(id) => field.onChange(id ?? "")}
              service={colorService}
              queryKey="colors-weaving"
              getLabel={(c) => c.name}
              getSubLabel={(c) => c.code}
              icon={Palette}
              nullable
              noneLabel="Renk yok (ham)"
              placeholder="Renk yok (ham)"
            />
          )}
        />
      </FormField>
      {devereEnabled && (
        <FormField label="Çözgü kartı" error={err.warpSpecId}>
          <Controller
            control={form.control}
            name="warpSpecId"
            render={({ field }) => (
              <EntityPickerModal<WarpSpec>
                value={field.value || null}
                onChange={(id) => field.onChange(id ?? "")}
                service={warpSpecService}
                queryKey="warp-specs-weaving"
                getLabel={(w) => w.name}
                getSubLabel={(w) => w.code}
                icon={Ruler}
                nullable
                noneLabel="Çözgü kartı yok"
                placeholder="Çözgü kartı seç"
              />
            )}
          />
        </FormField>
      )}
    </>
  );
}

/** Kim dokuyor (XOR: fasonda ⇔ fasoncu dolu — backend ikinci hat). */
export function PartyFields({ form }: { form: Form }) {
  const err = form.formState.errors;
  const kind = form.watch("executionKind");
  return (
    <>
      <FormField label="Kim dokuyor" error={err.executionKind} required>
        <Controller
          control={form.control}
          name="executionKind"
          render={({ field }) => (
            <Select value={field.value} onValueChange={(v) => field.onChange(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(WEAVING_KIND_LABEL).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>
      {kind === "SUBCONTRACTED" && (
        <FormField label="Fasoncu" error={err.subcontractorId} required>
          <Controller
            control={form.control}
            name="subcontractorId"
            render={({ field }) => (
              <EntityPickerModal<Subcontractor>
                value={field.value || null}
                onChange={(id) => field.onChange(id ?? "")}
                service={subcontractorService}
                queryKey="subcontractors-weaving"
                getLabel={(s) => s.name}
                getSubLabel={(s) => s.code}
                icon={Handshake}
                title="Dokuyan fasoncuyu seç"
                placeholder="Fasoncu seç"
              />
            )}
          />
        </FormField>
      )}
    </>
  );
}

/** Hedef metre · plan tarihleri · not. */
export function PlanFields({ form }: { form: Form }) {
  const err = form.formState.errors;
  return (
    <>
      <FormField
        label="Hedef metre"
        htmlFor="plannedM"
        error={err.plannedM}
        hint="Boş = açık uçlu iş (levent bitene kadar). Hedefe ulaşmak işi KAPATMAZ; kapanış açık bir karardır."
      >
        <Input id="plannedM" {...form.register("plannedM")} inputMode="decimal" placeholder="1200" />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Planlanan başlangıç" htmlFor="plannedStartDate" error={err.plannedStartDate}>
          <Controller control={form.control} name="plannedStartDate" render={({ field }) => <DatePickerInput id="plannedStartDate" value={field.value ?? ""} onChange={field.onChange} />} />
        </FormField>
        <FormField label="Planlanan bitiş" htmlFor="plannedEndDate" error={err.plannedEndDate}>
          <Controller control={form.control} name="plannedEndDate" render={({ field }) => <DatePickerInput id="plannedEndDate" value={field.value ?? ""} onChange={field.onChange} />} />
        </FormField>
      </div>
      <FormField label="Not" htmlFor="notes" error={err.notes}>
        <Textarea id="notes" {...form.register("notes")} rows={2} placeholder="Tahar, sıklık, özel istek…" />
      </FormField>
    </>
  );
}
