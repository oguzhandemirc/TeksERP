import { CrudPage } from "@/components/layout/CrudPage";
import { customerColumns } from "./columns";
import { customerService } from "./service";
import { CustomerFormDialog } from "./CustomerFormDialog";
import type { Customer } from "./types";
import type { CustomerFormValues } from "./schema";

const buildPayload = (v: CustomerFormValues, initial: Customer | null): Partial<Customer> => ({
  // Kod backend'de üretilir (MUS+GGAAYY+NNNN); yeni kayıtta gönderilmez, düzenlemede korunur.
  ...(initial ? { code: initial.code } : {}),
  name: v.name,
  taxNumber: v.taxNumber || null,
  type: v.type,
  isActive: v.isActive,
});

export function CustomersPage() {
  return (
    <CrudPage<Customer>
      title="Müşteriler"
      description="Müşteri ve tedarikçi firmalar."
      entityName="Müşteri"
      queryKey="customers"
      service={customerService}
      columns={customerColumns}
      writePermission="customer:write"
      glowWhenEmpty
      keepFormOpenAfterSave
      searchPlaceholder="Kod, ad veya vergi no ara..."
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <CustomerFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(values) => onSubmit(buildPayload(values, initial))}
        />
      )}
    />
  );
}
