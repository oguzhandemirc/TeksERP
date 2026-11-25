// Özel dokuma iş emri şablonu — oluştur / düzenle. Her alan opsiyonel (ad hariç): boş bırakılan alan dokuma
// iş emri formunda varsayılanıyla açılır. Kumaş/fasoncu seçicileri doğrudan modal (EntityPickerModal).
import { Controller, type UseFormReturn } from "react-hook-form";
import { Handshake, Package } from "lucide-react";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { FieldGrid } from "@/components/forms/WideFormDialog";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { SubcontractorCategoryPicker } from "@/components/forms/SubcontractorCategoryPicker";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DOKUMA_CATEGORY_CODE } from "@/lib/subcontractor-category-codes";
import { TERIM } from "@/lib/terim";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import { WEAVING_KIND_LABEL } from "../types";
import { templateFormSchema, templateToFormValues, type TemplateFormValues } from "./preset";
import type { WeavingOrderTemplate } from "./types";
import { useItemRecordForm } from "@/pages/Items/useItemRecordForm";

type Form = UseFormReturn<TemplateFormValues>;
/** Radix Select boş değer taşımaz — "formda seçilir" seçeneğinin iç adı. */
const ANY = "__ANY__";

interface Props {
  initial: WeavingOrderTemplate | null;
  onClose: () => void;
  onSubmit: (values: TemplateFormValues) => Promise<unknown>;
  isSubmitting?: boolean;
}

export function WeavingTemplateFormDialog({ initial, onClose, onSubmit, isSubmitting }: Props) {
  return (
    <EntityFormDialog<TemplateFormValues>
      open
      onOpenChange={(o) => !o && onClose()}
      title={initial ? `${initial.name} — Düzenle` : `Yeni özel ${TERIM.dokumaIsEmri.tekilKucuk}`}
      schema={templateFormSchema}
      defaultValues={templateToFormValues(initial)}
      onSubmit={(v) => onSubmit(v).then(() => undefined, () => undefined)}
      isSubmitting={isSubmitting}
      size="medium"
    >
      {(form) => (
        <FieldGrid cols={2}>
          <NameFields form={form} />
          <FabricField form={form} />
          <PartyField form={form} />
          <FormField label="Hedef metre" htmlFor="tpl-plannedM" error={form.formState.errors.plannedM} info="Boş = formda girilir ya da açık uçlu iş.">
            <Input id="tpl-plannedM" {...form.register("plannedM")} inputMode="decimal" placeholder="1200" />
          </FormField>
          <FormField label="Not" htmlFor="tpl-notes" error={form.formState.errors.notes} className="col-span-full">
            <Textarea id="tpl-notes" {...form.register("notes")} rows={2} placeholder="Tahar, sıklık, özel istek…" />
          </FormField>
        </FieldGrid>
      )}
    </EntityFormDialog>
  );
}

function NameFields({ form }: { form: Form }) {
  const err = form.formState.errors;
  return (
    <>
      <FormField label="Şablon adı" htmlFor="tpl-name" error={err.name} required info="Seçicide karo başlığı olarak çıkar (ör. Fason dokuma — Ayhan).">
        <Input id="tpl-name" {...form.register("name")} placeholder="Fason dokuma" />
      </FormField>
      <FormField label="Sıra" htmlFor="tpl-sort" error={err.sortOrder} info="Küçük önce; eşitlikte ada göre.">
        <Input id="tpl-sort" {...form.register("sortOrder")} inputMode="numeric" placeholder="0" />
      </FormField>
      <FormField label="Açıklama" htmlFor="tpl-desc" error={err.description} className="col-span-full" info="Karo alt satırında, alan özeti boşsa görünür.">
        <Input id="tpl-desc" {...form.register("description")} />
      </FormField>
    </>
  );
}

function FabricField({ form }: { form: Form }) {
  const itemForm = useItemRecordForm();
  return (
    <FormField label="Kumaş" error={form.formState.errors.itemId} info="Boş = formda seçilir.">
      <Controller
        control={form.control}
        name="itemId"
        render={({ field }) => (
          <EntityPickerModal<Item>
            value={field.value || null}
            onChange={(id) => field.onChange(id ?? "")}
            service={itemService} recordForm={itemForm}
            queryKey="items-weaving-template"
            filters={{ itemType: "FABRIC" }}
            getLabel={(i) => i.name}
            getSubLabel={(i) => i.code}
            icon={Package}
            nullable
            noneLabel="Formda seçilir"
            title="Şablon kumaşını seç"
            placeholder="Formda seçilir"
          />
        )}
      />
    </FormField>
  );
}

function PartyField({ form }: { form: Form }) {
  const err = form.formState.errors;
  const kind = form.watch("executionKind");
  return (
    <>
      <FormField label="Kim dokuyor" error={err.executionKind}>
        <Controller
          control={form.control}
          name="executionKind"
          render={({ field }) => (
            <Select value={field.value || ANY} onValueChange={(v) => field.onChange(v === ANY ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Formda seçilir</SelectItem>
                {Object.entries(WEAVING_KIND_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>
      {kind === "SUBCONTRACTED" && (
        <FormField label="Fasoncu" error={err.subcontractorId} info="Boş = formda seçilir.">
          <Controller
            control={form.control}
            name="subcontractorId"
            render={({ field }) => (
              <SubcontractorCategoryPicker
                value={field.value || null}
                onChange={(id) => field.onChange(id ?? "")}
                categoryCode={DOKUMA_CATEGORY_CODE}
                queryKey="subcontractors-weaving-template"
                getLabel={(s) => s.name}
                getSubLabel={(s) => s.code}
                icon={Handshake}
                title="Dokuyan fasoncuyu seç"
                placeholder="Formda seçilir"
              />
            )}
          />
        </FormField>
      )}
    </>
  );
}
