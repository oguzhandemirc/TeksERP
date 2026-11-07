// Sipariş liste süzgeçleri — tek kaynak (eskiden OrdersPage içindeydi). Süzme SUNUCUDA
// (`OrderService.extraWhere` + BaseService); tek satır çubuk bu tanımları kutu olarak çizer.
import type { FilterDef } from "@/components/data-table/FilterBar";
import { customerService } from "@/pages/Customers/service";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { branchLookupService } from "@/pages/Operations/Shipments/service";
import type { BranchLookupItem } from "@/pages/Operations/Shipments/types";
import { loadAllForPicker } from "@/lib/picker-loader";
import { ORDER_SEVK_FILTER_OPTIONS } from "./order-cell-text";
import { FASON_FIRMA_KEY, FASON_GUN_KEY, NEREDE_FILTER_KEY } from "./order-nerede";
import { persistConfigOf } from "@/components/data-table/filter-row/def-row-filters";
import type { TableFilterPersistConfig } from "@/components/data-table/filter-row/filter-persist";
import { SHOW_CANCELLED_PARAM } from "@/hooks/useHideCancelled";

export const ORDER_FILTERS: FilterDef[] = [
  {
    kind: "multi-select",
    key: "status",
    label: "Sevk durumu",
    options: [...ORDER_SEVK_FILTER_OPTIONS],
  },
  {
    // "İş Emri" rollup filtresi — backend'de hesaplanır (OrderService.extraWhere →
    // filter[woState]); rozet kolonuyla aynı semantik (work-order-rollup.ts).
    kind: "multi-select",
    key: "woState",
    label: "İş Emri",
    options: [
      { value: "NONE", label: "İş emri yok" },
      { value: "PLANNED", label: "Planlandı" },
      { value: "IN_PROGRESS", label: "Üretimde" },
      { value: "COMPLETED", label: "Üretildi" },
    ],
  },
  { kind: "multi-lookup", key: "customerId", label: "Müşteri", service: customerService, queryKey: "customers" },
  {
    // Şube SEÇİLEN MÜŞTERİ(LER)E bağlı: müşteri seçilmeden pasif; ham CSV
    // `/api/customer-branches`e aynen geçer, BaseService onu `in` yapar.
    kind: "dependent-lookup",
    key: "branchId",
    label: "Şube",
    dependsOn: "customerId",
    queryKey: "branch-lookup",
    placeholderNoParent: "Şube (önce müşteri)",
    fetchOptions: (customerId) =>
      loadAllForPicker(branchLookupService, { sortBy: "name", sortOrder: "asc", filters: { isActive: "true", customerId } }).then((r) => r.data),
    getLabel: (it) => {
      const b = it as Partial<BranchLookupItem> & { id: string };
      if (!b.name) return b.id;
      return b.city ? `${b.name} (${b.city})` : b.name;
    },
  },
  // Kumaş/renk kalem-içi süzgeçtir (`lines.some`); çoklu seçimde de TEK `some` bloğu:
  // kumaş ∈ seçilenler VE renk ∈ seçilenler AYNI kalemde eşleşmeli.
  { kind: "multi-lookup", key: "itemId", label: "Kumaş", service: itemService, queryKey: "items" },
  { kind: "multi-lookup", key: "colorId", label: "Renk", service: colorService, queryKey: "colors" },
  {
    // Kutu "Termin" (kullanıcı tasarımı 2026-11-06); sipariş tarihi pencerede seçilir — yetenek kaybolmaz.
    kind: "dateRange",
    label: "Termin",
    defaultField: "deadline",
    fieldOptions: [
      { value: "deadline", label: "Termin" },
      { value: "createdAt", label: "Sipariş tarihi" },
    ],
  },
];

/** Filtre kaydı: yalnız bugün tanımlı kutuların anahtarları geri yüklenir (kaldırılmış süzgeç yok sayılır). */
export function orderPersistConfig(filters: readonly FilterDef[], productionEnabled: boolean): TableFilterPersistConfig {
  const fason = productionEnabled ? [FASON_FIRMA_KEY, FASON_GUN_KEY] : [];
  return persistConfigOf(filters, { extraFilterKeys: [NEREDE_FILTER_KEY, ...fason], extraKeys: [SHOW_CANCELLED_PARAM] });
}
