// Masraf formu kategori önerisi ucu (D4-H1) + liste kategori süzgecinin seçenek ucu (D4-KUC e) — `service.ts` satır tavanı dolu olduğu için ayrı dosya.
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

export interface CashCategoryOption {
  key: string;
  label: string;
}

/**
 * Kategori süzgecinin seçenekleri — anahtar sunucudan (Masraf Özeti ile aynı kova).
 * Okunamazsa (eski backend 404) `null`: süzgeç isteğe bağlıdır, çağıran onu gizler; toast basılmaz.
 */
export async function listCashCategoryOptions(): Promise<CashCategoryOption[] | null> {
  try {
    const res = await apiClient.get("/api/finance/cash-transactions/categories", { suppressErrorToast: true });
    return (res.data as { data: CashCategoryOption[] }).data;
  } catch {
    return null;
  }
}
