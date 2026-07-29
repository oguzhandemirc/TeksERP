import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import {
  branchFormDefaults,
  branchFormSchema,
  type BranchFormValues,
} from "./branch-schema";
import type { CustomerBranch } from "./branch-types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: CustomerBranch | null;
  onSubmit: (values: BranchFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function BranchFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  const isEdit = Boolean(initial);
  const defaults: BranchFormValues = initial
    ? {
        code: initial.code ?? "",
        name: initial.name,
        address: initial.address ?? "",
        city: initial.city ?? "",
        district: initial.district ?? "",
        contactName: initial.contactName ?? "",
        contactPhone: initial.contactPhone ?? "",
        notes: initial.notes ?? "",
        isActive: initial.isActive,
      }
    : branchFormDefaults;

  return (
    <EntityFormDialog<BranchFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Şubeyi Düzenle" : "Yeni Şube"}
      schema={branchFormSchema}
      defaultValues={defaults}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Şube Adı" htmlFor="name" error={form.formState.errors.name} required className="col-span-2">
              <Input id="name" autoFocus placeholder="Örn. Merkez Depo, Ankara Şubesi" {...form.register("name")} />
            </FormField>
            {/* Şube ihracat kodu — sevk belgesinde tek "İhracat Kodu" satırına, dolu
                ise şirket ihracat kodunun önüne geçerek basılır. */}
            <FormField label="İhracat Kodu" htmlFor="code" error={form.formState.errors.code}>
              <Input id="code" placeholder="Opsiyonel" {...form.register("code")} />
            </FormField>
          </div>

          <FormField label="Adres" htmlFor="address" error={form.formState.errors.address}>
            <textarea
              id="address"
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...form.register("address")}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Şehir" htmlFor="city" error={form.formState.errors.city}>
              <Input id="city" {...form.register("city")} />
            </FormField>
            <FormField label="İlçe" htmlFor="district" error={form.formState.errors.district}>
              <Input id="district" {...form.register("district")} />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="İletişim Kişisi" htmlFor="contactName" error={form.formState.errors.contactName}>
              <Input id="contactName" {...form.register("contactName")} />
            </FormField>
            <FormField
              label="Telefon"
              htmlFor="contactPhone"
              error={form.formState.errors.contactPhone}
              hint="İsteğe bağlı"
            >
              <Input
                id="contactPhone"
                inputMode="tel"
                maxLength={32}
                placeholder="0212 555 0000"
                {...form.register("contactPhone")}
              />
            </FormField>
          </div>

          <FormField label="Notlar" htmlFor="notes" error={form.formState.errors.notes}>
            <textarea
              id="notes"
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...form.register("notes")}
            />
          </FormField>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isActive")} /> Aktif
          </label>
        </>
      )}
    </EntityFormDialog>
  );
}
