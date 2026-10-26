// Fiyat listesi hata kodları → kullanıcı cümlesi (kod yalnız `details.code`ten).
import { apiErrorMessage } from "@/services/apiClient";
import { apiErrorCode } from "../shared/errors";

export function priceListErrorMessage(error: unknown): string {
  switch (apiErrorCode(error)) {
    case "PRICE_LIST_STATUS_CONFLICT":
      return "Liste bu arada değişti ya da bu işleme uygun değil. Ekran yenilendi; işlemi yeniden değerlendirin.";
    case "PRICE_LIST_DUPLICATE_LINE":
      return "Aynı ürün ve renk listede iki kez yer alamaz — tekrarlanan satırı silin.";
    case "CUSTOMER_ROLE_REQUIRED":
      return "Seçilen carinin müşteri rolü yok — fiyat listesi yalnız müşteriye açılır.";
    default:
      return apiErrorMessage(error);
  }
}
