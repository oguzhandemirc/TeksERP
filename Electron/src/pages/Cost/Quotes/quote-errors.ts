// Teklif uçlarının hata kodları → kullanıcı cümlesi. Kod YALNIZ `details.code`ten (kök kural); 409 claim kaybı
// "teklif bu arada değişti" der ve güncel durumu adıyla söyler — kullanıcı eylemin neden düştüğünü anlar.
import axios from "axios";
import { apiErrorMessage } from "@/services/apiClient";
import { apiErrorCode } from "../shared/errors";
import { QUOTE_STATUS_LABEL } from "./labels";
import type { QuoteStatus } from "./quote-types";

type Details = { status?: unknown; lines?: unknown; required?: unknown; missing?: unknown };
function details(error: unknown): Details {
  return (axios.isAxiosError(error) ? (error.response?.data as { details?: Details } | undefined)?.details : undefined) ?? {};
}

/** 400 QUOTE_LINE_ITEM_MISSING → ürünsüz kalemler; başka hata → null. */
export function missingItemLines(error: unknown): Array<{ lineNo: number; description: string }> | null {
  if (apiErrorCode(error) !== "QUOTE_LINE_ITEM_MISSING") return null;
  const l = details(error).lines;
  return Array.isArray(l) ? (l as Array<{ lineNo: number; description: string }>) : [];
}

export function quoteErrorMessage(error: unknown): string {
  const code = apiErrorCode(error);
  const d = details(error);
  switch (code) {
    case "QUOTE_STATUS_CONFLICT": {
      const s = typeof d.status === "string" ? QUOTE_STATUS_LABEL[d.status as QuoteStatus] : null;
      return s
        ? `Teklif bu arada değişti — şu anki durumu: ${s}. Ekran yenilendi; işlemi yeniden değerlendirin.`
        : "Teklif bu arada değişti ya da bu işleme uygun değil. Ekran yenilendi; işlemi yeniden değerlendirin.";
    }
    case "QUOTE_EXPIRED":
      return "Teklifin geçerlilik süresi doldu — kabul edilemez. Revizyon oluşturup yeni geçerlilikle gönderin.";
    case "QUOTE_LINE_ITEM_MISSING":
      return "Ürünü bağlanmamış kalem var — siparişe dönüştürmeden önce her kaleme ürün bağlayın.";
    case "QUOTE_EMPTY":
      return "Kalemsiz teklif gönderilemez — önce kalem ekleyin.";
    case "PERMISSION_DENIED":
      return Array.isArray(d.required) && d.required.includes("order:write")
        ? "Sipariş oluşturma yetkiniz yok — teklifi siparişe dönüştürmek için sipariş yazma izni de gerekir."
        : apiErrorMessage(error);
    case "COST_INPUT_MISSING":
      return Array.isArray(d.missing) && d.missing.includes("FX_RATE_MISSING")
        ? "Bu döviz için kur bulunamadı — kuru elle girin."
        : "Maliyet girdisi eksik — kalem fiyatlanamadı (ürünün yapısını ya da iplik fiyatlarını tamamlayın).";
    default:
      return apiErrorMessage(error);
  }
}
