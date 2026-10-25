// =============================================================================
// Depo belgelerinin (transfer, mal kabul, stok sayımı) ORTAK sözleşme parçası
// =============================================================================
// Üç belge `document-render/warehouse-doc.html.ts`in tek gövdesini paylaşır; aynı ayar
// anahtarları, top tablosu ve kök alanlar burada bir kez beyan edilir ki üç eşlenik
// aynı veriyi farklı adla görmesin. Ayar normalizasyonu fason ortak parçasından gelir.
// =============================================================================

import type { DocColSpec } from "../../document-render/doc-model";
import { DOC_STATUS_FIELDS, asNumber, asRows, asText, fillFields } from "./ortak";
import { normalizeBase, resolveColumns, sanitizeRawConfig, type BaseDocConfig, type SectionDefaults } from "./subcontractor-common";
import type { ContextObject, FieldDef, TableDef } from "./tipler";

export type WarehouseConfig = BaseDocConfig;

/** Üç belgenin ortak bölüm anahtarları — renderer `!== false` okur (anahtar yoksa AÇIK). */
export const WAREHOUSE_SECTIONS = { documentNo: true, date: true, createdBy: true, rollTable: true } as const;

/**
 * Belge başlığı kökleri. İç belgedir (`hedef: ic`) ama renderer hiçbir alanı opt-in'e
 * bağlamaz → alanlar varsayılan basılan sınıftadır (`musteri`); iç alan beyanı yok.
 */
export function headFields(noLabel: string, noSample: string, title: string, docType: string): FieldDef[] {
  return [
    { yol: "belge.no", etiket: noLabel, tur: "metin", sinif: "musteri", ornek: noSample },
    { yol: "belge.tur", etiket: "Belge türü", tur: "metin", sinif: "musteri", ornek: docType },
    { yol: "belge.baslik", etiket: "Belge başlığı", tur: "metin", sinif: "musteri", ornek: title },
    { yol: "belge.tarih", etiket: "Belge tarihi", tur: "tarih", sinif: "musteri", ornek: "2026-09-25T08:30:00.000Z" },
    ...DOC_STATUS_FIELDS,
  ];
}

/** Transfer ve mal kabulün top tablosu (renderer kolonları: barcode, itemColor, width, qty). */
export function rollTableDef(label: string): TableDef {
  return {
    anahtar: "toplar",
    etiket: label,
    kolonlar: [
      { yol: "barkod", etiket: "Barkod", tur: "metin", sinif: "musteri", ornek: "T130826F0101", hiza: "l", kaynakKolon: "barcode" },
      { yol: "urun", etiket: "Ürün", tur: "metin", sinif: "musteri", ornek: "Perde Kumaşı", hiza: "l", kaynakKolon: "itemColor" },
      { yol: "renk", etiket: "Renk (ürünle aynı hücrede)", tur: "metin", sinif: "musteri", ornek: "Ekru", hiza: "l" },
      { yol: "en", etiket: "En", tur: "sayi", ondalik: 0, birim: "cm", sinif: "musteri", ornek: 300, hiza: "c", kaynakKolon: "width" },
      {
        yol: "metre", etiket: "Metre", tur: "sayi", ondalik: 2, birim: "m", sinif: "musteri", ornek: 120,
        hiza: "r", kaynakKolon: "qty", toplam: "metre",
      },
    ],
  };
}

const TEXT = { t: "text" } as const;
/** Renderer kolonlarının eşi (anahtar/başlık/hiza) — kolon düzeni renderer'ın çözücüsünden. */
export const ROLL_SPECS: DocColSpec<never>[] = [
  { key: "barcode", label: "BARKOD", align: "l", cellClass: "mono", kind: TEXT, value: () => null },
  { key: "itemColor", label: "ÜRÜN / RENK", align: "l", kind: TEXT, value: () => null },
  { key: "width", label: "EN", align: "c", width: "60px", kind: { t: "int", suffix: " cm" }, value: () => null },
  { key: "qty", label: "METRE", align: "r", width: "90px", kind: { t: "num", dec: 2 }, value: () => null, foot: { value: null } },
];

export function normalizeWarehouse(
  raw: unknown,
  opts: { sections: SectionDefaults; signatureDefaults: readonly string[]; rollTable: TableDef; specs: DocColSpec<never>[] },
): WarehouseConfig {
  const base = normalizeBase(sanitizeRawConfig(raw), { sections: opts.sections, signatureDefaults: opts.signatureDefaults, marginMm: 9, tables: ["rollTable"] });
  return { ...base, kolonlar: { toplar: resolveColumns(opts.rollTable, opts.specs, base.columns.rollTable!) } };
}

/** Transfer/mal kabul top satırları + toplamları (toplam şablonda hesaplanmaz). */
export function rollRows(table: TableDef, lines: unknown, optIn: ReadonlySet<string>): { rows: ContextObject[]; metre: number } {
  const src = asRows(lines);
  const rows = src.map((l) =>
    fillFields(
      table.kolonlar,
      { barkod: asText(l.barcode), urun: asText(l.itemName), renk: asText(l.colorName), en: asNumber(l.width), metre: asNumber(l.qty) },
      optIn,
    ),
  );
  return { rows, metre: src.reduce((s, l) => s + (Number(l.qty) || 0), 0) };
}

export const ROLL_TOTAL_FIELDS: FieldDef[] = [
  { yol: "toplamlar.top_adedi", etiket: "Top adedi", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 2 },
  { yol: "toplamlar.metre", etiket: "Toplam metre", tur: "sayi", ondalik: 2, birim: "m", sinif: "musteri", ornek: 205.5 },
];
