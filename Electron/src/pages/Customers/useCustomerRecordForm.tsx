// Cari seçicisinin kayıt formu: Örnek al (YENİ kart) + Düzenle → cari kart ekranı (cari ortak kayıttır).
// Yeni = seçicideki "Yeni cari" düğmesi (SupplierQuickCreate) — aynı gövde `quickCreateCustomerPayload`.
import { Suspense, lazy, useMemo } from "react";
import type { RecordFormSpec } from "@/components/forms/record-form/types";
// Tembel: cari formu ağır; ortak seçici (SupplierPickerModal) onu statik import zincirine sokmasın.
const CustomerFormDialog = lazy(() => import("./CustomerFormDialog").then((m) => ({ default: m.CustomerFormDialog })));
import { customerCardPayload, type CustomerFormValues } from "./schema";
import { customerService } from "./service";
import type { Customer } from "./types";

/** Seçiciden açılan YENİ cari kartının gövdesi (kod backend'de üretilir — MUS+GGAAYY+NNNN). */
export function quickCreateCustomerPayload(v: CustomerFormValues): Partial<Customer> {
  return {
    name: v.name,
    taxNumber: v.taxNumber || null,
    ...customerCardPayload(v),
    isCustomerRole: v.isCustomerRole,
    isSupplierRole: v.isSupplierRole,
    // "Fason iş yapar" işaretliyse kart + profil tek işlemde (sunucu `subcontractorRole`).
    ...(v.isSubcontractorRole ? { subcontractorRole: true } : {}),
    isActive: true,
  } as Partial<Customer>;
}

/** `R`: seçici satırı (SupplierPickerRow özeti ya da Customer) — örnek almadan önce tam kart çekilir. */
export function useCustomerRecordForm<R extends { id: string } = Customer>(requiredRole?: "isCustomerRole" | "isSupplierRole"): RecordFormSpec<Customer, R> {
  return useMemo<RecordFormSpec<Customer, R>>(() => ({
    entityName: "Cari",
    service: customerService,
    writePermission: "customer:write",
    invalidateKeys: ["customers", "supplier-picker", "supplier-select"],
    templateRule: { clear: ["code", "taxNumber", "exportCode"], suggestCopy: ["name"] },
    loadFull: async (row) => (await customerService.getById(row.id)).data,
    cardPath: (c) => `/definitions/cariler/${c.id}`,
    renderForm: ({ open, onOpenChange, draft, onSubmit, isSubmitting }) => open && (
      <Suspense fallback={null}><CustomerFormDialog
        open={open}
        onOpenChange={onOpenChange}
        draft={draft as Customer | null}
        isSubmitting={isSubmitting}
        showBranchDraft={false}
        requiredRole={requiredRole}
        onSubmit={(v) => onSubmit(quickCreateCustomerPayload(v))}
      /></Suspense>
    ),
  }), [requiredRole]);
}
