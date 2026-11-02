// Kurşun gram fiyatı GÖVDE okuyucusu (saf, DB'siz). Fiyat hesabından (`kursun-gram-price.helper`) ayrı dosyada
// durur: istasyon ayar ucu yalnız bunu ister; hesap dosyası cari/finans yardımcısını çektiği için istasyon
// router'ını ön muhasebe rejim kapısına bağlardı (test_finance_regime_gate §2).
import { Currency } from "@prisma/client";
import { AppError } from "../../utils/app-error";

/** Gövdeden gram fiyatı: `null` = kaldır (para birimi de düşer); değer verildiyse para birimi ZORUNLU, >= 0, en fazla 4 ondalık. */
export function readKursunGramPrice(raw: unknown, currency: unknown): { price: string | null; currency: Currency | null } {
  if (raw === null || raw === "") return { price: null, currency: null };
  const txt = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim().replace(",", ".") : "";
  if (!/^\d{1,8}(\.\d{1,4})?$/.test(txt)) {
    throw AppError.badRequest("Kurşun gram fiyatı 0 ya da pozitif, en fazla 4 ondalıklı sayı olmalı", { code: "KURSUN_GRAM_PRICE_INVALID" });
  }
  if (typeof currency !== "string" || !(Object.values(Currency) as string[]).includes(currency)) {
    throw AppError.badRequest("Kurşun gram fiyatının para birimi seçilmeli", { code: "KURSUN_GRAM_PRICE_INVALID" });
  }
  return { price: txt, currency: currency as Currency };
}
