import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { Controller } from "react-hook-form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  branchFormDefaults,
  branchFormSchema,
  exportCodeVisible,
  type BranchFormValues,
} from "./branch-schema";
import type { CustomerBranch } from "./branch-types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: CustomerBranch | null;
  onSubmit: (values: BranchFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
  /** Carinin yönü — şube yönü boşken ihracat kodu görünürlüğü buna düşer. */
  customerDestination?: "DOMESTIC" | "EXPORT" | null;
}

export function BranchFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting, customerDestination = null }: Props) {
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
        defaultDestination: initial.defaultDestination ?? null,
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
            {/* Şube ihracat kodu — yalnız yön yurtdışıyken görünür (şubenin, boşsa carinin);
                gizlenen dolu değer silinmez. Belgede şirket kodunun önüne geçer. */}
            {exportCodeVisible(form.watch("defaultDestination"), customerDestination) && (
              <FormField label="İhracat Kodu" htmlFor="code" error={form.formState.errors.code}>
                <Input id="code" placeholder="Opsiyonel" {...form.register("code")} />
              </FormField>
            )}
          </div>

          {/* Şubenin sevk yönü — doluysa bu şubeye giden sevkiyatta carinin yönünün önüne geçer. */}
          <FormField label="Sevk yönü" error={form.formState.errors.defaultDestination}>
            <Controller
              control={form.control}
              name="defaultDestination"
              render={({ field }) => (
                <Select
                  value={field.value ?? "NONE"}
                  onValueChange={(v) => field.onChange(v === "NONE" ? null : (v as "DOMESTIC" | "EXPORT"))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Carinin yönü geçerli</SelectItem>
                    <SelectItem value="DOMESTIC">Yurtiçi</SelectItem>
                    <SelectItem value="EXPORT">Yurtdışı</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>

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
