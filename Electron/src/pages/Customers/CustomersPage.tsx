import { CrudPage } from "@/components/layout/CrudPage";
import { generateCode, CODE_PREFIXES } from "@/lib/code-generator";
import { customerColumns } from "./columns";
import { customerService } from "./service";
import { CustomerFormDialog } from "./CustomerFormDialog";
import type { Customer } from "./types";
import type { CustomerFormValues } from "./schema";

const buildPayload = (v: CustomerFormValues, initial: Customer | null): Partial<Customer> => ({
  code: initial?.code ?? generateCode(CODE_PREFIXES.CUSTOMER),
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
