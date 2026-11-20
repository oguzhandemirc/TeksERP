// Gövde formunun alan grupları — kısa alanlar ızgarada, uzun açıklama ⓘ balonunda.
import { Controller, type UseFormReturn } from "react-hook-form";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { FieldGrid } from "@/components/forms/WideFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { BeamBodyFormValues } from "./model";
import { BEAM_BODY_OWNER_KINDS, BEAM_BODY_OWNER_LABELS, type BeamBody, type BeamBodyOwnerKind } from "./types";
import { MachineFitPicker, SubcontractorPicker, WarehousePicker } from "./Pickers";

type F = UseFormReturn<BeamBodyFormValues>;

function Segmented<T extends string>({ value, options, onChange, disabled, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; disabled?: boolean; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn("rounded-md px-3 py-1.5 text-sm transition-colors disabled:opacity-50", value === o.value ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function IdentityFields({ form, editing }: { form: F; editing: boolean }) {
  const e = form.formState.errors;
  return (
    <FieldGrid cols={3}>
      <FormField label="Gövde no" htmlFor="bb-no" error={e.bodyNo} info="Boş bırakılırsa numara serisinden verilir (ör. LG-00001). Gövdenin üstünde kazılı/boyalı bir numara varsa onu yazın. Numara QR etikete basılır; kayıttan sonra değişmez.">
        <Input id="bb-no" className="font-mono" placeholder={editing ? undefined : "Boş = seriden"} disabled={editing} maxLength={32} {...form.register("bodyNo")} />
      </FormField>
      <FormField label="Gövde eni (cm)" htmlFor="bb-width" error={e.widthCm}>
        <Input id="bb-width" inputMode="decimal" {...form.register("widthCm")} />
      </FormField>
      <FormField label="Flanş çapı (cm)" htmlFor="bb-flange" error={e.flangeDiameterCm}>
        <Input id="bb-flange" inputMode="decimal" {...form.register("flangeDiameterCm")} />
      </FormField>
      <FormField label="Dara (kg)" htmlFor="bb-tare" error={e.tareKg} info="Boş gövdenin ağırlığı. Dolu levent tartılınca iplik kilosu bu dara düşülerek bulunur.">
        <Input id="bb-tare" inputMode="decimal" {...form.register("tareKg")} />
      </FormField>
    </FieldGrid>
  );
}

export function OwnerFields({ form, initial }: { form: F; initial: BeamBody | null }) {
  const kind = form.watch("ownerKind");
  const e = form.formState.errors;
  // Sahip yalnız gövde depoda boşken değişir (sunucu 409 BEAM_BODY_BUSY); burada kilitli gösterilir.
  const locked = Boolean(initial && (initial.status !== "EMPTY_STOCK" || !initial.isActive));
  const setKind = (k: BeamBodyOwnerKind) => {
    form.setValue("ownerKind", k, { shouldDirty: true });
    form.setValue("ownerSubcontractorId", null, { shouldDirty: true });
    if (k === "OURS") form.setValue("ownerCustomerId", null, { shouldDirty: true });
  };
  return (
    <div className="space-y-4">
      <FormField label="Gövde kimin" info="Deverecinin, müşterinin ya da başka bir firmanın gövdesi de aynı akışla izlenir; bizim olmayan gövde boşalınca “Sahibine iade edilecek” listesine düşer.">
        <Segmented label="Gövde sahibi" value={kind} disabled={locked} onChange={setKind} options={BEAM_BODY_OWNER_KINDS.map((k) => ({ value: k, label: BEAM_BODY_OWNER_LABELS[k] }))} />
      </FormField>
      {locked && <p className="text-xs text-muted-foreground">Sahip yalnız gövde depoda boşken değiştirilebilir (şu an “{initial?.statusLabel}”).</p>}
      {kind === "WARPER" && (
        <FieldGrid cols={2}>
          <FormField label="Devereci" htmlFor="bb-owner-sub" error={e.ownerSubcontractorId} required info="Fason profilinin bağlı olduğu cari gövdenin sahibi olur. Bağlı cari yoksa fason profilini bir cariye bağlayın.">
            <Controller control={form.control} name="ownerSubcontractorId" render={({ field }) => <SubcontractorPicker id="bb-owner-sub" value={field.value} onChange={field.onChange} title="Gövdenin sahibi devereci" />} />
          </FormField>
          {initial?.owner.kind === "WARPER" && initial.owner.customer && !form.watch("ownerSubcontractorId") && (
            <FormField label="Şu anki sahip">
              <p className="pt-2 text-sm">{initial.owner.customer.name}</p>
            </FormField>
          )}
        </FieldGrid>
      )}
      {(kind === "CUSTOMER" || kind === "OTHER") && (
        <FieldGrid cols={2}>
          <FormField label={kind === "CUSTOMER" ? "Müşteri" : "Firma"} error={e.ownerCustomerId} required>
            <Controller control={form.control} name="ownerCustomerId" render={({ field }) => <CustomerPickerField variant="cari" value={field.value} onChange={field.onChange} disabled={locked} />} />
          </FormField>
        </FieldGrid>
      )}
    </div>
  );
}

export function PlaceFields({ form }: { form: F }) {
  const status = form.watch("initialStatus");
  const e = form.formState.errors;
  return (
    <div className="space-y-4">
      <FormField label="Gövde şu an nerede">
        <Segmented
          label="Kayıt yeri"
          value={status}
          onChange={(v) => form.setValue("initialStatus", v, { shouldDirty: true })}
          options={[
            { value: "EMPTY_STOCK", label: "Depoda boş" },
            { value: "AT_SUBCONTRACTOR", label: "Deverecide" },
          ]}
        />
      </FormField>
      <FieldGrid cols={2}>
        {status === "EMPTY_STOCK" ? (
          <FormField label="Depo" htmlFor="bb-wh">
            <Controller control={form.control} name="warehouseId" render={({ field }) => <WarehousePicker id="bb-wh" value={field.value} onChange={field.onChange} />} />
          </FormField>
        ) : (
          <FormField label="Devereci" htmlFor="bb-sub" error={e.subcontractorId} required>
            <Controller control={form.control} name="subcontractorId" render={({ field }) => <SubcontractorPicker id="bb-sub" value={field.value} onChange={field.onChange} />} />
          </FormField>
        )}
      </FieldGrid>
    </div>
  );
}

export function MachineFitField({ form, initial }: { form: F; initial: BeamBody | null }) {
  const labels = Object.fromEntries((initial?.machineFits ?? []).map((m) => [m.id, m.code]));
  return (
    <FormField label="Uyumlu tezgâhlar" error={form.formState.errors.machineIds} info="Gövde, eni ve flanşı uyan tezgâhlara takılır. Uymayan tezgâha takılınca ayara göre uyarı verilir ya da engellenir (Ayarlar › Devere).">
      <Controller control={form.control} name="machineIds" render={({ field }) => <MachineFitPicker value={field.value} onChange={field.onChange} initialLabels={labels} />} />
    </FormField>
  );
}

export function NotesField({ form }: { form: F }) {
  return (
    <FormField label="Not" htmlFor="bb-notes" error={form.formState.errors.notes}>
      <Textarea id="bb-notes" rows={4} maxLength={500} {...form.register("notes")} />
    </FormField>
  );
}
