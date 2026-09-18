// =============================================================================
// KARTIN CARİ TERİMLERİ — TEK ÇÖZÜCÜ (Z-B ③, 2026-09-18): kod aramasıyla DEĞİL kart id'siyle
// =============================================================================
// Fatura/tahsilat/ödeme/çek formları vade + para birimini `GET /finance/cari/by-customer/:customerId` ile okur. Hesap yoksa
// (404 CARI_ACCOUNT_MISSING) öneri yoktur: alan BOŞ kalır, uydurulmaz. `settled` sözleşmesi korunur — settle olmadan alana
// dokunulmaz (bayat öneriyi hata anında temizlemek yanlış anda veri silmek olurdu). Eski fason (SUBCONTRACTOR) taraf yalnız
// düzenlemede salt-okunur çizilir: adı gelir, terim aranmaz.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { customerService } from "@/pages/Customers/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { getCariByCustomer, type Currency } from "./service";

export type TermsParty = "CUSTOMER" | "SUBCONTRACTOR";

export interface CustomerTerms {
  partyName: string | null;
  termDays: number | null;
  defaultCurrency: Currency | null;
  /** Kartın cari hesabı var mı — `false` = 404 (kart hesabıyla doğar; eski kart için göç script'i). */
  hasAccount: boolean | null;
  settled: boolean;
}

export function useCustomerTerms(party: TermsParty, partyId: string | null): CustomerTerms {
  const financeEnabled = useFeatureFlags().data?.data?.financeEnabled ?? false;
  const partyQ = useQuery({
    queryKey: ["invoice-party-card", party, partyId],
    queryFn: async () => (party === "CUSTOMER" ? (await customerService.getById(partyId as string)).data : (await subcontractorService.getById(partyId as string)).data),
    enabled: financeEnabled && Boolean(partyId),
    staleTime: 60_000,
  });
  const cariQ = useQuery({
    queryKey: ["finance", "cari", "by-customer", partyId],
    queryFn: () => getCariByCustomer(partyId as string),
    enabled: financeEnabled && party === "CUSTOMER" && Boolean(partyId),
    staleTime: 60_000,
  });
  const row = party === "CUSTOMER" ? cariQ.data ?? null : null;
  return {
    partyName: partyQ.data ? `${partyQ.data.name}${partyQ.data.code ? ` — ${partyQ.data.code}` : ""}` : null,
    termDays: row?.paymentTermDays ?? null,
    // Kartı/hesabı OLMAYAN caride null — sessizce TRY'ye düşmek USD'li müşteriye TRY fatura kesmektir.
    defaultCurrency: (row?.defaultCurrency ?? null) as Currency | null,
    hasAccount: party !== "CUSTOMER" ? null : cariQ.isSuccess ? cariQ.data !== null : null,
    settled: Boolean(partyId) && partyQ.isSuccess && (party !== "CUSTOMER" || cariQ.isSuccess),
  };
}
