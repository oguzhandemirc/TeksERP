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
  tables: ReportTableSpec[];
}

// ---------- Excel ------------------------------------------------------------

/**
 * `SheetSpec` ile alan adları bilinçli olarak aynı → dönüşüm neredeyse kimlik.
 * `align` Excel'e geçmez (orada hizayı `numFmt` ve hücre tipi belirler).
 */
export function toSheets(spec: ReportExportSpec): SheetSpec[] {
  return spec.tables.map((t) => ({
    name: t.name,
    columns: t.columns.map((c) => ({ header: c.header, key: c.key, width: c.width, numFmt: c.numFmt })),
    rows: t.rows,
    totalRow: t.totalRow,
    // Başlıktaki bağlam HER sayfaya düşer: Excel'de sayfalar tek tek kopyalanıp
    // paylaşılıyor ve dönem bilgisi olmayan bir tablo yanlış okunur.
    notes: [...(spec.meta ?? []), ...(t.notes ?? [])],
  }));
}

// ---------- PDF / Yazdır -----------------------------------------------------

const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

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
  const tables = spec.tables
    .map((t) => {
      const head = t.columns
        .map((c) => `<th style="text-align:${c.align === "right" ? "right" : "left"}">${esc(c.header)}</th>`)
        .join("");
      const body = t.rows
        .map(
          (r) =>
            `<tr>${t.columns
              .map(
                (c) =>
                  `<td style="text-align:${c.align === "right" ? "right" : "left"}">${esc(r[c.key])}</td>`,
              )
              .join("")}</tr>`,
        )
        .join("");
      const total = t.totalRow
        ? `<tr class="tot">${t.columns
            .map(
              (c) =>
                `<td style="text-align:${c.align === "right" ? "right" : "left"}">${esc(t.totalRow?.[c.key])}</td>`,
            )
            .join("")}</tr>`
        : "";
      const notes = (t.notes ?? []).map((n) => `<div class="note">${esc(n)}</div>`).join("");
      return `<section class="tbl-wrap">
        <h2>${esc(t.name)}</h2>
        <table><thead><tr>${head}</tr></thead><tbody>${body}${total}</tbody></table>
        ${notes}
      </section>`;
    })
    .join("");

  const meta = (spec.meta ?? []).map((m) => `<div class="meta">${esc(m)}</div>`).join("");

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<title>${esc(spec.title)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm 12mm; }
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

/** Dosya adı gövdesi — Türkçe karakter / boşluk temizlenir. */
export function slugifyFileName(s: string): string {
  const map: Record<string, string> = { ş: "s", Ş: "S", ı: "i", İ: "I", ğ: "g", Ğ: "G", ü: "u", Ü: "U", ö: "o", Ö: "O", ç: "c", Ç: "C" };
  return s
    .replace(/[şŞıİğĞüÜöÖçÇ]/g, (m) => map[m] ?? m)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
