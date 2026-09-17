import { CrudPage } from "@/components/layout/CrudPage";
import { customerColumns } from "./columns";
import { customerService } from "./service";
import { CustomerFormDialog } from "./CustomerFormDialog";
import type { Customer } from "./types";
import { branchDraftHasContent, customerCardPayload, type CustomerFormValues } from "./schema";

/** Tek-adım oluşturmada backend'e gönderilen satır-içi şube gövdesi. */
interface BranchCreatePayload {
  name: string;
  city: string | null;
  district: string | null;
  contactName: string | null;
  contactPhone: string | null;
  code: string | null;
  address: string | null;
  notes: string | null;
}

type CustomerWritePayload = Partial<Customer> & { branches?: BranchCreatePayload[] };

export const buildCustomerPayload = (v: CustomerFormValues, initial: Customer | null): CustomerWritePayload => {
  // Şubeler yalnız OLUŞTURMADA gönderilir (müşteri + şubeler tek transaction'da doğar);
  // düzenlemede şubeler ayrı sekmeden yönetilir → payload'a eklenmez. Tamamen boş
  // taslak satırları (yanlışlıkla "Şube ekle") elenir — validasyon içerikli satırda
  // adı zaten zorunlu kıldığı için kalanların hepsinin adı doludur.
  const branchRows = initial ? [] : v.branches.filter(branchDraftHasContent);
  return {
    // Kod backend'de üretilir (MUS+GGAAYY+NNNN); yeni kayıtta gönderilmez, düzenlemede korunur.
    ...(initial ? { code: initial.code } : {}),
    name: v.name,
    taxNumber: v.taxNumber || null,
    ...customerCardPayload(v),
    // Rol modeli: `type` gönderilmez (sunucu türetir); fason rolü profil bağından — gövdede yok.
    isCustomerRole: v.isCustomerRole,
    isSupplierRole: v.isSupplierRole,
    isActive: v.isActive,
    ...(branchRows.length > 0
      ? {
          branches: branchRows.map((b) => ({
            name: b.name.trim(),
            city: b.city?.trim() || null,
            district: b.district?.trim() || null,
            contactName: b.contactName?.trim() || null,
            contactPhone: b.contactPhone?.trim() || null,
            code: b.code?.trim() || null,
            address: b.address?.trim() || null,
            notes: b.notes?.trim() || null,
          })),
        }
      : {}),
  };
};

export function CustomersPage() {
  return (
    <CrudPage<Customer>
      title="Müşteriler"
      description="Müşteri ve tedarikçi firmalar."
      entityName="Cari"
      mergeEntity="customer"
      importEntity="customer"
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
          onSubmit={(values) => onSubmit(buildCustomerPayload(values, initial))}
        />
      )}
    />
  );
}
