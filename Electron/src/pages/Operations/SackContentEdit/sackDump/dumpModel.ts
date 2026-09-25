import type { SackDumpNameMode } from "@/lib/shipping-flags";
// =============================================================================
// Çuval İÇERİK DÖKÜMÜ — TEK MODEL (PDF/yazdır ve Excel ikisi de buradan türer)
// =============================================================================
// Aynı belgenin PDF'i ile Excel'i aynı kolonu, satırı ve değeri taşır (kullanıcı
// kuralı 2026-09-25). Kolon listesi, başlık, boş hücre gösterimi ve alt toplam
// metni YALNIZ burada kurulur; `dumpHtml` ve `dumpSheets` yalnız biçimler.
// =============================================================================

import { dumpTotalQty, type SackDump, type SackDumpOptions, type SackDumpRoll } from "./types";

/** Hücre türü — HTML metnini ve Excel sayı biçimini BİRLİKTE belirler. */
export type DumpKind = "text" | "qty" | "int" | "cm";
export type DumpCell = string | number | null;

export interface DumpColumn {
  key: string;
  label: string;
  kind: DumpKind;
}

export interface DumpTable {
  columns: DumpColumn[];
  rows: DumpCell[][];
  /** Toplam satırı (kolon sırasıyla) — yoksa null. */
  foot: DumpCell[] | null;
}

export interface DumpSackSection {
  sackNo: string;
  /** Çuval başlık bilgileri — [etiket, değer]. */
  meta: Array<[string, string]>;
  /** Çuval notu — yalnız `withNotes` açıkken (iç not OPT-IN). */
  note: string | null;
  /** Top tablosu; çuval boşsa null (iki çıktı da "Çuval boş" yazar). */
  rolls: DumpTable | null;
  /** Kartela tablosu; kartela yoksa null. */
  swatches: DumpTable | null;
}

export interface DumpModel {
  title: string;
  /** "3 çuval · 5 top · 1.356,85 m · Basım: …" */
  docMeta: string;
  /** Çok çuvallı dökümde çuval başına bir satır + TOPLAM; tek çuvalda null. */
  summary: DumpTable | null;
  sacks: DumpSackSection[];
}

export const EMPTY_SACK_TEXT = "Çuval boş — top yok.";
export const DASH = "—";

/** Metre/kg: en çok 3 ondalık (veri Decimal(x,3)); toplamdaki kayan nokta artığı temizlenir. */
const q3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Hücrenin PDF'te görünen metni — Excel'in sayı biçimi aynı metni üretir. */
export function dumpCellText(kind: DumpKind, v: DumpCell): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (kind === "int") return String(v);
  const s = v.toLocaleString("tr-TR", { maximumFractionDigits: 3 });
  return kind === "cm" ? `${s} cm` : s;
}

const orDash = (s: string | null | undefined): string => (s && s.trim() ? s : DASH);

/** Ad kolonları — sevk irsaliyesindeki düzen: bizim adlarımız, sonra müşterinin. */
function nameColumns(mode: SackDumpNameMode): DumpColumn[] {
  return [
    ...(mode === "musterideki" ? [] : [{ key: "item", label: "Kumaş", kind: "text" as const }, { key: "color", label: "Renk", kind: "text" as const }]),
    ...(mode === "bizdeki"
      ? []
      : [{ key: "musteriItem", label: "Müşteri kumaş", kind: "text" as const }, { key: "musteriColor", label: "Müşteri renk", kind: "text" as const }]),
  ];
}

/**
 * Ad hücreleri — müşteri karşılığı YOKSA boş: bizim adımızı oraya koymak
 * "müşteri bunu böyle çağırıyor" yalanını üretirdi.
 */
function nameCells(
  mode: SackDumpNameMode,
  x: { itemName: string; colorName: string | null; musteriItemName?: string | null; musteriColorName?: string | null },
): DumpCell[] {
  return [
    ...(mode === "musterideki" ? [] : [orDash(x.itemName), x.colorName ?? "Ham"]),
    ...(mode === "bizdeki" ? [] : [x.musteriItemName ?? "", x.musteriColorName ?? ""]),
  ];
}

/** Topun ÜSTÜNDEKİ kâğıt: basılmamış · bayat · güncel — tek metin. */
function etiketText(r: SackDumpRoll): string {
  if (!r.etiketBasildi) return "basılmamış";
  return `${r.etiketBayat ? "BAYAT — " : ""}${r.etiketAd ?? "(ad kayıtlı değil)"}`;
}

function rollTable(d: SackDump, mode: SackDumpNameMode): DumpTable | null {
  if (d.rolls.length === 0) return null;
  const columns: DumpColumn[] = [
    { key: "barcode", label: "Barkod", kind: "text" },
    ...nameColumns(mode),
    { key: "etiket", label: "Etikette", kind: "text" },
    { key: "width", label: "En", kind: "cm" },
    { key: "qty", label: "Metre", kind: "qty" },
    { key: "quality", label: "Kalite", kind: "text" },
  ];
  const rows = d.rolls.map((r): DumpCell[] => [
    r.barcode ?? "Açık Kumaş",
    ...nameCells(mode, r),
    etiketText(r),
    r.width ?? DASH,
    q3(r.qty),
    orDash(r.qualityGrade),
  ]);
  const foot = columns.map((c, i): DumpCell => (i === 0 ? `TOPLAM (${d.rolls.length} top)` : c.key === "qty" ? q3(dumpTotalQty(d)) : null));
  return { columns, rows, foot };
}

function swatchTable(d: SackDump, mode: SackDumpNameMode): DumpTable | null {
  if (d.swatches.length === 0) return null;
  return {
    columns: [{ key: "barcode", label: "Barkod", kind: "text" }, ...nameColumns(mode)],
    rows: d.swatches.map((s): DumpCell[] => [s.barcode ?? "Kartela", ...nameCells(mode, s)]),
    foot: null,
  };
}

function sackMeta(d: SackDump): Array<[string, string]> {
  return [
    ["Müşteri", d.customerName ?? "Müşterisiz (genel stok)"],
    ...(d.branchName ? [["Şube", d.branchName] as [string, string]] : []),
    ...(d.branchCode ? [["İhracat Kodu", d.branchCode] as [string, string]] : []),
    ["Top", String(d.rolls.length)],
    ["Metre", dumpCellText("qty", q3(dumpTotalQty(d)))],
    // Tartılmamış çuvalda 0 yazılmaz — "0 kg" ile "tartılmadı" farklı bilgi.
    ["Kg", d.weightKg != null ? dumpCellText("qty", d.weightKg) : "tartılmadı"],
    ...(d.swatches.length > 0 ? [["Kartela", String(d.swatches.length)] as [string, string]] : []),
    ...(d.shipmentNo ? [["Sevkiyat", d.shipmentNo] as [string, string]] : []),
  ];
}

/** Çok çuvallı dökümün özeti — çuval başına satır + TOPLAM. */
function summaryTable(dumps: SackDump[]): DumpTable {
  const columns: DumpColumn[] = [
    { key: "sackNo", label: "Çuval No", kind: "text" },
    { key: "customer", label: "Müşteri", kind: "text" },
    { key: "branch", label: "Şube", kind: "text" },
    { key: "branchCode", label: "İhracat Kodu", kind: "text" },
    { key: "rollCount", label: "Top", kind: "int" },
    { key: "qty", label: "Metre", kind: "qty" },
    { key: "weightKg", label: "Kg", kind: "qty" },
    { key: "swatchCount", label: "Kartela", kind: "int" },
    { key: "shipmentNo", label: "Sevkiyat", kind: "text" },
  ];
  const rows = dumps.map((d): DumpCell[] => [
    d.sackNo,
    d.customerName ?? "Müşterisiz (genel stok)",
    orDash(d.branchName),
    orDash(d.branchCode),
    d.rolls.length,
    q3(dumpTotalQty(d)),
    d.weightKg ?? "tartılmadı",
    d.swatches.length,
    orDash(d.shipmentNo),
  ]);
  const weighed = dumps.filter((d) => d.weightKg != null);
  const foot: DumpCell[] = [
    `TOPLAM (${dumps.length} çuval)`,
    null,
    null,
    null,
    dumps.reduce((a, d) => a + d.rolls.length, 0),
    q3(dumps.reduce((a, d) => a + dumpTotalQty(d), 0)),
    weighed.length > 0 ? q3(weighed.reduce((a, d) => a + (d.weightKg ?? 0), 0)) : "tartılmadı",
    dumps.reduce((a, d) => a + d.swatches.length, 0),
    null,
  ];
  return { columns, rows, foot };
}

/**
 * Döküm → tek model. `now` yalnız testte verilir (basım damgası deterministik olsun).
 *
 * Kapsam etiketi (grup dökümü) başlığa girer: grup adı (P1, P2…) bir KİMLİK DEĞİL
 * PARK YERİDİR ve yeniden kullanılır; kâğıdı ayırt eden kapsam + basım anıdır.
 */
export function buildSackDumpModel(dumps: SackDump[], opts: SackDumpOptions = {}, now: Date = new Date()): DumpModel {
  const mode: SackDumpNameMode = opts.nameMode ?? "ikisi";
  const customers = [...new Set(dumps.map((d) => d.customerName).filter((v): v is string => !!v))];
  const scope = opts.scopeLabel && customers.length === 1 ? `${customers[0]} — ${opts.scopeLabel}` : opts.scopeLabel;
  const title = scope
    ? `ÇUVAL İÇERİK DÖKÜMÜ — ${scope}`
    : dumps.length === 1
      ? `ÇUVAL İÇERİK DÖKÜMÜ — ${dumps[0]!.sackNo}`
      : `ÇUVAL İÇERİK DÖKÜMÜ — ${dumps.length} çuval`;
  const totalRolls = dumps.reduce((a, d) => a + d.rolls.length, 0);
  const totalQty = q3(dumps.reduce((a, d) => a + dumpTotalQty(d), 0));
  const docMeta = [
    `${dumps.length} çuval`,
    `${totalRolls} top`,
    `${dumpCellText("qty", totalQty)} m`,
    `Basım: ${now.toLocaleString("tr-TR")}`,
    ...(opts.withNotes ? ["çuval notları dahil"] : []),
  ].join(" · ");
  return {
    title,
    docMeta,
    summary: dumps.length > 1 ? summaryTable(dumps) : null,
    sacks: dumps.map((d) => ({
      sackNo: d.sackNo,
      meta: sackMeta(d),
      note: opts.withNotes && d.notes ? d.notes : null,
      rolls: rollTable(d, mode),
      swatches: swatchTable(d, mode),
    })),
  };
}
