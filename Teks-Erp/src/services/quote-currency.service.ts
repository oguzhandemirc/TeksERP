// =============================================================================
// TEKLİF DÖVİZİ ÖN SEÇİMİ (SY-J1; tasarım §11.5-3) — öneri, zorunluluk değil
// =============================================================================
// Ayar `maliyet.sunumDovizi` TRY iken bugünkü davranış: öneri TRY (fiyat listesi okunmaz).
// Aksi halde müşterinin YAYINDAKİ en son fiyat listesinin dövizi, yoksa ayar dövizi.
// =============================================================================
import type { Currency } from "@prisma/client";
import prisma from "../lib/prisma";
import { readCostPresentationCurrency } from "./system-setting.service";

export type QuoteCurrencySource = "VARSAYILAN" | "FIYAT_LISTESI" | "AYAR";

export async function suggestQuoteCurrency(customerId: string): Promise<{ doviz: Currency; kaynak: QuoteCurrencySource; fiyatListesiNo: string | null }> {
  const setting = await readCostPresentationCurrency();
  if (setting === "TRY") return { doviz: "TRY", kaynak: "VARSAYILAN", fiyatListesiNo: null };
  const list = await prisma.priceList.findFirst({
    where: { customerId, status: "PUBLISHED" },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    select: { currency: true, listNo: true },
  });
  if (list) return { doviz: list.currency, kaynak: "FIYAT_LISTESI", fiyatListesiNo: list.listNo };
  return { doviz: setting, kaynak: "AYAR", fiyatListesiNo: null };
}
