import { CrudPage } from "@/components/layout/CrudPage";
import { financeSubBody, type FinanceSubBody } from "./customerFinance";
import { useCustomerFinanceAccess } from "./CustomerFinanceSection";
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
  defaultDestination: "DOMESTIC" | "EXPORT" | null;
}

type CustomerWritePayload = Partial<Omit<Customer, "finance">> & { branches?: BranchCreatePayload[]; subcontractorRole?: true; finance?: FinanceSubBody };

export const buildCustomerPayload = (v: CustomerFormValues, initial: Customer | null, finance: { canWrite: boolean; enabled: boolean } = { canWrite: false, enabled: false }): CustomerWritePayload => {
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
    // Rol modeli: `type` gönderilmez (sunucu türetir). Fason rolü bayrağı gövdede YOK (profil bağı türetir);
    // YENİ kartta "Fason iş yapar" → `subcontractorRole:true` (sunucu kart + profili tek tx'te doğurur).
    isCustomerRole: v.isCustomerRole,
    isSupplierRole: v.isSupplierRole,
    ...(!initial && v.isSubcontractorRole ? { subcontractorRole: true } : {}),
    isActive: v.isActive,
    // Z-B: terimler HESAPTA — `finance{…}` alt nesnesi yalnız finance:write + modül açıkken (yoksa alt nesne yok, sunucu 403 vermez).
    ...financeSubBody(v, finance),
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
            defaultDestination: b.defaultDestination ?? null,
          })),
        }
      : {}),
  };
};

export function CustomersPage() {
  const financeAccess = useCustomerFinanceAccess();
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
          // Yazma gövdesi (finance alt nesnesi) okuma DTO'su değildir — CrudPage yalnız Partial<Customer> tanır.
          onSubmit={(values) => onSubmit(buildCustomerPayload(values, initial, financeAccess) as Partial<Customer>)}
        />
      )}
    />
  );
}
