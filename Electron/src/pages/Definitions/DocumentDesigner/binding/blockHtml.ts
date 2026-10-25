/**
 * Belgeye özgü blokların HTML'i (saf; sözleşmeden). Bloklar editöre bu metinle girer;
 * aynı metin gidiş-dönüş fikstürüne yazılır ve backend derleyicisinden geçirilir.
 */
import { sampleText, totalFields, type ContractField, type ContractView } from "./contract";
import { suggestFilters } from "./directives";
import { defaultColumns, itemTableHtml, ITEM_TABLE_CSS } from "./itemTable";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Logo/görsel yer tutucusu: 1×1 saydam PNG (varlık kapısı `data:image` ister). */
export const PLACEHOLDER_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export const PAGE_BREAK_CLASS = "sayfa-kesmesi";

/** Blokların taşıdığı sınıf CSS'i — şablon CSS'ine girer (avoidInlineStyle). */
export const DOCUMENT_BLOCK_CSS = [
  ITEM_TABLE_CSS,
  `.${PAGE_BREAK_CLASS}{break-after:page;height:0;}`,
  ".toplam-kutusu{margin-left:auto;width:70mm;font-size:9.5pt;}",
  ".toplam-satiri{display:flex;justify-content:space-between;padding:0.8mm 0;border-bottom:0.2mm solid #999999;}",
  ".imza-alani{display:flex;justify-content:space-between;gap:10mm;margin-top:15mm;}",
  ".imza-kutusu{flex:1;border-top:0.3mm solid #222222;padding-top:2mm;text-align:center;font-size:9pt;}",
  ".logo{max-width:40mm;max-height:20mm;}",
  ".barkod{display:inline-block;min-width:30mm;min-height:10mm;}",
  ".karekod{display:inline-block;width:22mm;height:22mm;}",
].join("");

export function fieldFilter(f: ContractField | undefined): string {
  if (!f) return "";
  return suggestFilters(f.tur, { ondalik: f.ondalik, birim: f.birim })[0]?.value ?? "";
}

/** Veri alanı: `data-alan` (+ türünden önerilen `data-filtre`); içerik örnek değerdir. */
export function dataFieldHtml(path: string, field?: ContractField): string {
  const filter = fieldFilter(field);
  const f = filter ? ` data-filtre="${esc(filter)}"` : "";
  return `<span class="veri-alani" data-alan="${path}"${f}>${esc(sampleText(field, field?.etiket ?? path))}</span>`;
}

export function totalBoxHtml(c: ContractView | null): string {
  const fields = c ? totalFields(c).slice(0, 3) : [];
  const rows = fields.length
    ? fields.map((f) => `<div class="toplam-satiri"><span>${esc(f.etiket)}</span>${dataFieldHtml(f.yol, f).replace("<span", "<b").replace(/<\/span>$/, "</b>")}</div>`)
    : ['<div class="toplam-satiri"><span>Toplam</span><b>Alan seçin</b></div>'];
  return `<div class="toplam-kutusu">${rows.join("")}</div>`;
}

export function logoHtml(): string {
  return `<img class="logo" data-bag-src="firma.logo" alt="Logo" src="${PLACEHOLDER_IMAGE}"/>`;
}

export function barcodeHtml(): string {
  return '<span class="barkod" data-alan="belge.no" data-filtre="barkod: &quot;code128&quot;">Barkod</span>';
}

export function qrHtml(): string {
  return '<span class="karekod" data-alan="belge.no" data-filtre="qr">QR</span>';
}

/**
 * İmza alanı `ayar.signatureLabels`tan; `ayar.showSignatures` kapalıysa hiç basılmaz.
 * Ayarda dizi yoksa kutular düz metindir (katı render tanımsız yolu düşürürdü).
 */
export function signatureHtml(settings: Readonly<Record<string, unknown>>): string {
  const raw = settings.signatureLabels;
  const bound = Array.isArray(raw) && raw.length > 0 && raw.every((x) => typeof x === "string");
  const labels = bound ? (raw as string[]) : ["Teslim eden", "Teslim alan"];
  const boxes = labels
    .map((l, i) => (bound ? `<div class="imza-kutusu" data-alan="ayar.signatureLabels[${i}]">${esc(l)}</div>` : `<div class="imza-kutusu">${esc(l)}</div>`))
    .join("");
  const toggle = typeof settings.showSignatures === "boolean" ? ' data-if="ayar.showSignatures"' : "";
  return `<div class="imza-alani"${toggle}>${boxes}</div>`;
}

export function pageBreakHtml(): string {
  return `<div class="${PAGE_BREAK_CLASS}"></div>`;
}

/** Kalem tablosu: türün ilk tablosu ve varsayılan kolonlar; sözleşme yoksa boş iskelet. */
export function itemTableBlockHtml(c: ContractView | null, internalFields: readonly string[] = []): string {
  const t = c?.tablolar.find((x) => x.kolonlar.length > 0);
  if (!t) return '<table class="kalem-tablosu" data-tablo=""><tbody><tr><td>Önce belge türü seçin</td></tr></tbody></table>';
  return itemTableHtml(t, defaultColumns(t, internalFields));
}
