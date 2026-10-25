// =============================================================================
// STOCK_COUNT (Stok Sayım Tutanağı) veri sözleşmesi
// =============================================================================
// Sistem renderer'ı (`document-render/warehouse-doc.html.ts` `renderStockCountHtml`) DEĞİŞMEZ
// ve yalnız okunur. `belge.kesinlesti` alanı olmayan eski snapshot'ta `true`dur (o tarihte
// belge yalnız tamamlamada donuyordu). Durum etiketi zaman kipi taşır; şablon kodla seçer.
// =============================================================================

import { docTitle } from "../../document-render/doc-style";
import type { PrintedDocSnapshot } from "../../printed-document.service";
import {
  LETTERHEAD_EXTRA_TABLE,
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
import {
  STOCK_COUNT_ROLL_SPECS,
  STOCK_COUNT_ROLL_TABLE,
  STOCK_COUNT_ROOT_FIELDS,
  STOCK_COUNT_SECTIONS,
  STOCK_COUNT_TITLE,
  STOCK_COUNT_YARN_TABLE,
} from "./stock-count.fields";
import { baseConfigSchema, plainJson } from "./subcontractor-common";
import type { BuildExtras, ContextObject, ContextValue, DocumentContract, Scenario, TemplateContext } from "./tipler";
import { normalizeWarehouse, type WarehouseConfig } from "./warehouse-common";

type Row = Record<string, unknown>;

export function normalizeStockCountConfig(raw: unknown): WarehouseConfig {
  return normalizeWarehouse(raw, {
    sections: STOCK_COUNT_SECTIONS,
    signatureDefaults: ["Sayan", "Kontrol Eden", "Onaylayan"],
    rollTable: STOCK_COUNT_ROLL_TABLE,
    specs: STOCK_COUNT_ROLL_SPECS,
  });
}

/** Fark özeti — snapshot `summary`sinden birebir (yoksa özet basılmaz, iplik farkı 0). */
function summaryTotals(s: Row | null): Record<string, ContextValue> {
  const n = (k: string) => (s ? asNumber(s[k]) : null);
  return {
    ozet_var: s !== null,
    sayim_top_toplam: n("rollTotal"),
    bulunan_top: n("rollFound"),
    eksik_top: n("rollMissing"),
    sayilmayan_top: n("rollUncounted"),
    kapsam_disi_top: n("rollOutOfScope"),
    ozet_beklenen_metre: n("expectedMeters"),
    eksik_metre: n("missingMeters"),
    sayim_iplik_toplam: n("yarnTotal"),
    uygulanan_iplik: n("yarnApplied"),
    sayilmayan_iplik: n("yarnUncounted"),
    kapsam_disi_iplik: n("yarnOutOfScope"),
    iplik_fark_kg: n("yarnDiffKg") ?? 0,
  };
}

function buildContext(snapshot: PrintedDocSnapshot, rawConfig: unknown, internalFields: readonly string[], extras?: BuildExtras<never>): TemplateContext {
  const config = normalizeStockCountConfig(rawConfig);
  const optIn = new Set(internalFields);
  const doc = asObject(snapshot?.doc);
  const h = asObject(doc.header);
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject =>
    fillFields(rootFields(STOCK_COUNT_ROOT_FIELDS, rootKey), values, optIn);
  const rolls = asRows(doc.rollLines);
  const yarn = asRows(doc.yarnLines);
  const summary = doc.summary && typeof doc.summary === "object" ? asObject(doc.summary) : null;

  return {
    belge: root("belge", {
      no: asText(h.documentNo),
      tur: "STOCK_COUNT",
      baslik: docTitle(config.titleOverride, STOCK_COUNT_TITLE),
      tarih: asText(h.date),
      ...docStatus(extras?.baski),
      depo: asText(h.warehouseName),
      depo_kod: asText(h.warehouseCode),
      acan: asText(h.createdBy),
      tamamlayan: asText(h.completedBy),
      sayim_durumu: asText(h.status),
      kesinlesti: h.finalized !== false,
      notlar: asText(doc.notes),
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: {},
    tablolar: {
      antet_ek: letterheadExtraRows(snapshot).map((r) => fillFields(LETTERHEAD_EXTRA_TABLE.kolonlar, r, optIn)),
      toplar: rolls.map((l) =>
        fillFields(
          STOCK_COUNT_ROLL_TABLE.kolonlar,
          {
            barkod: asText(l.barcode), urun: asText(l.itemName), renk: asText(l.colorName), en: asNumber(l.width),
            beklenen: asNumber(l.expectedQty), sayilan: asNumber(l.countedQty), dusulen: asNumber(l.appliedQty),
            durum: asText(l.state), kapsam_disi_nedeni: asText(l.outOfScopeReason), notlar: asText(l.notes),
          },
          optIn,
        ),
      ),
      iplik: yarn.map((y) =>
        fillFields(
          STOCK_COUNT_YARN_TABLE.kolonlar,
          {
            ad: asText(y.itemName), beklenen_kg: asNumber(y.expectedKg), sayilan_kg: asNumber(y.countedKg), fark_kg: asNumber(y.diffKg),
            durum: asText(y.state), kapsam_disi_nedeni: asText(y.outOfScopeReason),
          },
          optIn,
        ),
      ),
    },
    toplamlar: root("toplamlar", {
      top_adedi: rolls.length,
      iplik_kalem: yarn.length,
      beklenen_metre: rolls.reduce((a, l) => a + (Number(l.expectedQty) || 0), 0),
      ...summaryTotals(summary),
    }),
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: {},
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("STOCK_COUNT");
  const header = (d: Row) => d.header as Row;
  const STATES = ["FOUND", "MISSING", "UNCOUNTED", "OUT_OF_SCOPE"] as const;
  const roll = (i: number, state: (typeof STATES)[number] = "FOUND", expectedQty = 100 + i): Row => ({
    barcode: `T150826F${String(300 + i).padStart(4, "0")}`, itemName: "Perde Kumaşı", colorName: "Ekru", width: 300, expectedQty,
    countedQty: state === "FOUND" ? expectedQty : null, state, outOfScopeReason: state === "OUT_OF_SCOPE" ? "Bu sırada sevk edildi" : null, notes: null,
  });

  const single = base();
  single.rollLines = [roll(1)];
  single.yarnLines = [];
  single.summary = { ...(single.summary as Row), rollTotal: 1, rollFound: 1, rollMissing: 0, rollUncounted: 0, rollOutOfScope: 0,
    expectedMeters: 101, missingMeters: 0, yarnTotal: 0, yarnApplied: 0, yarnOutOfScope: 0, yarnDiffKg: 0 };

  const multi = base();
  multi.rollLines = Array.from({ length: 60 }, (_, i) => roll(i + 1, STATES[i % 4], 50 + (i % 9) * 11.75));
  // Düşülen ≠ fotoğraf: kâğıt sapma defteriyle aynı (uygulanan) rakamı söyler.
  (multi.rollLines as Row[])[1]!.appliedQty = 40.5;
  (multi.rollLines as Row[])[5]!.appliedQty = (multi.rollLines as Row[])[5]!.expectedQty;

  // Taslak önizleme: fark henüz uygulanmadı → "işaretlendi" / "uygulanmadı" kipi.
  const draft = base();
  draft.header = { ...header(draft), status: "Taslak", completedBy: null, finalized: false };

  // 2026-08-15 öncesi snapshot şekli: `finalized` ve özet yok, iplik yok, opsiyoneller boş.
  const empty: Row = {
    header: {
      documentNo: sampleSeriesCode("stockCount", 2), date: null, warehouseName: "Merkez Depo", warehouseCode: null,
      createdBy: null, completedBy: null, status: "Tamamlandı",
    },
    rollLines: [{ barcode: null, itemName: "Tül", colorName: null, width: null, expectedQty: 0, countedQty: null, state: "MISSING", outOfScopeReason: null, notes: null }],
    yarnLines: [],
    notes: null,
  };

  const long = base();
  long.header = { ...header(long), warehouseName: longText("Çok Uzun Adlı Sevkiyat Ara Deposu"), warehouseCode: "DP-<01>", createdBy: longText("Sayımı Açan", 60) };
  long.notes = longText("Yıl sonu tam sayımı; raf 3 eksik");
  long.rollLines = [
    ...(long.rollLines as Row[]),
    { ...roll(5, "MISSING", 999.4), itemName: longText("Süet Kumaş", 120), appliedQty: 998.25, notes: longText("Rafta bulunamadı", 80) },
    { ...roll(6, "OUT_OF_SCOPE"), outOfScopeReason: longText("Sayım sırasında başka depoya transfer edildi", 90) },
  ];

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek tutanağı (dört durumun dördü)", snapshot: sampleEnvelope(base()) },
    { ad: "tek_kalem", aciklama: "Tek top, iplik yok", snapshot: sampleEnvelope(single) },
    {
      ad: "cok_sayfa",
      aciklama: "60 top — liste birden çok sayfaya taşar; uygulanan ≠ fotoğraf satırı",
      snapshot: sampleEnvelope(multi),
      ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-09-25T09:00:00.000Z", basan: "admin", not: "Acil" } },
    },
    { ad: "bos_opsiyonel", aciklama: "Eski snapshot: kesinleşme bayrağı ve fark özeti yok", snapshot: sampleEnvelope(empty) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren adlar, sebepler, notlar", snapshot: sampleEnvelope(long) },
    { ad: "taslak", aciklama: "Tamamlanmamış sayımın önizlemesi (fark uygulanmadı)", snapshot: sampleEnvelope(draft) },
    {
      ad: "iptal",
      aciklama: "İptal edilmiş (VOIDED) ikinci sürüm",
      snapshot: sampleEnvelope(base()),
      ek: { baski: { surum: 2, durum: "VOIDED", iptalNedeni: "Yanlış depo sayıldı" } },
    },
  ];
}

export const stockCountContract: DocumentContract<WarehouseConfig, never> = {
  docType: "STOCK_COUNT",
  hedef: "ic",
  contractVersion: 1,
  kokler: STOCK_COUNT_ROOT_FIELDS,
  tablolar: [LETTERHEAD_EXTRA_TABLE, STOCK_COUNT_ROLL_TABLE, STOCK_COUNT_YARN_TABLE],
  ayarSemasi: baseConfigSchema(Object.keys(STOCK_COUNT_SECTIONS), [["rollTable", "toplar"]]),
  ayarNormalize: normalizeStockCountConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
