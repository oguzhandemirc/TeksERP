// Hizmet kartı Yeni/Düzenle. "Süreçler" (B16) form değeri DEĞİL: kart kaydından sonra aynı küme ucuyla
// (`PUT /:id/processes`) yazılır — yeni kartta id kayıttan doğar. `processIds: null` = süreçlere dokunulmadı.
// Geniş form (B18/11): kısa alanlar tek satırda, açıklamalar ⓘ balonunda, kod başlık altında rozet.
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { InfoPopover } from "@/components/ui/info-popover";
import { SimilarNamesWarning } from "@/components/forms/SimilarNamesWarning";
import { ITEM_UNIT_CODES, ITEM_UNIT_LABEL } from "@/lib/item-unit";
import type { ServiceItem } from "./types";
import { serviceFormDefaults, serviceFormSchema, type ServiceFormValues } from "./schema";
import { ServiceProcessPicker, useServiceProcessSelection } from "./ServiceProcessPicker";
import { SERVICE_PROCESS_HELP } from "./ServiceProcessesDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: ServiceItem | null;
  /** Örnek al taslağı (kimliksiz) — yeni kart bu değerlerle dolu açılır. */
  draft?: Partial<ServiceItem> | null;
  onSubmit: (values: ServiceFormValues, processIds: string[] | null) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function ServiceFormDialog({ open, onOpenChange, initial, draft, onSubmit, isSubmitting }: Props) {
  const sel = useServiceProcessSelection(initial?.id ?? null, open);
  const src = initial ?? draft;
  const defaults: ServiceFormValues = src
    ? {
        code: src.code ?? "",
        name: src.name ?? "",
        unit: (ITEM_UNIT_CODES as readonly string[]).includes(src.unit ?? "") ? (src.unit as string) : "MT",
      }
    : serviceFormDefaults;

  return (
    <EntityFormDialog<ServiceFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Hizmet Kartını Düzenle" : draft ? "Yeni Hizmet Kartı (örnekten)" : "Yeni Hizmet Kartı"}
      description="Faturalanan hizmet (kurşun, boya, devere…). Süreç eşlemesi isteğe bağlıdır."
      size="medium"
      schema={serviceFormSchema}
      defaultValues={defaults}
      // Harita yüklenmeden kaydedilirse küme bilinmez → süreçlere dokunulmaz (yanlışlıkla boşaltma yok).
      onSubmit={(v) => onSubmit(v, !sel.loading && sel.changed ? sel.ids : null)}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <>
          {initial && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Kod:
              <span className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-foreground">{initial.code}</span>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {!initial && (
              <FormField label="Kod" htmlFor="code" error={form.formState.errors.code} info="Boş bırakılırsa sistem verir.">
                <Input id="code" placeholder="ör. KURSUN" {...form.register("code")} />
              </FormField>
            )}
            <FormField label="Ad" htmlFor="name" error={form.formState.errors.name} required className={initial ? "sm:col-span-2" : undefined}>
              <Input id="name" autoFocus placeholder="ör. Kurşun dikimi, tambur, brode" {...form.register("name")} />
              <SimilarNamesWarning entity="service-items" name={form.watch("name") ?? ""} excludeId={initial?.id} />
            </FormField>
            <FormField label="Birim" htmlFor="unit" error={form.formState.errors.unit} info="Fatura satırındaki miktar birimi.">
              <select id="unit" className="h-9 w-full rounded-md border bg-background px-2 text-sm" {...form.register("unit")}>
                {ITEM_UNIT_CODES.map((u) => (
                  <option key={u} value={u}>
                    {ITEM_UNIT_LABEL[u]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              Süreçler
              <InfoPopover label="Süreçler hakkında" desc={SERVICE_PROCESS_HELP} side="top" />
              <span className="ml-auto text-xs font-normal text-muted-foreground">isteğe bağlı · başka karta eşli tür seçilemez</span>
            </div>
            <ServiceProcessPicker
              className="grid max-h-64 grid-cols-1 gap-2 space-y-0 sm:grid-cols-2"
              options={sel.options}
              selected={sel.selected}
              onToggle={sel.toggle}
              loading={sel.loading}
              cardActive={initial ? initial.isActive !== false : true}
            />
          </div>
        </>
      )}
    </EntityFormDialog>
  );
}
