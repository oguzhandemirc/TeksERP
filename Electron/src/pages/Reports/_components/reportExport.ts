// =============================================================================
// RAPOR DIŞA AKTARIM — TEK SPEC, ÜÇ ÇIKTI (Excel · PDF · Yazdır)
// =============================================================================
// Kural: bir rapor tablolarını BİR KEZ tanımlar (`ReportExportSpec`); Excel
// sayfaları, PDF ve yazıcı çıktısı hepsi o tek spec'ten türetilir.
//
// NEDEN BÖYLE: alternatif — her çıktı için ayrı kod — bu projede zaten bir kez
// ısırdı (kök CLAUDE.md'deki "aynı sevkiyat üç ekranda üç şey söyledi" vakası).
// Excel'i güncelleyip PDF'i unutmak, iki dosyanın aynı başlık altında farklı
// rakam taşıması demektir ve bunu kimse fark etmez çünkü ikisi ayrı ayrı
// "çalışıyor" görünür. Tek spec bu sınıfı YAPISAL olarak imkânsız kılar.
//
// Kapsam bilinçli olarak DAR: bu raporlar için basit, okunur bir A4 tablo
// çıktısı. Belge Şablonları / yoğunluk profilleri (`document-render/`) burada
// KULLANILMAZ — orası müşteriye giden resmi belgelerin dünyası (donmuş snapshot,
// versiyon, revizyon). Rapor çıktısı resmi belge değildir; karıştırılırsa rapor
// PDF'i sevk irsaliyesiyle aynı kurallara tabi olur ve ikisi de zarar görür.
// =============================================================================

import type { SheetSpec } from "@/lib/xlsx-export";
import { reportCellText, reportExcelNumFmt } from "@/lib/number-format";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import type { GrafikBlok } from "../_v2/sunum";
import type { Egilim } from "../_v2/grafik/secenek";
import { hasPlacement, LAYOUT_CSS, placedBodyHtml } from "./reportExportLayout";

export interface ReportColumn {
  header: string;
  /** `rows[]` / `totalRow` içindeki alan adı. */
  key: string;
  width?: number;
  /** Excel sayı biçimi — örn "#,##0.0" (metre), "#,##0" (adet), "0.0" (yüzde). */
  numFmt?: string;
  /** PDF/yazdırma hizası. Sayısal kolonlar sağa yaslanır. */
  align?: "left" | "right";
}

export interface ReportTableSpec {
  name: string;
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
  totalRow?: Record<string, unknown>;
  /** Tablonun ALTINA basılan bağlam notları — rakamla aynı dosyada dursun diye. */
  notes?: string[];
}

export interface ReportExportSpec {
  title: string;
  /** Dönem satırı — "01.07.2026 – 31.07.2026". */
  subtitle?: string;
  /** Başlığın altındaki bağlam satırları (karşılaştırma dönemi, kapsam uyarısı…). */
  meta?: string[];
  /** PDF/Yazdır sayfa yönü. Verilmezse `portrait` — mevcut çıktı bayt-bayt
   *  korunur. Çok kolonlu tablolar (örn. 18 kolonlu çek portföyü) `landscape`
   *  ister; Excel tarafını ETKİLEMEZ. */
  orientation?: "portrait" | "landscape";
  tables: ReportTableSpec[];
  // ---- Rapor v2 (R0-GRAFIK): yalnız `bloklar` doluyken basılır; yoksa çıktı bayt bayt eski ----
  /** Raporun cevapladığı soru ("Siparişler terminde gitti mi?"). */
  soru?: string;
  /** Seçili parametreler tek cümle ("Müşteri: Kaya Tekstil · Renk: tümü"). */
  parametreCumlesi?: string;
  /** Kıyas dönemi etiketi ("Eylül 2026"). */
  kiyasDonemi?: string;
  kullanici?: string;
  /** Basım anı; verilmezse çıktının kurulduğu an (fabrika diliminde basılır). */
  basimAni?: Date | string;
  uyarilar?: string[];
  /** Sırayla basılan bloklar; tablolar ilk `tanimlar` bloğundan önce (yoksa sona) girer. */
  bloklar?: ExportBlok[];
}

/** Ana/yan sayı kartı — GÖRÜNEN metinle (Excel "Özet" sayfası aynı metni taşır). */
export interface AnaSayiKarti {
  ad: string;
  deger: string;
  /** "▼ 6 puan (eylül %84)". */
  kiyas?: string;
  /** Tek ana sayı büyük basılır; diğerleri yan sayı. */
  ana?: boolean;
}

/** Özel rapor düzeni (R2-DUZEN): blok genişliği (12 sütundan) ve öncesinde sayfa kesmesi. Yoksa çıktı bayt bayt eski. */
export interface ExportPlacement {
  genislik?: number;
  sayfaKesmesi?: boolean;
}

export type ExportBlok = ExportBlockBody & ExportPlacement;

type ExportBlockBody =
  | { tur: "anaSayi"; kartlar: AnaSayiKarti[] }
  | { tur: "anlati"; cumleler: string[] }
  | {
      tur: "grafik";
      baslik: string;
      /** Çizim kaynağı; `svg` yoksa PDF/Yazdır anında ondan üretilir. */
      grafik?: GrafikBlok;
      /** Saçılım eğilim çizgisi uçları (sunucu) — yalnız GÖRSEL; Excel/veri tablosu etkilenmez. */
      egilim?: Egilim | null;
      svg?: string;
      /** Grafiğin veri tablosu — Excel'de ayrı sayfa, SVG yoksa PDF'te tablo. */
      veri: ReportTableSpec;
    }
  | { tur: "tanimlar"; satirlar: { ad: string; aciklama: string }[] }
  /** Düzendeki yerinde basılan tablo — Excel'de aynı spec'ten ayrı sayfa (PDF = Excel). */
  | { tur: "tablo"; tablo: ReportTableSpec }
  | { tur: "metin"; baslik?: string; metin: string };

const tableRowCount = (t: ReportTableSpec) => t.rows.length + (t.totalRow ? 1 : 0);

/** PDF satır kapısı için: bütün tabloların ve grafik veri tablolarının gövde satırları (toplam satırı dahil). */
export function reportRowCount(spec: ReportExportSpec): number {
  const grafik = (spec.bloklar ?? []).reduce((n, b) => n + (b.tur === "grafik" ? tableRowCount(b.veri) : b.tur === "tablo" ? tableRowCount(b.tablo) : 0), 0);
  return spec.tables.reduce((n, t) => n + tableRowCount(t), grafik);
}

const isV2 = (spec: ReportExportSpec): boolean => (spec.bloklar?.length ?? 0) > 0;

/** v2 üst bloğunun bağlam satırları — PDF başlığı ve Excel ön satırları AYNI metin. */
function v2ContextLines(spec: ReportExportSpec): string[] {
  const basim = fmtFactoryDateTime(spec.basimAni ?? new Date());
  return [
    ...(spec.soru ? [spec.soru] : []),
    ...(spec.subtitle ? [`Dönem: ${spec.subtitle}`] : []),
    ...(spec.kiyasDonemi ? [`Kıyas: ${spec.kiyasDonemi}`] : []),
    ...(spec.parametreCumlesi ? [spec.parametreCumlesi] : []),
    ...(spec.meta ?? []),
    `Basım: ${basim}${spec.kullanici ? ` · ${spec.kullanici}` : ""}`,
  ];
}

// ---------- Excel ------------------------------------------------------------

/**
 * Excel sayfaları — PDF'le AYNI başlık, kolon, hiza ve GÖRÜNEN metin.
 *
 * Başlık + dönem + bağlam satırları HER sayfanın ÜSTÜNE düşer: Excel'de sayfalar tek
 * tek kopyalanıp paylaşılıyor ve dönem bilgisi olmayan bir tablo yanlış okunur.
 * Sayı biçimi PDF'in kuralından türer (`reportExcelNumFmt`); biçimsiz kolondaki kesirli
 * sayı PDF'te ham `String(v)` basıldığı için Excel'e de o metin gider.
 */
export function toSheets(spec: ReportExportSpec): SheetSpec[] {
  if (isV2(spec)) return toSheetsV2(spec);
  const preamble = [[spec.title], ...(spec.subtitle ? [[spec.subtitle]] : []), ...(spec.meta ?? []).map((m) => [m])];
  return spec.tables.map((t) => tableToSheet(t, preamble));
}

function tableToSheet(t: ReportTableSpec, preamble: SheetSpec["preamble"]): SheetSpec {
  const cell = (c: ReportColumn, v: unknown) =>
    !c.numFmt && typeof v === "number" && !Number.isInteger(v) ? String(v) : v;
  const row = (r: Record<string, unknown>) => Object.fromEntries(t.columns.map((c) => [c.key, cell(c, r[c.key])]));
  return {
    name: t.name,
    preamble,
    columns: t.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width,
      ...(c.numFmt ? { numFmt: reportExcelNumFmt(c.numFmt) } : {}),
      ...(c.align ? { align: c.align } : {}),
    })),
    rows: t.rows.map(row),
    ...(t.totalRow ? { totalRow: row(t.totalRow) } : {}),
    ...(t.notes?.length ? { notes: t.notes } : {}),
  };
}

/**
 * v2 çalışma kitabı: "Özet" (ana sayı + anlatı + tanımlar + uyarılar) · her grafiğin
 * veri sayfası · tablolar. Her sayfanın üstünde PDF başlığının aynı bağlam satırları.
 */
function toSheetsV2(spec: ReportExportSpec): SheetSpec[] {
  const preamble = [[spec.title], ...v2ContextLines(spec).map((m) => [m])];
  const summaryRows: Array<Record<string, unknown>> = [];
  for (const b of spec.bloklar ?? []) {
    if (b.tur === "anaSayi")
      for (const k of b.kartlar) summaryRows.push({ b: k.ana ? "Ana sayı" : "Yan sayı", a: k.ad, d: k.deger, k: k.kiyas ?? "" });
    else if (b.tur === "anlati") for (const c of b.cumleler) summaryRows.push({ b: WHAT_WE_SEE, a: c, d: "", k: "" });
    else if (b.tur === "tanimlar") for (const t of b.satirlar) summaryRows.push({ b: WHAT_IT_COUNTS, a: t.ad, d: t.aciklama, k: "" });
    else if (b.tur === "metin") summaryRows.push({ b: "Not", a: b.baslik ?? "", d: b.metin, k: "" });
  }
  for (const u of spec.uyarilar ?? []) summaryRows.push({ b: "Uyarı", a: u, d: "", k: "" });
  const summarySheet: SheetSpec = {
    name: "Özet",
    preamble,
    columns: [
      { header: "Bölüm", key: "b", width: 18 },
      { header: "Ad", key: "a", width: 60 },
      { header: "Değer", key: "d", width: 40 },
      { header: "Kıyas", key: "k", width: 28 },
    ],
    rows: summaryRows,
  };
  // Grafik verisi ve düzen tabloları blok sırasıyla — PDF'teki sırayla aynı.
  const grafikler = (spec.bloklar ?? []).flatMap((b) => (b.tur === "grafik" ? [tableToSheet(b.veri, preamble)] : b.tur === "tablo" ? [tableToSheet(b.tablo, preamble)] : []));
  return [summarySheet, ...grafikler, ...spec.tables.map((t) => tableToSheet(t, preamble))];
}

// ---------- PDF / Yazdır -----------------------------------------------------

/** PDF/Yazdır hücresi — Excel'le ortak kural (`lib/number-format`). */
const fmtCell = reportCellText;

const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function tableHtml(t: ReportTableSpec): string {
  const head = t.columns
    .map((c) => `<th style="text-align:${c.align === "right" ? "right" : "left"}">${esc(c.header)}</th>`)
    .join("");
  const body = t.rows
    .map(
      (r) =>
        `<tr>${t.columns
          .map(
            (c) =>
              `<td style="text-align:${c.align === "right" ? "right" : "left"}">${esc(fmtCell(r[c.key], c.numFmt))}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  const total = t.totalRow
    ? `<tr class="tot">${t.columns
        .map(
          (c) =>
            `<td style="text-align:${c.align === "right" ? "right" : "left"}">${esc(fmtCell(t.totalRow?.[c.key], c.numFmt))}</td>`,
        )
        .join("")}</tr>`
    : "";
  const notes = (t.notes ?? []).map((n) => `<div class="note">${esc(n)}</div>`).join("");
  // Şablonun iç girintisi eski çıktının BAYTIDIR (geriye uyum altını) — düzeltme.
  return `<section class="tbl-wrap">
        <h2>${esc(t.name)}</h2>
        <table><thead><tr>${head}</tr></thead><tbody>${body}${total}</tbody></table>
        ${notes}
      </section>`;
}

/**
 * Yazdırılabilir A4 HTML. Tek dosya, gömülü stil — `printHtmlString` ve
 * `window.api.pdf.save` ikisi de tam belge bekler.
 *
 * ⚠️ Tablo başlığı `thead` içinde ve `display: table-header-group` ile: çok
 * sayfalı tabloda ikinci sayfa aksi halde kolon adı olmayan çıplak sayı bloğu
 * olarak basılır (aynı ders `DOC_PAGINATION_CSS`'te de öğrenilmişti).
 *
 * ⚠️ Değerler `esc` ile kaçırılır. Kumaş/renk adları fabrikanın yazdığı serbest
 * metindir; kaçırılmazsa bir "&" karakteri belgeyi bozar.
 */
export function buildReportHtml(spec: ReportExportSpec): string {
  if (isV2(spec)) return buildReportHtmlV2(spec);
  const tables = spec.tables.map(tableHtml).join("");

  const meta = (spec.meta ?? []).map((m) => `<div class="meta">${esc(m)}</div>`).join("");

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<title>${esc(spec.title)}</title>
<style>
  @page { size: A4 ${spec.orientation === "landscape" ? "landscape" : "portrait"}; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; color: #111; margin: 0; font-size: 11px; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .sub { font-size: 12px; color: #444; margin-bottom: 2px; }
  .meta { font-size: 10px; color: #555; }
  .hdr { border-bottom: 1.5px solid #111; padding-bottom: 6px; margin-bottom: 12px; }
  h2 { font-size: 12px; margin: 0 0 4px; }
  /* Tablo sayfa ortasından bölünebilir ama BAŞLIĞIYLA birlikte başlasın. */
  .tbl-wrap { margin-bottom: 14px; break-inside: auto; }
  h2 { break-after: avoid; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { border: 0.5px solid #bbb; padding: 3px 5px; }
  th { background: #eee; font-weight: 600; }
  tr.tot td { font-weight: 700; background: #f4f4f4; }
  .note { font-size: 9.5px; color: #555; font-style: italic; margin-top: 3px; }
</style></head><body>
<div class="hdr">
  <h1>${esc(spec.title)}</h1>
  ${spec.subtitle ? `<div class="sub">${esc(spec.subtitle)}</div>` : ""}
  ${meta}
</div>
${tables}
</body></html>`;
}

// ---------- Rapor v2 baskısı (R0-GRAFIK) -------------------------------------

const WHAT_WE_SEE = "Ne görüyoruz?";
const WHAT_IT_COUNTS = "Bu rapor ne sayar?";

function blockHtml(b: ExportBlok): string {
  switch (b.tur) {
    case "anaSayi":
      return `<section class="kartlar">${b.kartlar
        .map(
          (k) =>
            `<div class="kart${k.ana ? " ana" : ""}"><div class="kart-ad">${esc(k.ad)}</div><div class="kart-deger">${esc(k.deger)}</div>${
              k.kiyas ? `<div class="kart-kiyas">${esc(k.kiyas)}</div>` : ""
            }</div>`,
        )
        .join("")}</section>`;
    case "anlati":
      return `<section class="anlati"><h2>${WHAT_WE_SEE}</h2><ul>${b.cumleler.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></section>`;
    case "grafik":
      // SVG kendi çizimimizdir (ECharts SSR, metni kaçırır); yoksa veri tablosu basılır.
      return b.svg
        ? `<section class="grafik"><h2>${esc(b.baslik)}</h2><div class="svg">${b.svg}</div></section>`
        : tableHtml({ ...b.veri, name: b.baslik });
    case "tanimlar":
      return `<section class="tanimlar"><h2>${WHAT_IT_COUNTS}</h2><dl>${b.satirlar
        .map((t) => `<dt>${esc(t.ad)}</dt><dd>${esc(t.aciklama)}</dd>`)
        .join("")}</dl></section>`;
    case "tablo":
      return tableHtml(b.tablo);
    case "metin":
      return `<section class="metin">${b.baslik ? `<h2>${esc(b.baslik)}</h2>` : ""}<p>${esc(b.metin)}</p></section>`;
  }
}


/**
 * v2 A4 belgesi: üst blok (ad · soru · dönem · kıyas · parametreler · basım) → bloklar
 * sırayla → tablolar (ilk `tanimlar`dan önce) → uyarılar. Grafik `break-inside: avoid`,
 * renkler baskıda korunur (`print-color-adjust`), tablo başlığı her sayfada tekrar eder.
 */
function buildReportHtmlV2(spec: ReportExportSpec): string {
  const blocks = spec.bloklar ?? [];
  const tablesHtml = spec.tables.map(tableHtml).join("");
  const defsIndex = blocks.findIndex((b) => b.tur === "tanimlar");
  const before = defsIndex < 0 ? blocks : blocks.slice(0, defsIndex);
  const after = defsIndex < 0 ? [] : blocks.slice(defsIndex);
  const placed = hasPlacement(blocks);
  const body = placed
    ? [placedBodyHtml(blocks, blockHtml), tablesHtml].join("\n")
    : [...before.map(blockHtml), tablesHtml, ...after.map(blockHtml)].join("\n");
  const [question, ...context] = spec.soru ? v2ContextLines(spec) : ["", ...v2ContextLines(spec)];
  const printedLine = context.pop() ?? "";
  const warningsHtml = (spec.uyarilar ?? []).map((u) => `<div class="uyari">${esc(u)}</div>`).join("");

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<title>${esc(spec.title)}</title>
<style>
  @page { size: A4 ${spec.orientation === "landscape" ? "landscape" : "portrait"}; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; color: #111; margin: 0; font-size: 11px; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .soru { font-size: 12px; color: #333; font-style: italic; margin-bottom: 4px; }
  .meta { font-size: 10px; color: #555; }
  .basim { font-size: 9.5px; color: #666; margin-top: 3px; }
  .hdr { border-bottom: 1.5px solid #111; padding-bottom: 6px; margin-bottom: 12px; }
  h2 { font-size: 12px; margin: 0 0 4px; break-after: avoid; }
  section { margin-bottom: 14px; }
  .kartlar { display: flex; gap: 8px; flex-wrap: wrap; break-inside: avoid; }
  .kart { border: 0.5px solid #bbb; border-radius: 4px; padding: 6px 10px; min-width: 120px; break-inside: avoid; }
  .kart-ad { font-size: 9.5px; color: #555; }
  .kart-deger { font-size: 15px; font-weight: 700; }
  .kart.ana { border: 1px solid #1f4e9c; background: #eef3fb; }
  .kart.ana .kart-deger { font-size: 22px; }
  .kart-kiyas { font-size: 10px; color: #333; }
  .anlati { break-inside: avoid; }
  .anlati ul { margin: 0; padding-left: 16px; }
  .anlati li { margin-bottom: 2px; }
  .grafik { break-inside: avoid; }
  .grafik svg { display: block; width: 100%; max-width: 180mm; height: auto; }
  .tbl-wrap { break-inside: auto; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { border: 0.5px solid #bbb; padding: 3px 5px; }
  th { background: #eee; font-weight: 600; }
  tr.tot td { font-weight: 700; background: #f4f4f4; }
  .note { font-size: 9.5px; color: #555; font-style: italic; margin-top: 3px; }
  .tanimlar { break-inside: avoid; }
  .tanimlar dl { margin: 0; }
  .tanimlar dt { font-weight: 600; margin-top: 4px; }
  .tanimlar dd { margin: 0 0 2px 0; color: #333; }
  .uyari { font-size: 10px; color: #7a4b00; border-left: 2px solid #d9730d; padding-left: 6px; margin-top: 4px; }${placed ? LAYOUT_CSS : ""}
</style></head><body>
<div class="hdr">
  <h1>${esc(spec.title)}</h1>
  ${question ? `<div class="soru">${esc(question)}</div>` : ""}
  ${context.map((m) => `<div class="meta">${esc(m)}</div>`).join("")}
  <div class="basim">${esc(printedLine)}</div>
</div>
${body}
${warningsHtml}
</body></html>`;
}

/** Dosya adı gövdesi — Türkçe karakter / boşluk temizlenir. */
export function slugifyFileName(s: string): string {
  const map: Record<string, string> = { ş: "s", Ş: "S", ı: "i", İ: "I", ğ: "g", Ğ: "G", ü: "u", Ü: "U", ö: "o", Ö: "O", ç: "c", Ç: "C" };
  return s
    .replace(/[şŞıİğĞüÜöÖçÇ]/g, (m) => map[m] ?? m)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
