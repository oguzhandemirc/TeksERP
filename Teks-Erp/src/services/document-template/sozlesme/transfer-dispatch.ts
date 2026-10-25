// =============================================================================
// TRANSFER_DISPATCH (Depo Transfer İrsaliyesi) veri sözleşmesi
// =============================================================================
// Sistem renderer'ı (`document-render/warehouse-doc.html.ts` `renderWarehouseTransferHtml`)
// DEĞİŞMEZ ve yalnız okunur. İç belgedir; karşı taraf yoktur — çıkan/giren depo `belge`dedir.
// Toplam metre ve top adedi burada hesaplanır; şablon hesap yapmaz.
// =============================================================================

import { docTitle } from "../../document-render/doc-style";
import type { PrintedDocSnapshot } from "../../printed-document.service";
import {
  COMPANY_FIELDS,
  LETTERHEAD_EXTRA_TABLE,
  PRINT_FIELDS,
  asObject,
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
import type { BuildExtras, ContextObject, ContextValue, DocumentContract, FieldDef, Scenario, TemplateContext } from "./tipler";
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

const TITLE = "DEPO TRANSFER İRSALİYESİ";
const ROLL_TABLE = rollTableDef("Taşınan toplar");

const ROOT_FIELDS: FieldDef[] = [
  ...headFields("Transfer no", sampleSeriesCode("warehouseTransfer", 1), TITLE, "TRANSFER_DISPATCH"),
  { yol: "belge.cikan_depo", etiket: "Çıkan depo", tur: "metin", sinif: "musteri", ornek: "Merkez Depo" },
  { yol: "belge.cikan_depo_kod", etiket: "Çıkan depo kodu", tur: "metin", sinif: "musteri", ornek: "DP-MERKEZ" },
  { yol: "belge.giren_depo", etiket: "Giren depo", tur: "metin", sinif: "musteri", ornek: "Şube Deposu" },
  { yol: "belge.giren_depo_kod", etiket: "Giren depo kodu", tur: "metin", sinif: "musteri", ornek: sampleSeriesCode("warehouse", 2) },
  { yol: "belge.duzenleyen", etiket: "Düzenleyen", tur: "metin", sinif: "musteri", ornek: "Mehmet Yılmaz" },
  { yol: "belge.notlar", etiket: "Not", tur: "metin", sinif: "musteri", ornek: "Şube talebi üzerine sevk edildi" },
  ...COMPANY_FIELDS,
  ...ROLL_TOTAL_FIELDS,
  ...PRINT_FIELDS,
];

export function normalizeTransferConfig(raw: unknown): WarehouseConfig {
  return normalizeWarehouse(raw, {
    sections: WAREHOUSE_SECTIONS,
    signatureDefaults: ["Teslim Eden", "Teslim Alan"],
    rollTable: ROLL_TABLE,
    specs: ROLL_SPECS,
  });
}

function buildContext(snapshot: PrintedDocSnapshot, rawConfig: unknown, internalFields: readonly string[], extras?: BuildExtras<never>): TemplateContext {
  const config = normalizeTransferConfig(rawConfig);
  const optIn = new Set(internalFields);
  const doc = asObject(snapshot?.doc);
  const h = asObject(doc.header);
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject =>
    fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);
  const rolls = rollRows(ROLL_TABLE, doc.lines, optIn);

  return {
    belge: root("belge", {
      no: asText(h.documentNo),
      tur: "TRANSFER_DISPATCH",
      baslik: docTitle(config.titleOverride, TITLE),
      tarih: asText(h.date),
      ...docStatus(extras?.baski),
      cikan_depo: asText(h.fromWarehouseName),
      cikan_depo_kod: asText(h.fromWarehouseCode),
      giren_depo: asText(h.toWarehouseName),
      giren_depo_kod: asText(h.toWarehouseCode),
      duzenleyen: asText(h.createdBy),
      notlar: asText(doc.notes),
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: {},
    tablolar: { antet_ek: letterheadExtraRows(snapshot).map((r) => fillFields(LETTERHEAD_EXTRA_TABLE.kolonlar, r, optIn)), toplar: rolls.rows },
    toplamlar: root("toplamlar", { top_adedi: rolls.rows.length, metre: rolls.metre }),
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: {},
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("TRANSFER_DISPATCH");
  const header = (d: Row) => d.header as Row;
  const line = (i: number, width: number | null = 300, qty = 100 + i): Row => ({
    barcode: `T130826F${String(100 + i).padStart(4, "0")}`, itemName: "Perde Kumaşı", colorName: "Ekru", width, qty,
  });

  const single = base();
  single.lines = [line(1, 300, 120)];

  const multi = base();
  multi.lines = Array.from({ length: 60 }, (_, i) => line(i + 1, i % 3 === 0 ? 299.6 : 300, 80 + (i % 7) * 12.25));

  const empty: Row = {
    header: {
      documentNo: sampleSeriesCode("warehouseTransfer", 2), date: null, fromWarehouseName: "Merkez Depo", fromWarehouseCode: null,
      toWarehouseName: "Şube Deposu", toWarehouseCode: null, createdBy: null,
    },
    lines: [{ barcode: null, itemName: "Tül", colorName: null, width: null, qty: 0 }],
    notes: null,
  };

  const long = base();
  long.header = {
    ...header(long), fromWarehouseName: longText("Çok Uzun Adlı Ana Hammadde Deposu"), toWarehouseCode: "DP-<02>",
    createdBy: longText("Düzenleyen Kişi", 60),
  };
  long.notes = longText("Şube talebi üzerine sevk edildi; iki top kenar kırık");
  long.lines = [...(long.lines as Row[]), { ...line(3, 999), itemName: longText("Süet Kumaş", 120) }, line(4, 999.4, 1234.567)];

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek transferi", snapshot: sampleEnvelope(base()) },
    { ad: "tek_kalem", aciklama: "Tek top", snapshot: sampleEnvelope(single) },
    {
      ad: "cok_sayfa",
      aciklama: "60 top — liste birden çok sayfaya taşar",
      snapshot: sampleEnvelope(multi),
      ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-09-25T09:00:00.000Z", basan: "admin", not: "Acil" } },
    },
    { ad: "bos_opsiyonel", aciklama: "Opsiyonel alanların tümü boş/eksik", snapshot: sampleEnvelope(empty) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren adlar; 999 cm en sınırı", snapshot: sampleEnvelope(long) },
    {
      ad: "iptal",
      aciklama: "İptal edilmiş (VOIDED) ikinci sürüm",
      snapshot: sampleEnvelope(base()),
      ek: { baski: { surum: 2, durum: "VOIDED", iptalNedeni: "Yanlış hedef depo" } },
    },
  ];
}

export const transferDispatchContract: DocumentContract<WarehouseConfig, never> = {
  docType: "TRANSFER_DISPATCH",
  hedef: "ic",
  contractVersion: 1,
  kokler: ROOT_FIELDS,
  tablolar: [LETTERHEAD_EXTRA_TABLE, ROLL_TABLE],
  ayarSemasi: baseConfigSchema(Object.keys(WAREHOUSE_SECTIONS), [["rollTable", "toplar"]]),
  ayarNormalize: normalizeTransferConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
