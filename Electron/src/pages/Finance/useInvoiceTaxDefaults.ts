// =============================================================================
// FATURA FORMU KDV / TEVKİFAT ÖN DEĞERİ (D4-V1k) — sunucunun TEK çözümleyicisinden
// =============================================================================
// Panel kuralı kendisi hesaplamaz: `GET /api/finance/invoices/tax-defaults` (müşteri cari ?? genel ayar ?? bugünkü).
// Yalnız YENİ faturada (düzenlemede satırların damgalı oranı esastır) ve yalnız SALES/PURCHASE'ta sorulur;
// iade türleri ve eski backend (uç yok → hata) genel KDV ile açılır — bugünkü davranış.
// Kullanıcının elle değiştirdiği satıra DOKUNULMAZ: yalnız hâlâ önceki ön değeri taşıyan satır güncellenir.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { getInvoiceTaxDefaults, type InvoiceTaxDefaults, type InvoiceType } from "./service";
import type { InvoiceFormLine } from "./invoiceForm";

export function useInvoiceTaxDefaults(type: InvoiceType, customerId: string | null, enabled: boolean): InvoiceTaxDefaults | null {
  const financeEnabled = useFeatureFlags().data?.data?.financeEnabled ?? false;
  const askable = type === "SALES" || type === "PURCHASE";
  const party = type === "SALES" ? customerId : null;
  const q = useQuery({
    queryKey: ["finance", "invoice-tax-defaults", type, party],
    queryFn: () => getInvoiceTaxDefaults(type as "SALES" | "PURCHASE", party),
    enabled: financeEnabled && enabled && askable,
    staleTime: 60_000,
    retry: false,
  });
  return q.data ?? null;
}

/** Ön değer değişince yalnız önceki ön değeri taşıyan (kullanıcının dokunmadığı) satırları yeniler. */
export function applyTaxDefaults(lines: InvoiceFormLine[], prev: InvoiceTaxDefaults, next: InvoiceTaxDefaults): InvoiceFormLine[] {
  if (prev.vatRate === next.vatRate && prev.withholdingRate === next.withholdingRate) return lines;
  let changed = false;
  const out = lines.map((l) => {
    if (l.vatRate !== prev.vatRate || l.withholdingRate !== prev.withholdingRate) return l;
    changed = true;
    return { ...l, vatRate: next.vatRate, withholdingRate: next.withholdingRate };
  });
  return changed ? out : lines;
}
