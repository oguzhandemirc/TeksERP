// Finans ekranının segmentleri ve etiketleri (ekran dosyası yalnız varsayılan bileşeni dışa verir).

export type FinanceTab = "kasa" | "masraf" | "karlilik" | "cek" | "fatura" | "tahsilat";

/** Segment → gereken izin (bulut kataloğu; `FINANCE_READ` dört kodundan). İzinsiz segment konmaz. */
export const FINANCE_TABS: readonly { readonly key: FinanceTab; readonly label: string; readonly perm: string }[] = [
  { key: "kasa", label: "Kasa", perm: "bulut:kasa:oku" },
  // Masraf özeti (`ozet-masraf`, D4-H2): kasa okuma izniyle; izinsiz hesapta segment konmaz.
  { key: "masraf", label: "Masraf", perm: "bulut:kasa:oku" },
  // Kârlılık özeti (`karlilik-ozet`, D4-G4, S15 a): maliyet okuma izniyle; izinsiz hesapta segment konmaz.
  { key: "karlilik", label: "Kârlılık", perm: "bulut:maliyet:oku" },
  { key: "cek", label: "Çek", perm: "bulut:cek:oku" },
  { key: "fatura", label: "Fatura", perm: "bulut:fatura:oku" },
  { key: "tahsilat", label: "Tahsilat", perm: "bulut:tahsilat:oku" },
];

/** Ekranın geçersizleştirme etiketleri (aşağı çek hepsini tazeler). */
export const FINANCE_TAGS: readonly string[] = ["ozet-finans", "ozet-masraf", "karlilik-ozet", "kasa", "banka", "kasa-hareketi", "cek-senet", "fatura", "tahsilat-odeme"];
