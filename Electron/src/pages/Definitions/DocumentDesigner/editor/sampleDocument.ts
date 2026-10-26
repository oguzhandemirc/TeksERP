/**
 * "Örnek belge yükle": sabit satırlar yerine türün SÖZLEŞMESİNDEN kurulan bağlı iskelet.
 * Satırlar `data-each` ile örnek veriden, toplam `toplamlar.<k>`dan gelir → önizlemede
 * satır toplamı ile toplam satırı hep tutar (eski sabit HTML'de tutmuyordu).
 */
import { dataFieldHtml, DOCUMENT_BLOCK_CSS, signatureHtml, totalBoxHtml } from "../binding/blockHtml";
import { isFieldLocked, type ContractTable, type ContractView } from "../binding/contract";
import { defaultColumns, itemTableHtml } from "../binding/itemTable";

/** Antet ek satırları kalem tablosu değildir; toplam kolonu olan ilk tablo tercih edilir. */
export function sampleTable(c: ContractView): ContractTable | null {
  const tables = c.tablolar.filter((t) => t.anahtar !== "antet_ek" && t.kolonlar.length > 0);
  return tables.find((t) => t.kolonlar.some((k) => k.toplam)) ?? tables[0] ?? null;
}

/** Varsayılan kolonlar + kesilen (ilk 6 dışı) toplam kolonları — toplam satırı boş kalmasın. */
export function sampleColumns(t: ContractTable, internalFields: readonly string[]): string[] {
  const cols = defaultColumns(t, internalFields);
  for (const k of t.kolonlar) {
    if (k.toplam && !cols.includes(k.yol) && !isFieldLocked(k, internalFields)) cols.push(k.yol);
  }
  return cols;
}

export function buildSampleDocument(
  c: ContractView | null,
  settings: Readonly<Record<string, unknown>>,
  internalFields: readonly string[],
): { html: string; css: string } {
  if (!c) {
    return { html: '<p class="doc-muted">Önce belge türü seçin.</p>', css: SAMPLE_DOCUMENT_CSS };
  }
  const f = (yol: string): string => {
    const field = c.kokler.find((x) => x.yol === yol);
    return field && !isFieldLocked(field, internalFields) ? dataFieldHtml(yol, field) : "";
  };
  const line = (label: string, yol: string): string => {
    const v = f(yol);
    return v ? `<div><b>${label}:</b> ${v}</div>` : "";
  };
  const t = sampleTable(c);
  const table = t ? itemTableHtml(t, sampleColumns(t, internalFields)) : "";
  // Tablo toplamı tfoot'ta; toplam kolonu yoksa türün toplam alanları ayrı kutuda.
  const totals = t && t.kolonlar.some((k) => k.toplam) ? "" : totalBoxHtml(c);
  const html = `
<header class="doc-head">
  <div class="doc-company">${f("firma.ad")}<br><span class="doc-muted">${f("firma.adres")}</span></div>
  <div class="doc-title">${f("belge.baslik")}<br><span class="doc-muted">No: ${f("belge.no")}</span></div>
</header>
<section class="doc-party">${line("Sayın", "karsi_taraf.ad")}${line("Tarih", "belge.tarih")}</section>
${table}
${totals}
${signatureHtml(settings)}`;
  return { html, css: SAMPLE_DOCUMENT_CSS + DOCUMENT_BLOCK_CSS };
}

export const SAMPLE_DOCUMENT_CSS = `
.doc-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:0.4mm solid #222;padding-bottom:3mm;margin-bottom:4mm;font-family:Arial, Helvetica, sans-serif;}
.doc-company{font-size:11pt;font-weight:700;}
.doc-title{font-size:15pt;font-weight:700;text-align:right;}
.doc-muted{font-size:8.5pt;font-weight:400;color:#555;}
.doc-party{display:flex;justify-content:space-between;font-size:10pt;margin-bottom:4mm;font-family:Arial, Helvetica, sans-serif;}`;
