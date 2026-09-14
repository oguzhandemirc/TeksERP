// =============================================================================
// LEVENT PLANLA / PLANI DÜZENLE — köken AKSİYON ANINDA seçilir (varsayılan içeride, KİLİTLİ DEĞİL)
// =============================================================================
import { useRef } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { Layers, Handshake, Building2 } from "lucide-react";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { warpSpecService } from "@/pages/WarpSpecs/service";
import type { WarpSpec } from "@/pages/WarpSpecs/types";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { customerService } from "@/pages/Customers/service";
import type { Customer } from "@/pages/Customers/types";
import { warpBeamPlanDefaults, warpBeamPlanSchema, type WarpBeamPlanValues } from "./schema";
import { WARP_BEAM_ORIGIN_LABEL, type WarpBeam, type WarpBeamOrigin } from "./types";

type Form = UseFormReturn<WarpBeamPlanValues>;

function buildDefaults(initial?: WarpBeam | null): WarpBeamPlanValues {
  if (!initial) return warpBeamPlanDefaults;
  return {
    warpSpecId: initial.warpSpecId,
    plannedLengthM: String(initial.plannedLengthM),
    originKind: initial.originKind,
    subcontractorId: initial.subcontractorId ?? "",
    supplierId: initial.supplierId ?? "",
    physicalBeamNo: initial.physicalBeamNo ?? "",
    notes: initial.notes ?? "",
  };
}

function OriginFields({ form }: { form: Form }) {
  const err = form.formState.errors;
  const origin = form.watch("originKind");
  return (
    <>
      <FormField label="Köken" error={err.originKind} required hint="Her leventte seçilir: aynı fabrika hem içeride sarar hem hazır levent alır.">
        <Controller
          control={form.control}
          name="originKind"
          render={({ field }) => (
            <Select value={field.value} onValueChange={(v) => field.onChange(v as WarpBeamOrigin)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(WARP_BEAM_ORIGIN_LABEL) as WarpBeamOrigin[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {WARP_BEAM_ORIGIN_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>
      {origin !== "IN_HOUSE" && (
        <FormField label="Fasoncu" error={err.subcontractorId} hint={origin === "PURCHASED" ? "Kendi ipliğiyle sarıp faturalayan devereci — YA tedarikçi YA fasoncu." : undefined}>
          <Controller
            control={form.control}
            name="subcontractorId"
            render={({ field }) => (
              <EntityPickerModal<Subcontractor> value={field.value || null} onChange={(id) => field.onChange(id ?? "")} service={subcontractorService} queryKey="subcontractors-warp-beam" getLabel={(s) => s.name} icon={Handshake} title="Fasoncu seç" placeholder="Fasoncu seç" nullable />
            )}
          />
        </FormField>
      )}
      {origin === "PURCHASED" && (
        <FormField label="Tedarikçi (cari)" error={err.supplierId}>
          <Controller
            control={form.control}
            name="supplierId"
            render={({ field }) => (
              <EntityPickerModal<Customer> value={field.value || null} onChange={(id) => field.onChange(id ?? "")} service={customerService} queryKey="customers-warp-beam-supplier" getLabel={(c) => c.name} icon={Building2} title="Tedarikçi seç" placeholder="Tedarikçi seç" nullable />
            )}
          />
        </FormField>
      )}
    </>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: WarpBeam | null;
  onSubmit: (values: WarpBeamPlanValues, clientToken: string) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function WarpBeamFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  const tokenRef = useRef(crypto.randomUUID());
  return (
    <EntityFormDialog<WarpBeamPlanValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? `${initial.beamNo} — Planı düzenle` : "Yeni Levent (plan)"}
      description="Hangi çözgü kartından, kaç metre, nereden. Numara sunucuda üretilir (LV+GGAAYY+NNNN); sarım ayrı adımdır."
      schema={warpBeamPlanSchema}
      defaultValues={buildDefaults(initial)}
      onSubmit={(v) => onSubmit(v, tokenRef.current)}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <>
          <FormField label="Çözgü kartı" error={form.formState.errors.warpSpecId} required>
            <Controller
              control={form.control}
              name="warpSpecId"
              render={({ field }) => (
                <EntityPickerModal<WarpSpec> value={field.value || null} onChange={(id) => field.onChange(id ?? "")} service={warpSpecService} queryKey="warp-specs-beam" getLabel={(s) => s.name} getSubLabel={(s) => `${s.code} · ${s.endsCount} tel`} icon={Layers} title="Çözgü kartı seç" placeholder="Çözgü kartı seç" />
              )}
            />
          </FormField>
          <FormField label="Plan metresi" error={form.formState.errors.plannedLengthM} required>
            <Input type="number" min={1} step="0.001" {...form.register("plannedLengthM")} />
          </FormField>
          <OriginFields form={form} />
          <FormField label="Metal gövde no" error={form.formState.errors.physicalBeamNo} hint="Numarasız fabrikada boş kalır; aynı gövdede iki canlı çözgü olmaz.">
            <Input {...form.register("physicalBeamNo")} />
          </FormField>
          <FormField label="Not" error={form.formState.errors.notes}>
            <Textarea rows={2} {...form.register("notes")} />
          </FormField>
        </>
      )}
    </EntityFormDialog>
  );
}
