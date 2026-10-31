// =============================================================================
// MASRAF ÖZETİ — v2 sunum zarfı (ekran = PDF = Excel; D4-H1)
// =============================================================================
// Hesap `helpers/expense-summary.helper.ts`te (Decimal, dize çıktı); burası yalnız biçimler.
// Satır = kategori, kolon = fabrika ayı, son kolon toplam; sıra helper'ın sırasıdır (TL azalan +
// anahtar). İptal edilen masraf İPTAL AYINDA eksi yazılır — tanım satırı bunu günlük dille söyler.
// =============================================================================
import type { ParametreBeyani, RaporSunumu, TabloBlok, TabloKolonu } from "./sunum/sunum.types";
import { anaSayiKur } from "./sunum/sunum-kur";
import { catalogHeader, periodOf } from "./temel/_common";
import { dayRangeParameters, type ResolvedDayRange } from "./temel/_day-range";
import { cashCategoryKey, type ExpenseSummary } from "../helpers/expense-summary.helper";
import { CURRENCIES } from "../../config/currencies";
import { anlatiUret } from "./anlati/anlati";
import type { AnlatiCumlesi } from "./sunum/sunum.types";

const UNCATEGORIZED_KEY = cashCategoryKey(null).key;

export const EXPENSE_SUMMARY_KEY = "finance/masraf-ozeti";
const TOTAL_COLUMN = "toplam";
/** Satırın Masraf Özeti kova anahtarı (Electron `ExpenseSummaryPage` EXPENSE_ROW_KEY_FIELD aynası). */
export const EXPENSE_ROW_KEY_FIELD = "kategoriAnahtari";
const MONTH_NAMES = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

/** `YYYY-MM` → kolon anahtarı (ekran/Excel/PDF aynı anahtarı okur). */
export const monthColumnKey = (month: string): string => `ay_${month.replace("-", "_")}`;

/** `YYYY-MM` → "Eki 2026" (fabrika ayı zaten anahtarın kendisi; saat dilimi dönüşümü yok). */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

const tl = (v: string): number => Number(v);

export function expenseSummaryTable(s: ExpenseSummary): TabloBlok {
  const columns: TabloKolonu[] = [
    { anahtar: "kategori", baslik: "Kategori" },
    ...s.months.map((m): TabloKolonu => ({ anahtar: monthColumnKey(m), baslik: monthLabel(m), birim: "TRY", hiza: "sag" })),
    { anahtar: TOTAL_COLUMN, baslik: "Toplam", birim: "TRY", hiza: "sag" },
  ];
  const rows = s.categories.map((c) => {
    // `kategoriAnahtari` kolon DEĞİL (kolonlarda yok → ekran/Excel/PDF basmaz): panel satırı Kasa Hareketleri'ni
    // `?category=<anahtar>` ile açar (D4-KUC2 e); istemci anahtar üretmez.
    const row: Record<string, string | number | null> = { kategori: c.label, [EXPENSE_ROW_KEY_FIELD]: c.key };
    for (const m of s.months) row[monthColumnKey(m)] = 0;
    for (const cell of c.cells) row[monthColumnKey(cell.month)] = tl(cell.amountTry);
    row[TOTAL_COLUMN] = tl(c.totalTry);
    return row;
  });
  const totals: Record<string, string | number | null> = { kategori: "Toplam" };
  for (const mt of s.monthTotals) totals[monthColumnKey(mt.month)] = tl(mt.amountTry);
  totals[TOTAL_COLUMN] = tl(s.totalTry);
  return { kolonlar: columns, satirlar: rows, toplam: totals };
}

export function expenseSummaryWarnings(s: ExpenseSummary): string[] {
  const w: string[] = [];
  if (s.cancelCount > 0) w.push(`${s.cancelCount} masraf bu dönemde iptal edildi; tutarı iptal edildiği ayda eksi olarak düşüldü.`);
  // Kategorisiz satır bir eksiklik bildirimidir: operatör kategoriyi doldurabilir.
  if (s.categories.some((c) => c.key === UNCATEGORIZED_KEY)) {
    w.push("Kategorisi boş bırakılmış masraflar \"Kategorisiz\" satırında toplandı.");
  }
  return w;
}

/** Para birimi kodu → günlük ad (seçenek etiketi ve varyant hücresi adı aynı yerden). */
export const currencyName = (code: string): string => CURRENCIES.find((c) => c.code === code)?.name ?? code;

/** `currency` süzgecinin çip beyanı (varyant hücresine tıklanınca panel bu anahtarı yazar). */
export function currencyParameter(selected: readonly string[] | undefined): ParametreBeyani {
  return {
    ad: "currency", etiket: "Para birimi", tur: "cokluSecim",
    deger: selected && selected.length > 0 ? [...selected] : null,
    secenekler: CURRENCIES.map((c) => ({ deger: c.code, etiket: c.name })),
  };
}

/**
 * "Ne görüyoruz?" — anlatı motorunun `enBuyukPay` kuralı (en az iki kategori, eksi toplamlı kategori yokken):
 * "En büyük pay <kategori>: <tutar> (toplamın %<pay>'ı)." Boş dönemde cümle YOK.
 */
export function expenseSummaryNarrative(s: ExpenseSummary): AnlatiCumlesi[] {
  if (s.categories.length === 0) return [];
  return anlatiUret({
    kirilim: { boyut: "kategori", birim: "TRY", adTuru: "ozel", ozneIlgi: "Masrafların", satirlar: s.categories.map((c) => ({ ad: c.label, deger: tl(c.totalTry) })) },
  }, { kurallar: ["enBuyukPay"] });
}

export function buildExpenseSummarySunumu(s: ExpenseSummary, window: ResolvedDayRange, previous: ExpenseSummary | null, currency?: readonly string[]): RaporSunumu {
  const parametreler: ParametreBeyani[] = [...dayRangeParameters(window.days, window.mode), currencyParameter(currency)];
  return {
    ...catalogHeader(EXPENSE_SUMMARY_KEY),
    donem: periodOf(window.range),
    ...(window.compareRange ? { kiyasDonemi: periodOf(window.compareRange) } : {}),
    anaSayi: anaSayiKur({
      olcu: "masraf.harcanan",
      ad: "Harcanan",
      deger: tl(s.totalTry),
      birim: "TRY",
      onceki: previous ? tl(previous.totalTry) : undefined,
      iyiYon: "asagi",
    }),
    yanSayilar: [
      anaSayiKur({ olcu: "masraf.fisSayisi", ad: "Masraf fişi", deger: s.expenseCount, birim: "adet", iyiYon: "notr" }),
      anaSayiKur({ olcu: "masraf.kategoriSayisi", ad: "Kategori", deger: s.categories.length, birim: "adet", iyiYon: "notr" }),
      anaSayiKur({ olcu: "masraf.iptalSayisi", ad: "İptal edilen", deger: s.cancelCount, birim: "adet", iyiYon: "notr" }),
    ],
    anlati: expenseSummaryNarrative(s),
    grafik: null,
    tablo: expenseSummaryTable(s),
    tanimlar: [
      { ad: "Harcanan", aciklama: "Kasadan ve bankadan masraf olarak çıkan para, TL karşılığıyla; tahsilat, ödeme ve virman girmez." },
      { ad: "Ay", aciklama: "Masraf, fişin tarihi hangi aydaysa o aya yazılır." },
      { ad: "İptal", aciklama: "İptal edilen masraf iptal edildiği ayda eksi olarak düşülür; eski ayın rakamı değişmez." },
      { ad: "Kategori", aciklama: "Masraf girilirken yazılan kategori, yazıldığı gibi; boş bırakılanlar \"Kategorisiz\" satırındadır." },
    ],
    parametreler,
    uyarilar: expenseSummaryWarnings(s),
  };
}
