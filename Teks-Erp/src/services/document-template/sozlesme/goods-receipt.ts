// =============================================================================
// GOODS_RECEIPT (Mal Kabul Fişi) veri sözleşmesi
// =============================================================================
// Sistem renderer'ı (`document-render/warehouse-doc.html.ts` `renderGoodsReceiptHtml`)
// DEĞİŞMEZ ve yalnız okunur. Tedarikçi `karsi_taraf`, giren depo `belge`dedir. İplik
// satırları yalnız iplikli fişte vardır (eski/kumaş-only snapshot'ta boş tablo).
// =============================================================================

import { docTitle } from "../../document-render/doc-style";
import type { PrintedDocSnapshot } from "../../printed-document.service";
import {
  COMPANY_FIELDS,
  LETTERHEAD_EXTRA_TABLE,
  PRINT_FIELDS,
  asNumber,
  asObject,
  asRows,
  asText,
  companyRoot,
  docStatus,
  fillFields,
  letterheadExtraRows,
  printRoot,
  rootFields,
} from "./ortak";
import { longText, sampleDoc, sampleEnvelope, sampleSeriesCode } from "./senaryolar";
import { baseConfigSchema, plainJson } from "./subcontractor-common";
import type { BuildExtras, ContextObject, ContextValue, DocumentContract, FieldDef, Scenario, TableDef, TemplateContext } from "./tipler";
import {
  ROLL_SPECS,
  ROLL_TOTAL_FIELDS,
  WAREHOUSE_SECTIONS,
  headFields,
  normalizeWarehouse,
  rollRows,
  rollTableDef,
  type WarehouseConfig,
} from "./warehouse-common";

type Row = Record<string, unknown>;

const TITLE = "MAL KABUL FİŞİ";
const SECTIONS = { ...WAREHOUSE_SECTIONS, deliveryNote: true } as const;
const ROLL_TABLE = rollTableDef("Kabul edilen toplar");
const YARN_TABLE: TableDef = {
  anahtar: "iplik",
  etiket: "Kabul edilen iplik (kg)",
  kolonlar: [
    { yol: "ad", etiket: "İplik", tur: "metin", sinif: "musteri", ornek: "Pamuk İplik Ne 30", hiza: "l" },
    { yol: "kg", etiket: "Kg", tur: "sayi", ondalik: 2, birim: "kg", sinif: "musteri", ornek: 500, hiza: "r", toplam: "iplik_kg" },
  ],
};

const ROOT_FIELDS: FieldDef[] = [
  ...headFields("Fiş no", sampleSeriesCode("goodsReceipt", 1), TITLE, "GOODS_RECEIPT"),
  { yol: "belge.depo", etiket: "Giren depo", tur: "metin", sinif: "musteri", ornek: "Merkez Depo" },
  { yol: "belge.depo_kod", etiket: "Giren depo kodu", tur: "metin", sinif: "musteri", ornek: "DP-MERKEZ" },
  { yol: "belge.tedarikci_irsaliye_no", etiket: "Tedarikçi irsaliye no", tur: "metin", sinif: "musteri", ornek: "IRS-2026-4471" },
  { yol: "belge.teslim_alan", etiket: "Teslim alan", tur: "metin", sinif: "musteri", ornek: "Ayşe Kaya" },
  { yol: "belge.notlar", etiket: "Not", tur: "metin", sinif: "musteri", ornek: null },
  ...COMPANY_FIELDS,
  { yol: "karsi_taraf.ad", etiket: "Tedarikçi adı", tur: "metin", sinif: "musteri", ornek: "Örnek Tedarik A.Ş." },
  { yol: "karsi_taraf.kod", etiket: "Tedarikçi kodu", tur: "metin", sinif: "musteri", ornek: sampleSeriesCode("customer", 7) },
  ...ROLL_TOTAL_FIELDS,
  { yol: "toplamlar.iplik_kalem", etiket: "İplik kalem sayısı", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1 },
  { yol: "toplamlar.iplik_kg", etiket: "Toplam iplik (kg)", tur: "sayi", ondalik: 2, birim: "kg", sinif: "musteri", ornek: 500 },
  ...PRINT_FIELDS,
];

export function normalizeGoodsReceiptConfig(raw: unknown): WarehouseConfig {
  return normalizeWarehouse(raw, {
    sections: SECTIONS,
    signatureDefaults: ["Teslim Eden (Tedarikçi)", "Teslim Alan"],
    rollTable: ROLL_TABLE,
    specs: ROLL_SPECS,
  });
}

function buildContext(snapshot: PrintedDocSnapshot, rawConfig: unknown, internalFields: readonly string[], extras?: BuildExtras<never>): TemplateContext {
  const config = normalizeGoodsReceiptConfig(rawConfig);
  const optIn = new Set(internalFields);
  const doc = asObject(snapshot?.doc);
  const h = asObject(doc.header);
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject =>
    fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);
  const rolls = rollRows(ROLL_TABLE, doc.lines, optIn);
  const yarn = asRows(doc.yarnLines);

  return {
    belge: root("belge", {
      no: asText(h.documentNo),
      tur: "GOODS_RECEIPT",
      baslik: docTitle(config.titleOverride, TITLE),
      tarih: asText(h.date),
      ...docStatus(extras?.baski),
      depo: asText(h.warehouseName),
      depo_kod: asText(h.warehouseCode),
      tedarikci_irsaliye_no: asText(h.deliveryNoteNo),
      teslim_alan: asText(h.createdBy),
      notlar: asText(doc.notes),
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: root("karsi_taraf", { ad: asText(h.supplierName), kod: asText(h.supplierCode) }),
    tablolar: {
      antet_ek: letterheadExtraRows(snapshot).map((r) => fillFields(LETTERHEAD_EXTRA_TABLE.kolonlar, r, optIn)),
      toplar: rolls.rows,
      iplik: yarn.map((y) => fillFields(YARN_TABLE.kolonlar, { ad: asText(y.itemName), kg: asNumber(y.qtyKg) }, optIn)),
    },
    toplamlar: root("toplamlar", {
      top_adedi: rolls.rows.length,
      metre: rolls.metre,
      iplik_kalem: yarn.length,
      iplik_kg: yarn.reduce((s, y) => s + (Number(y.qtyKg) || 0), 0),
    }),
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: {},
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("GOODS_RECEIPT");
  const header = (d: Row) => d.header as Row;
  const line = (i: number, width: number | null = 300, qty = 150 + i): Row => ({
    barcode: `T130826F${String(200 + i).padStart(4, "0")}`, itemName: "Perde Kumaşı", colorName: "Krem", width, qty,
  });

  // Tek kalem: yalnız iplik değil, tek top + tek iplik kalemi (karma fiş).
  const single = base();
  single.lines = [line(1, 300, 200)];
  single.yarnLines = [{ itemName: "Pamuk İplik Ne 30", qtyKg: 500 }];

  const multi = base();
  multi.lines = Array.from({ length: 60 }, (_, i) => line(i + 1, i % 3 === 0 ? 279.6 : 280, 90 + (i % 5) * 10.5));
  multi.yarnLines = Array.from({ length: 6 }, (_, i) => ({ itemName: `Polyester İplik ${150 + i * 25}D`, qtyKg: 120.25 * (i + 1) }));
  multi.notes = "Karma fiş: kumaş + iplik";

  // Eski snapshot şekli: tedarikçi/irsaliye/düzenleyen yok, iplik alanı hiç yok.
  const empty: Row = {
    header: {
      documentNo: sampleSeriesCode("goodsReceipt", 2), date: null, warehouseName: "Merkez Depo", warehouseCode: null,
      supplierName: null, supplierCode: null, deliveryNoteNo: null, createdBy: null,
    },
    lines: [{ barcode: null, itemName: "Tül", colorName: null, width: null, qty: 0 }],
    notes: null,
  };

  const long = base();
  long.header = {
    ...header(long), supplierName: longText("Çok Uzun Unvanlı Tedarik Dokuma Sanayi"), supplierCode: "TD-<07>",
    deliveryNoteNo: longText("IRS-2026", 40), warehouseName: longText("Hammadde Deposu", 60),
  };
  long.notes = longText("Kenar kırık iki top ayrıldı");
  long.lines = [...(long.lines as Row[]), { ...line(4, 999), itemName: longText("Süet Kumaş", 120) }, line(5, 999.4, 1234.567)];
  long.yarnLines = [{ itemName: longText("Viskon İplik Ne 40", 90), qtyKg: 75.125 }];

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek fişi (kumaş-only)", snapshot: sampleEnvelope(base()) },
    { ad: "tek_kalem", aciklama: "Tek top + tek iplik kalemi", snapshot: sampleEnvelope(single) },
    {
      ad: "cok_sayfa",
      aciklama: "60 top + 6 iplik — liste birden çok sayfaya taşar",
      snapshot: sampleEnvelope(multi),
      ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-09-25T09:00:00.000Z", basan: "admin", not: "Acil" } },
    },
    { ad: "bos_opsiyonel", aciklama: "Opsiyonel alanların tümü boş/eksik (eski snapshot)", snapshot: sampleEnvelope(empty) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren adlar; 999 cm en sınırı", snapshot: sampleEnvelope(long) },
    {
      ad: "iptal",
      aciklama: "İptal edilmiş (VOIDED) ikinci sürüm",
      snapshot: sampleEnvelope(base()),
      ek: { baski: { surum: 2, durum: "VOIDED", iptalNedeni: "Yanlış tedarikçi" } },
    },
  ];
}

export const goodsReceiptContract: DocumentContract<WarehouseConfig, never> = {
  docType: "GOODS_RECEIPT",
  hedef: "ic",
  contractVersion: 1,
  kokler: ROOT_FIELDS,
  tablolar: [LETTERHEAD_EXTRA_TABLE, ROLL_TABLE, YARN_TABLE],
  ayarSemasi: baseConfigSchema(Object.keys(SECTIONS), [["rollTable", "toplar"]]),
  ayarNormalize: normalizeGoodsReceiptConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
