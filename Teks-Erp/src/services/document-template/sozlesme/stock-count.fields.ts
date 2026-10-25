// =============================================================================
// STOCK_COUNT sözleşmesinin alan beyanları (kökler, tablolar, kolon eşleri)
// =============================================================================
// Sayım tutanağı tamamlamada donar ve "sayım kesiti + uygulanan fark"ı taşır; fark özeti
// sayaçları snapshot'tan gelir (satırlardan yeniden sayılmaz) — şablon hesap yapmaz.
// =============================================================================

import type { DocColSpec } from "../../document-render/doc-model";
import { COMPANY_FIELDS, PRINT_FIELDS } from "./ortak";
import { sampleSeriesCode } from "./senaryolar";
import type { FieldDef, TableDef } from "./tipler";
import { WAREHOUSE_SECTIONS, headFields } from "./warehouse-common";

export const STOCK_COUNT_TITLE = "STOK SAYIM TUTANAĞI";
export const STOCK_COUNT_SECTIONS = { ...WAREHOUSE_SECTIONS, countStatus: true, yarnTable: true, countSummary: true } as const;

type Spec = [yol: string, etiket: string, ornek: string | number | boolean | null];
const text = ([yol, etiket, ornek]: Spec): FieldDef => ({ yol, etiket, tur: "metin", sinif: "musteri", ornek });
const count = ([yol, etiket, ornek]: Spec): FieldDef => ({ yol, etiket, tur: "sayi", ondalik: 0, sinif: "musteri", ornek });
const qty = (unit: "m" | "kg") => ([yol, etiket, ornek]: Spec): FieldDef => ({
  yol, etiket, tur: "sayi", ondalik: 2, birim: unit, sinif: "musteri", ornek,
});

export const STOCK_COUNT_ROOT_FIELDS: FieldDef[] = [
  ...headFields("Sayım no", sampleSeriesCode("stockCount", 1), STOCK_COUNT_TITLE, "STOCK_COUNT"),
  ...([
    ["belge.depo", "Sayılan depo", "Merkez Depo"],
    ["belge.depo_kod", "Sayılan depo kodu", "DP-MERKEZ"],
    ["belge.acan", "Sayımı açan", "Ayşe Kaya"],
    ["belge.tamamlayan", "Tamamlayan", "Mehmet Yılmaz"],
    ["belge.sayim_durumu", "Sayım durumu (metin)", "Tamamlandı"],
    ["belge.notlar", "Not", "Yıl sonu tam sayımı."],
  ] as Spec[]).map(text),
  {
    yol: "belge.kesinlesti", etiket: "Fark uygulandı mı (sayım tamamlandı)", tur: "mantiksal", sinif: "musteri", ornek: true,
  },
  ...COMPANY_FIELDS,
  ...([
    ["toplamlar.top_adedi", "Listedeki top satırı", 4],
    ["toplamlar.iplik_kalem", "Listedeki iplik satırı", 3],
    ["toplamlar.sayim_top_toplam", "Özet: toplam top", 4],
    ["toplamlar.bulunan_top", "Özet: bulunan top", 1],
    ["toplamlar.eksik_top", "Özet: eksik top", 1],
    ["toplamlar.sayilmayan_top", "Özet: sayılmayan top", 1],
    ["toplamlar.kapsam_disi_top", "Özet: kapsam dışı top", 1],
    ["toplamlar.sayim_iplik_toplam", "Özet: toplam iplik kalemi", 3],
    ["toplamlar.uygulanan_iplik", "Özet: farkı uygulanan iplik", 1],
    ["toplamlar.sayilmayan_iplik", "Özet: sayılmayan iplik", 0],
    ["toplamlar.kapsam_disi_iplik", "Özet: kapsam dışı iplik", 1],
  ] as Spec[]).map(count),
  ...([
    ["toplamlar.beklenen_metre", "Listedeki beklenen metre toplamı", 415.5],
    ["toplamlar.ozet_beklenen_metre", "Özet: beklenen toplam metraj", 415.5],
    ["toplamlar.eksik_metre", "Özet: eksik metre", 85.5],
  ] as Spec[]).map(qty("m")),
  qty("kg")(["toplamlar.iplik_fark_kg", "Özet: iplik farkı (net)", -12.5]),
  { yol: "toplamlar.ozet_var", etiket: "Fark özeti var mı", tur: "mantiksal", sinif: "musteri", ornek: true },
  ...PRINT_FIELDS,
];

export const STOCK_COUNT_ROLL_TABLE: TableDef = {
  anahtar: "toplar",
  etiket: "Sayım listesi — toplar",
  kolonlar: [
    { ...text(["barkod", "Barkod", "T150826F0301"]), hiza: "l", kaynakKolon: "barcode" },
    { ...text(["urun", "Ürün", "Perde Kumaşı"]), hiza: "l", kaynakKolon: "itemColor" },
    { ...text(["renk", "Renk (ürünle aynı hücrede)", "Ekru"]), hiza: "l" },
    { yol: "en", etiket: "En", tur: "sayi", ondalik: 0, birim: "cm", sinif: "musteri", ornek: 300, hiza: "c" },
    { ...qty("m")(["beklenen", "Beklenen", 120]), hiza: "r", kaynakKolon: "expectedQty", toplam: "beklenen_metre" },
    { ...qty("m")(["sayilan", "Sayılan (bilgi notu)", 120]), hiza: "r", kaynakKolon: "countedQty" },
    { ...qty("m")(["dusulen", "Kayıttan düşülen (uygulanan)", null]), hiza: "r" },
    { ...text(["durum", "Durum kodu (FOUND/MISSING/UNCOUNTED/OUT_OF_SCOPE)", "FOUND"]), hiza: "l", kaynakKolon: "state" },
    { ...text(["kapsam_disi_nedeni", "Kapsam dışı sebebi", null]), hiza: "l" },
    { ...text(["notlar", "Satır notu", null]), hiza: "l" },
  ],
};

export const STOCK_COUNT_YARN_TABLE: TableDef = {
  anahtar: "iplik",
  etiket: "Sayım listesi — iplik (kg)",
  kolonlar: [
    { ...text(["ad", "İplik", "Pamuk İplik Ne 30"]), hiza: "l" },
    { ...qty("kg")(["beklenen_kg", "Beklenen", 500]), hiza: "r" },
    { ...qty("kg")(["sayilan_kg", "Sayılan", 487.5]), hiza: "r" },
    { ...qty("kg")(["fark_kg", "Fark", -12.5]), hiza: "r", toplam: "iplik_fark_kg" },
    { ...text(["durum", "Durum kodu (APPLIED/MATCH/UNCOUNTED/OUT_OF_SCOPE)", "APPLIED"]), hiza: "l" },
    { ...text(["kapsam_disi_nedeni", "Kapsam dışı sebebi", null]), hiza: "l" },
  ],
};

const TEXT = { t: "text" } as const;
const QTY = { t: "num", dec: 2 } as const;
/** Renderer kolonlarının eşi (anahtar/başlık/hiza) — kolon düzeni renderer'ın çözücüsünden. */
export const STOCK_COUNT_ROLL_SPECS: DocColSpec<never>[] = [
  { key: "barcode", label: "BARKOD", align: "l", cellClass: "mono", kind: TEXT, value: () => null },
  { key: "itemColor", label: "ÜRÜN / RENK", align: "l", kind: TEXT, value: () => null },
  { key: "expectedQty", label: "BEKLENEN", align: "r", width: "80px", kind: QTY, value: () => null, foot: { value: null } },
  { key: "countedQty", label: "SAYILAN", align: "r", width: "80px", kind: QTY, value: () => null },
  { key: "state", label: "DURUM", align: "l", width: "150px", kind: TEXT, value: () => null },
];
