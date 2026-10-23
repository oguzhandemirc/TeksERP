// Finans ekranının segmentleri ve etiketleri (ekran dosyası yalnız varsayılan bileşeni dışa verir).

export type FinanceTab = "kasa" | "cek" | "fatura" | "tahsilat";

/** Segment → gereken izin (bulut kataloğu; `FINANCE_READ` ile aynı dört kod). İzinsiz segment konmaz. */
export const FINANCE_TABS: readonly { readonly key: FinanceTab; readonly label: string; readonly perm: string }[] = [
  { key: "kasa", label: "Kasa", perm: "bulut:kasa:oku" },
  { key: "cek", label: "Çek", perm: "bulut:cek:oku" },
  { key: "fatura", label: "Fatura", perm: "bulut:fatura:oku" },
  { key: "tahsilat", label: "Tahsilat", perm: "bulut:tahsilat:oku" },
];

/** Ekranın geçersizleştirme etiketleri (aşağı çek hepsini tazeler). */
export const FINANCE_TAGS: readonly string[] = ["ozet-finans", "kasa", "banka", "cek-senet", "fatura", "tahsilat-odeme"];
