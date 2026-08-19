import type { FilterDef } from "@/components/data-table/FilterBar";
import { customerService } from "@/pages/Customers/service";
import { branchLookupService } from "@/pages/Operations/Shipments/service";
import type { BranchLookupItem } from "@/pages/Operations/Shipments/types";
import { loadAllForPicker } from "@/lib/picker-loader";

/**
 * Muhasebe listesi süzgeçleri. Sayfa 200 satır sınırında kalsın diye ayrı dosya.
 *
 * Tarih varsayılanı `dispatchedAt` (sevk) — muhasebeci dönemi çıkış tarihine göre
 * kapatır, kayıt oluşturma tarihine göre değil.
 */
export const ACCOUNTING_FILTERS: FilterDef[] = [
  // Müşteri ÇOKLU: muhasebeci dönemi çoğu zaman birkaç cari üzerinden kapatır.
  { kind: "multi-lookup", key: "customerId", label: "Müşteri", service: customerService, queryKey: "customers" },
  // Şube müşteriye bağlı (Sevkiyatlar ekranıyla aynı dependent-lookup); şube bazlı
  // cari takipte muhasebeci sevkleri şubeye göre ayırabilsin. Üst filtre çoklu
  // olabilir — ham CSV `/api/customer-branches`e aynen geçer (BaseService → `in`).
  {
    kind: "dependent-lookup",
    key: "branchId",
    label: "Şube",
    dependsOn: "customerId",
    queryKey: "branch-lookup",
    placeholderNoParent: "Şube (önce müşteri)",
    fetchOptions: (customerId) =>
      loadAllForPicker(branchLookupService, {
          sortBy: "name",
          sortOrder: "asc",
          filters: { isActive: "true", customerId },
        })
        .then((r) => r.data),
    getLabel: (it) => {
      const b = it as Partial<BranchLookupItem> & { id: string };
      if (!b.name) return b.id;
      return b.city ? `${b.name} (${b.city})` : b.name;
    },
  },
  // İhracat faturası ayrı kesilir → yön muhasebecinin ilk ayırdığı eksen.
  // TEKİL KALIR — gerekçe Sevkiyatlar ekranındaki `destination` notunda
  // (iki değerli NOT NULL enum + DirectShipment union'ı düşme riski).
  {
    kind: "select",
    key: "destination",
    label: "Yön",
    options: [
      { value: "DOMESTIC", label: "Yurt İçi" },
      { value: "EXPORT", label: "İhracat" },
    ],
  },
  // "Hangi sevkin faturası kesilmedi" — muhasebecinin dönem kapanış listesi.
  {
    kind: "select",
    key: "invoiced",
    label: "Fatura",
    options: [
      { value: "false", label: "Faturalanmamış" },
      { value: "true", label: "Faturalandı" },
    ],
  },
  // İade içerenler — iade faturası / dekont kesilecek sevkler.
  {
    kind: "select",
    key: "hasReturns",
    label: "İade",
    options: [{ value: "true", label: "Yalnız iade içerenler" }],
  },
  {
    kind: "dateRange",
    label: "Sevk Tarihi",
    defaultField: "dispatchedAt",
    fieldOptions: [
      { value: "dispatchedAt", label: "Sevk" },
      { value: "createdAt", label: "Oluşturma" },
    ],
  },
];
