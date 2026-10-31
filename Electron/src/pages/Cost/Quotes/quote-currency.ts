// SY-J1 — yeni teklifte para birimi ÖN SEÇİMİ (öneri; kullanıcı değiştirirse onun seçimi kalır).
// Sunucu karar verir (`GET /api/cost/quote-currency`): ayar TRY iken TRY (bugünkü), aksi halde
// müşterinin yayındaki fiyat listesinin dövizi, yoksa maliyet sunum dövizi.
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { Currency } from "@/pages/Finance/service";

export interface QuoteCurrencySuggestion { doviz: Currency; kaynak: "VARSAYILAN" | "FIYAT_LISTESI" | "AYAR"; fiyatListesiNo: string | null }

export function useQuoteCurrencySuggestion(customerId: string | null) {
  return useQuery({
    queryKey: ["quotes", "currency-suggestion", customerId],
    queryFn: async () =>
      (await apiClient.get<ApiResponse<QuoteCurrencySuggestion>>("/api/cost/quote-currency", { params: { customerId } })).data.data as QuoteCurrencySuggestion,
    enabled: !!customerId,
    staleTime: 60_000,
  });
}

/** Kullanıcıya gösterilen kaynak notu; VARSAYILAN'da not yok (bugünkü ekran). */
export function suggestionHint(s: QuoteCurrencySuggestion | undefined): string | undefined {
  if (!s || s.kaynak === "VARSAYILAN") return undefined;
  return s.kaynak === "FIYAT_LISTESI" ? `Müşterinin yayındaki fiyat listesinden${s.fiyatListesiNo ? ` (${s.fiyatListesiNo})` : ""}` : "Maliyet sunum dövizi ayarından";
}
