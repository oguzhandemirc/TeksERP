// Masraf formu kategori önerisi ucu (D4-H1) — `service.ts` satır tavanı dolu olduğu için ayrı dosya.
import apiClient from "@/services/apiClient";

/** D4-H1: masraf formu kategori önerisi — ayar kapalıysa `enabled:false` ve boş liste (katalog değil). */
export interface ExpenseCategorySuggestions {
  enabled: boolean;
  categories: string[];
}

export async function fetchExpenseCategorySuggestions(): Promise<ExpenseCategorySuggestions> {
  const res = await apiClient.get("/api/finance/cash-transactions/category-suggestions");
  return (res.data as { data: ExpenseCategorySuggestions }).data;
}
