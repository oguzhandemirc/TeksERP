// =============================================================================
// FASON FORMU — "Bağlı cari" alanı (fason = carinin rolü, 2026-09-17)
// =============================================================================
// Seçici yalnız SUPPLIER/BOTH cari kartları listeler (`CustomerPickerField variant="supplier-cari"`, fason bacağı
// yok); × bağı kaldırır (kayıt silinmez, fason bağsız kalır). Bağsız fasonda "Cari kart oluştur ve bağla": tek tık
// Tedarikçi rollü cari (ad / vergi no / telefon / adres fasondan; rol modeli — `type` yazılmaz) → forma yazılır,
// Kaydet ile bağ sunucuya gider.
// Aynı adlı cari zaten varsa sunucu 409 der (apiClient toast) — o kartı seçiciden bağlayın.
// =============================================================================
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { FormField } from "@/components/forms/FormField";
import { customerService } from "@/pages/Customers/service";
import type { Customer } from "@/pages/Customers/types";

export const CREATE_AND_LINK_LABEL = "Cari kart oluştur ve bağla";

interface Props {
  value: string | null;
  onChange: (customerId: string | null) => void;
  /** Şema hatası (bağsız kaydedilemez) — FormField altında. */
  error?: { message?: string };
  /** Kopyalanacak kart alanları — formun O ANKİ değerleri (kaydedilmemiş ad da kopyalanır). */
  source: { name: string; taxNumber: string; phone: string; address: string };
  disabled?: boolean;
}

export function SubcontractorCustomerLink({ value, onChange, source, disabled, error }: Props) {
  const qc = useQueryClient();
  const createMut = useMutation({
    mutationFn: () =>
      customerService.create({
        name: source.name.trim(),
        taxNumber: source.taxNumber.trim() || null,
        contactPhone: source.phone.trim() || null,
        address: source.address.trim() || null,
        isCustomerRole: false,
        isSupplierRole: true,
        isActive: true,
      } as Partial<Customer>),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["customers"] });
      void qc.invalidateQueries({ queryKey: ["supplier-picker"] });
      if (res.data?.id) {
        toast.success(`Cari kart oluşturuldu: ${res.data.name} — Kaydet ile bağ yazılır`);
        onChange(res.data.id);
      }
    },
  });
  const canCreate = !value && source.name.trim().length > 0 && !disabled;
  return (
    <FormField label="Bağlı cari" required error={error} hint="Fason profili cari kartına bağlıdır: tedarikçi seçicide tek satır (cari) olur; bağsız kaydedilemez">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[16rem] flex-1">
          <CustomerPickerField variant="supplier-cari" clearable value={value} onChange={onChange} disabled={disabled} />
        </div>
        {!value && (
          <Button type="button" variant="outline" size="sm" disabled={!canCreate || createMut.isPending} title="Tek tık: tedarikçi tipli cari kart (ad, vergi no, telefon, adres fasondan) oluşturulur ve seçilir" onClick={() => createMut.mutate()}>
            <Link2 className="mr-1 h-4 w-4" /> {createMut.isPending ? "Oluşturuluyor…" : CREATE_AND_LINK_LABEL}
          </Button>
        )}
      </div>
    </FormField>
  );
}
