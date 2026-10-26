// =============================================================================
// PRICE_LIST (Fiyat Listesi) veri sözleşmesi — MAL-6
// =============================================================================
// Müşteriye gider (`hedef: musteri`). Satırın maliyeti ve kâr oranı sözleşmede YOKTUR,
// `ic` sınıflı alan da açılmaz. Müşterisiz liste `karsi_taraf.ad` boş + `belge.kapsam`
// "Genel" ile basılır; geçerlilik metni renderer'ın AYNI yardımcısından gelir.
// =============================================================================

import { docTitle } from "../../document-render/doc-style";
import {
  GENERAL_SCOPE_TEXT,
  PRICE_LIST_SIGNATURES,
  PRICE_LIST_TITLE,
  priceListColumns,
  validityText,
  type PriceListDoc,
  type PriceListDocLine,
} from "../../document-render/price-list.html";
import type { PrintedDocSnapshot } from "../../printed-document.service";
import {
  COMPANY_FIELDS,
  DOC_STATUS_FIELDS,
  LETTERHEAD_EXTRA_TABLE,
  PRINT_FIELDS,
  asObject,
  companyRoot,
  docStatus,
  fillFields,
  letterheadExtraRows,
  printRoot,
  rootFields,
} from "./ortak";
import { longText, sampleDoc, sampleEnvelope, sampleSeriesCode } from "./senaryolar";
import { baseConfigSchema, normalizeBase, plainJson, resolveColumns, sanitizeRawConfig, type BaseDocConfig } from "./subcontractor-common";
import type { BuildExtras, ContextObject, ContextValue, DocumentContract, FieldDef, Scenario, TableDef, TemplateContext } from "./tipler";

type Row = Record<string, unknown>;

const SECTIONS = { taxNo: true, customerCode: true, listNo: true, publishedAt: true, validity: true, lineTable: true, notes: true } as const;

const LINE_TABLE: TableDef = {
  anahtar: "satirlar",
  etiket: "Fiyatlar",
  kolonlar: [
    { yol: "sira", etiket: "Sıra", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1, hiza: "c", kaynakKolon: "seq" },
    { yol: "urun_kodu", etiket: "Ürün kodu", tur: "metin", sinif: "musteri", ornek: "KM-0101", hiza: "l", kaynakKolon: "code" },
    { yol: "urun", etiket: "Ürün", tur: "metin", sinif: "musteri", ornek: "Pamuklu Astar", hiza: "l", kaynakKolon: "item" },
    { yol: "renk", etiket: "Renk (boşsa tüm renkler)", tur: "metin", sinif: "musteri", ornek: "Bej", hiza: "l", kaynakKolon: "color" },
    { yol: "birim_fiyat", etiket: "Birim fiyat (liste dövizi)", tur: "sayi", ondalik: 2, sinif: "musteri", ornek: 2.75, hiza: "r", kaynakKolon: "unitPrice" },
    { yol: "asgari_miktar", etiket: "Asgari miktar", tur: "sayi", ondalik: 2, sinif: "musteri", ornek: 500, hiza: "r", kaynakKolon: "minQty" },
  ],
};

const ROOT_FIELDS: FieldDef[] = [
  { yol: "belge.no", etiket: "Liste no (revizyonlu)", tur: "metin", sinif: "musteri", ornek: `${sampleSeriesCode("priceList", 1)}/R1` },
  { yol: "belge.tur", etiket: "Belge türü", tur: "metin", sinif: "musteri", ornek: "PRICE_LIST" },
  { yol: "belge.baslik", etiket: "Belge başlığı", tur: "metin", sinif: "musteri", ornek: PRICE_LIST_TITLE },
  { yol: "belge.tarih", etiket: "Yayın anı", tur: "tarih", sinif: "musteri", ornek: "2026-09-25T08:30:00.000Z" },
  ...DOC_STATUS_FIELDS,
  { yol: "belge.ad", etiket: "Liste adı", tur: "metin", sinif: "musteri", ornek: "2026 Kış Sezonu" },
  { yol: "belge.revizyon", etiket: "Revizyon no", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1 },
  { yol: "belge.doviz", etiket: "Döviz", tur: "metin", sinif: "musteri", ornek: "EUR" },
  { yol: "belge.kapsam", etiket: "Kapsam (\"Genel\" ya da müşteri adı)", tur: "metin", sinif: "musteri", ornek: GENERAL_SCOPE_TEXT },
  { yol: "belge.gecerlilik_baslangic", etiket: "Geçerlilik başlangıcı", tur: "takvim", sinif: "musteri", ornek: "2026-09-01T00:00:00.000Z" },
  { yol: "belge.gecerlilik_bitis", etiket: "Geçerlilik bitişi", tur: "takvim", sinif: "musteri", ornek: "2026-12-31T00:00:00.000Z" },
  { yol: "belge.gecerlilik_metni", etiket: "Geçerlilik metni", tur: "metin", sinif: "musteri", ornek: "01.09.2026 – 31.12.2026" },
  { yol: "belge.not", etiket: "Liste notu", tur: "metin", sinif: "musteri", ornek: "Liste fiyatları metre başınadır." },
  { yol: "karsi_taraf.ad", etiket: "Müşteri adı (genel listede boş)", tur: "metin", sinif: "musteri", ornek: "Örnek Tekstil A.Ş." },
  { yol: "karsi_taraf.kod", etiket: "Müşteri kodu", tur: "metin", sinif: "musteri", ornek: sampleSeriesCode("customer", 1) },
  ...COMPANY_FIELDS,
  { yol: "toplamlar.satir_sayisi", etiket: "Satır sayısı", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 3 },
  ...PRINT_FIELDS,
];

export type PriceListConfig = BaseDocConfig;

export function normalizePriceListConfig(raw: unknown): PriceListConfig {
  const base = normalizeBase(sanitizeRawConfig(raw), { sections: SECTIONS, signatureDefaults: PRICE_LIST_SIGNATURES, marginMm: 9, tables: ["satirlar"] });
  return { ...base, kolonlar: { satirlar: resolveColumns(LINE_TABLE, priceListColumns() as never, base.columns.satirlar!) } };
}

function lineValues(r: PriceListDocLine): Record<string, ContextValue> {
  return { sira: r.lineNo, urun_kodu: r.itemCode, urun: r.itemName, renk: r.colorName, birim_fiyat: r.unitPrice, asgari_miktar: r.minQty };
}

function buildContext(snapshot: PrintedDocSnapshot, rawConfig: unknown, internalFields: readonly string[], extras?: BuildExtras<never>): TemplateContext {
  const optIn = new Set(internalFields);
  const config = normalizePriceListConfig(rawConfig);
  const doc = asObject(snapshot?.doc) as unknown as PriceListDoc;
  const h = doc.header;
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject => fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);

  return {
    belge: root("belge", {
      no: h.documentNo, tur: "PRICE_LIST", baslik: docTitle(config.titleOverride, PRICE_LIST_TITLE), tarih: h.publishedAt,
      ...docStatus(extras?.baski),
      ad: h.name, revizyon: h.revisionNo, doviz: h.currency, kapsam: h.customerName ?? GENERAL_SCOPE_TEXT,
      gecerlilik_baslangic: h.validFromDate, gecerlilik_bitis: h.validUntilDate, gecerlilik_metni: validityText(h), not: doc.notes,
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: root("karsi_taraf", { ad: h.customerName, kod: h.customerCode }),
    tablolar: {
      antet_ek: letterheadExtraRows(snapshot).map((r) => fillFields(LETTERHEAD_EXTRA_TABLE.kolonlar, r, optIn)),
      satirlar: (doc.lines ?? []).map((r) => fillFields(LINE_TABLE.kolonlar, lineValues(r), optIn)),
    },
    toplamlar: root("toplamlar", { satir_sayisi: (doc.lines ?? []).length }),
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: {},
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("PRICE_LIST") as unknown as PriceListDoc;
  const env = (d: PriceListDoc) => sampleEnvelope(d as unknown as Row);
  const [general, colored, other] = base().lines;
  const generalHeader = { ...base().header, customerName: null, customerCode: null, validFromDate: null, validUntilDate: null };
  const multi: PriceListDoc = { ...base(), lines: Array.from({ length: 70 }, (_, i) => ({ ...(i % 2 ? colored! : other!), lineNo: i + 1, itemCode: `KM-${String(100 + i).padStart(4, "0")}`, unitPrice: 2 + i * 0.05 })) };
  const long: PriceListDoc = {
    ...base(),
    header: { ...base().header, name: longText("Özel <&> sezon listesi", 100), customerName: longText("Çok Uzun Adlı Müşteri Tekstil"), customerCode: "M-<01>", validFromDate: base().header.validFromDate, validUntilDate: null },
    lines: [{ ...colored!, itemName: longText("Süet Kumaş", 120), colorName: "Antrasit & Gri" }],
    notes: longText("Uzun liste notu <b>kaçış</b>", 1000),
  };

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek listesi (müşteriye özel EUR)", snapshot: env(base()) },
    { ad: "tek_kalem", aciklama: "Genel liste, tek satır, süresiz", snapshot: env({ ...base(), header: generalHeader, lines: [general!] }) },
    { ad: "cok_sayfa", aciklama: "70 satır — tablo birden çok sayfaya taşar", snapshot: env(multi), ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-09-25T09:00:00.000Z", basan: "admin", not: "Acil" } } },
    { ad: "bos_opsiyonel", aciklama: "Yayınlanmamış (tarihsiz), notsuz, genel", snapshot: env({ ...base(), header: { ...generalHeader, publishedAt: null }, notes: null }) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren adlar; yalnız başlangıç tarihli geçerlilik", snapshot: env(long) },
    { ad: "iptal", aciklama: "Geçersiz kılınmış (VOIDED) liste belgesi", snapshot: env(base()), ek: { baski: { surum: 2, durum: "VOIDED", iptalNedeni: "Yanlış döviz" } } },
  ];
}

export const priceListContract: DocumentContract<PriceListConfig, never> = {
  docType: "PRICE_LIST",
  hedef: "musteri",
  contractVersion: 1,
  kokler: ROOT_FIELDS,
  tablolar: [LETTERHEAD_EXTRA_TABLE, LINE_TABLE],
  ayarSemasi: baseConfigSchema(Object.keys(SECTIONS), [["satirlar", "satirlar"]]),
  ayarNormalize: normalizePriceListConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
