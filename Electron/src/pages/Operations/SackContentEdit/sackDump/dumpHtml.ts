// =============================================================================
// Çuval İÇERİK DÖKÜMÜ — yazdırılabilir HTML (yazdır VE PDF aynı stringi kullanır)
// =============================================================================
// Çalışma kağıdıdır — donmuş/versiyonlu PrintedDocument DEĞİL (çeki listesiyle
// aynı statü). Bu yüzden `printed-document` kayıt defterine girmez; antet/kaşe
// katmanı da yok.
// Her çuval kendi bölümünde başlar ve çuvallar arasına sayfa sonu konur — Excel'in
// "çuval başına sayfa" davranışının kağıt karşılığı. Kolon, başlık ve hücre metni
// `dumpModel`den gelir (Excel aynı modeli okur); burada yalnız yerleşim yaşar.
// =============================================================================

import {
  buildSackDumpModel,
  dumpCellText,
  EMPTY_SACK_TEXT,
  type DumpKind,
  type DumpSackSection,
  type DumpTable,
} from "./dumpModel";
import type { SackDump, SackDumpOptions } from "./types";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const NUMERIC: ReadonlySet<DumpKind> = new Set<DumpKind>(["qty", "int", "cm"]);
/** Barkod / çuval no gibi kod kolonları eş aralıklı yazılır. */
const MONO_KEYS: ReadonlySet<string> = new Set(["barcode", "sackNo"]);

/** Modelin tablosu — kolon, başlık, hücre metni ve toplam Excel'le AYNI kaynaktan. */
function tableHtml(t: DumpTable): string {
  const cls = (i: number) => {
    const c = t.columns[i]!;
    return [NUMERIC.has(c.kind) ? "num" : "", MONO_KEYS.has(c.key) ? "mono" : ""].filter(Boolean).join(" ");
  };
  const cell = (tag: "th" | "td", i: number, text: string) => {
    const k = cls(i);
    return `<${tag}${k ? ` class="${k}"` : ""}>${text}</${tag}>`;
  };
  const head = t.columns.map((c, i) => cell("th", i, esc(c.label))).join("");
  const body = t.rows
    .map((r) => `<tr>${r.map((v, i) => cell("td", i, esc(dumpCellText(t.columns[i]!.kind, v)))).join("")}</tr>`)
    .join("");
  const foot = t.foot
    ? `<tfoot><tr>${t.foot.map((v, i) => cell("td", i, `<strong>${esc(dumpCellText(t.columns[i]!.kind, v))}</strong>`)).join("")}</tr></tfoot>`
    : "";
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
}

function sackSection(s: DumpSackSection): string {
  const meta = s.meta.map(([l, v]) => `${esc(l)}: ${esc(v)}`).join(" · ");
  return `<section class="sack">
    <h2>${esc(s.sackNo)}</h2>
    <div class="meta">${meta}</div>
    ${s.note ? `<div class="note"><strong>Not:</strong> ${esc(s.note)}</div>` : ""}
    ${s.rolls ? tableHtml(s.rolls) : `<p class="empty">${esc(EMPTY_SACK_TEXT)}</p>`}
    ${s.swatches ? `<div class="swatches"><div class="sub">KARTELALAR · ${s.swatches.rows.length}</div>${tableHtml(s.swatches)}</div>` : ""}
  </section>`;
}

/**
 * Tam HTML belge üretir — `printHtmlString` (yazıcı) ve `window.api.pdf.save`
 * (PDF dosyası) ikisi de bunu tüketir; tek kaynak, iki çıktı birebir aynı görünür.
 */
export function buildSackDumpHtml(dumps: SackDump[], opts: SackDumpOptions = {}, now?: Date): string {
  const m = buildSackDumpModel(dumps, opts, now);

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(m.title)}</title><style>
    @page { size: A4 portrait; margin: 14mm; }
    /* Belge KENDİ zeminini taşır: printToPDF printBackground:true ile çalışıyor ve
       koyu zeminli bir pencerede render edilirse zemin devralınıp koyu-üstüne-koyu
       okunmaz bir PDF çıkıyor. color-scheme:light ayrıca UA'nın kendi karanlık mod
       dönüşümünü kapatır. (Bu blok bir template literal içinde — backtick KULLANMA.) */
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html, body { background: #fff; }
    body { font-family: Arial, "Helvetica Neue", sans-serif; font-size: 11px; color: #111; margin: 0; }
    h1 { font-size: 15px; margin: 0 0 2px; }
    h2 { font-size: 13px; margin: 0 0 2px; font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; }
    .doc-meta { font-size: 10px; color: #555; margin-bottom: 10px; }
    /* Çuval bölümleri arası sayfa sonu — Excel'deki "çuval başına sayfa" karşılığı.
       Son bölümden sonra sayfa sonu YOK (boş sayfa basılmasın). */
    section.sack { page-break-after: always; }
    section.sack:last-of-type { page-break-after: auto; }
    .meta { font-size: 10px; color: #444; margin-bottom: 6px; }
    .note { font-size: 10px; border-left: 3px solid #999; padding: 3px 6px; margin: 0 0 6px;
            background: #f6f6f6; white-space: pre-wrap; word-break: break-word; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #888; padding: 3px 6px; text-align: left; vertical-align: top; }
    td.num, th.num { text-align: right; }
    .mono { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; }
    thead th { background: #eee; font-weight: 700; }
    tbody tr:nth-child(even) { background: #f7f7f7; }
    tfoot td { background: #eee; border-top: 2px solid #333; }
    .empty { font-size: 10px; color: #666; font-style: italic; margin: 4px 0; }
    /* Müşterideki ad / etiket ayrıntısı — ana adın altında, sönük. */
    .alt { font-size: 9px; color: #666; }
    .swatches { margin-top: 8px; }
    .sub { font-size: 10px; font-weight: 700; color: #444; letter-spacing: .04em; margin-bottom: 2px; }
    .summary { margin-bottom: 14px; }
  </style></head><body>
    <h1>${esc(m.title)}</h1>
    <div class="doc-meta">${esc(m.docMeta)}</div>
    ${m.summary ? `<section class="summary"><div class="sub">ÖZET</div>${tableHtml(m.summary)}</section>` : ""}
    ${m.sacks.map(sackSection).join("")}
  </body></html>`;
}
