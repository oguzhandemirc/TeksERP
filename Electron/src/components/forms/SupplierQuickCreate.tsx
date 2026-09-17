// =============================================================================
// TEDARİKÇİ SEÇİCİ — "Yeni cari" hızlı ekleme (kullanıcı isteği 2026-09-17): listede yoksa Tanımlar'a gitme
// =============================================================================
// `OrderFormDialog` emsali: `CustomerFormDialog` üst üste açılır (`showBranchDraft={false}`, kod backend'de
// üretilir, `customerCardPayload(v)` + `type` + `isActive:true`). FARK: tedarikçi kipinde tip varsayılanı
// SUPPLIER ve seçenekler yalnız Tedarikçi · Müşteri + Tedarikçi (müşteri-only kart tedarikçi listesine
// girmez — kullanıcı kararı 2026-09-17). Başarıda `onCreated({kind:"CUSTOMER", id})` — seçici seçer ve
// kapanır; `supplier-picker` ve cari listesi sorguları tazelenir. Hata: `customerService` tek-toast düzeni.
// Fason firma eklemek bu bileşende YOK (kullanıcı "cari" dedi).
// =============================================================================
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CustomerFormDialog } from "@/pages/Customers/CustomerFormDialog";
import { customerCardPayload, type CustomerFormValues } from "@/pages/Customers/schema";
import { customerService } from "@/pages/Customers/service";
import type { Customer } from "@/pages/Customers/types";
import type { CompanyType } from "@/types/enums";
import type { SupplierParty } from "./supplierParty";
import type { PickerMode } from "./supplierPicker";

/** Tedarikçi kipinde açılabilecek kart tipleri — "Müşteri" seçilemez. */
export const SUPPLIER_CREATE_TYPES: readonly CompanyType[] = ["SUPPLIER", "BOTH"];

interface Props {
  onCreated: (party: SupplierParty) => void;
  disabled?: boolean;
  /** Müşteri kipi: "Yeni müşteri", tip varsayılanı CUSTOMER (sipariş formu ①). */
  mode?: PickerMode;
}

export function SupplierQuickCreate({ onCreated, disabled, mode = "supplier" }: Props) {
  const label = mode === "customer" ? "Yeni müşteri" : "Yeni cari";
  const defaultType = mode === "customer" ? "CUSTOMER" : "SUPPLIER";
  const typeOptions = mode === "customer" ? undefined : SUPPLIER_CREATE_TYPES;
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const createMut = useMutation({
    mutationFn: (payload: Partial<Customer>) => customerService.create(payload),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["customers"] });
      void qc.invalidateQueries({ queryKey: ["supplier-picker"] });
      void qc.invalidateQueries({ queryKey: ["supplier-select"] });
      const created = res.data;
      setOpen(false);
      if (created?.id) {
        toast.success(`${mode === "customer" ? "Müşteri" : "Cari"} oluşturuldu: ${created.name}`);
        onCreated({ kind: "CUSTOMER", id: created.id });
      }
    },
  });
  return (
    <>
      <Button type="button" variant="outline" size="sm" aria-label={`${label} ekle`} title="Aradığınız kart listede yoksa burada açın" disabled={disabled} onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-4 w-4" /> {label}
      </Button>
      <CustomerFormDialog
        open={open}
        onOpenChange={setOpen}
        isSubmitting={createMut.isPending}
        showBranchDraft={false}
        defaultType={defaultType}
        typeOptions={typeOptions}
        onSubmit={(v: CustomerFormValues) => {
          createMut.mutate({
            // Kod backend'de üretilir (MUS+GGAAYY+NNNN) — istemciden gönderilmez.
            name: v.name,
            taxNumber: v.taxNumber || null,
            ...customerCardPayload(v),
            type: v.type,
            isActive: true,
          } as Partial<Customer>);
        }}
      />
    </>
  );
}
