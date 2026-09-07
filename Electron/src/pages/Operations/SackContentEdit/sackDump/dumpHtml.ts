// =============================================================================
// Çuval İÇERİK DÖKÜMÜ — yazdırılabilir HTML (yazdır VE PDF aynı stringi kullanır)
// =============================================================================
// Çalışma kağıdıdır — donmuş/versiyonlu PrintedDocument DEĞİL (çeki listesiyle
// aynı statü). Bu yüzden `printed-document` kayıt defterine girmez; antet/kaşe
// katmanı da yok.
// Her çuval kendi bölümünde başlar ve çuvallar arasına sayfa sonu konur — Excel'in
// "çuval başına sayfa" davranışının kağıt karşılığı.
// =============================================================================

import { dumpTotalQty, type SackDump, type SackDumpOptions, type SackDumpRoll } from "./types";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const fmtNum = (n: number): string => n.toLocaleString("tr-TR", { maximumFractionDigits: 3 });

const dash = (s: string | null | undefined): string => (s && s.trim() ? esc(s) : "—");

/** Çuval başlığı meta satırı — müşteri/şube/ihracat kodu/kg/sevkiyat. */
function metaLine(d: SackDump): string {
  const parts: string[] = [];
  parts.push(d.customerName ? esc(d.customerName) : "Müşterisiz (genel stok)");
  if (d.branchName) parts.push(esc(d.branchName));
  if (d.branchCode) parts.push(`İhracat Kodu: ${esc(d.branchCode)}`);
  parts.push(`${d.rolls.length} top`);
  parts.push(`${fmtNum(dumpTotalQty(d))} m`);
  parts.push(d.weightKg != null ? `${fmtNum(d.weightKg)} kg` : "tartılmadı");
  if (d.swatches.length > 0) parts.push(`${d.swatches.length} kartela`);
  if (d.shipmentNo) parts.push(`Sevkiyat: ${esc(d.shipmentNo)}`);
  return parts.join(" · ");
}


/**
 * Bizdeki ad + (varsa) müşterideki karşılık, alt alta.
 * ⚠️ Karşılık YOKSA alt satır HİÇ basılmaz — bizim adımızı oraya koymak
 * "müşteri bunu böyle çağırıyor" yalanını üretirdi (2026-09-06 düzeltmesi).
 */
function adHucresi(bizdeki: string, musterideki?: string | null): string {
  const ust = dash(bizdeki);
  if (!musterideki) return ust;
  return `${ust}<div class="alt">↳ ${esc(musterideki)}</div>`;
}

/**
 * Topun ÜSTÜNDEKİ kâğıtta yazan. Üç hâl ayrı ayrı görünür:
 * basılmamış · bayat (kayıtla ayrışmış) · güncel.
 */
function etiketHucresi(r: SackDumpRoll): string {
  if (!r.etiketBasildi) return `<span class="alt">basılmamış</span>`;
  const ad = r.etiketAd ? esc(r.etiketAd) : `<span class="alt">(ad kayıtlı değil)</span>`;
  return r.etiketBayat ? `<strong>BAYAT</strong><div class="alt">${ad}</div>` : ad;
}


function rollTable(d: SackDump): string {
  if (d.rolls.length === 0) {
    return `<p class="empty">Çuval boş — top yok.</p>`;
  }
  const body = d.rolls
    .map(
      (r) => `<tr>
        <td class="mono">${r.barcode ? esc(r.barcode) : "Açık Kumaş"}</td>
        <td>${adHucresi(r.itemName, r.musteriItemName)}</td>
        <td>${adHucresi(r.colorName ?? "Ham", r.musteriColorName)}</td>
        <td>${etiketHucresi(r)}</td>
        <td class="num">${r.width != null ? `${fmtNum(r.width)} cm` : "—"}</td>
        <td class="num">${fmtNum(r.qty)}</td>
        <td>${dash(r.qualityGrade)}</td>
      </tr>`,
    )
    .join("");
  return `<table>
    <thead><tr>
      <th>Barkod</th><th>Kumaş</th><th>Renk</th><th>Etikette</th>
      <th class="num">En</th><th class="num">Metre</th><th>Kalite</th>
    </tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr>
      <td colspan="5"><strong>ARA TOPLAM — ${d.rolls.length} top</strong></td>
      <td class="num"><strong>${fmtNum(dumpTotalQty(d))}</strong></td>
      <td></td>
    </tr></tfoot>
  </table>`;
}

function swatchBlock(d: SackDump): string {
  if (d.swatches.length === 0) return "";
  const items = d.swatches
    .map(
      (s) =>
        `<li><span class="mono">${s.barcode ? esc(s.barcode) : "Kartela"}</span> — ${dash(s.itemName)}${
          s.colorName ? ` · ${esc(s.colorName)}` : ""
        }</li>`,
    )
    .join("");
  return `<div class="swatches">
    <div class="sub">KARTELALAR · ${d.swatches.length}</div>
    <ul>${items}</ul>
  </div>`;
}

function noteBlock(d: SackDump, withNotes: boolean): string {
  if (!withNotes || !d.notes) return "";
  return `<div class="note"><strong>Not:</strong> ${esc(d.notes)}</div>`;
}

function sackSection(d: SackDump, withNotes: boolean): string {
  return `<section class="sack">
    <h2>${esc(d.sackNo)}</h2>
    <div class="meta">${metaLine(d)}</div>
    ${noteBlock(d, withNotes)}
    ${rollTable(d)}
    ${swatchBlock(d)}
  </section>`;
}

/**
 * Tam HTML belge üretir — `printHtmlString` (yazıcı) ve `window.api.pdf.save`
 * (PDF dosyası) ikisi de bunu tüketir; tek kaynak, iki çıktı birebir aynı görünür.
 */
export function buildSackDumpHtml(dumps: SackDump[], opts: SackDumpOptions = {}): string {
  const withNotes = !!opts.withNotes;
  const totalRolls = dumps.reduce((a, d) => a + d.rolls.length, 0);
  const totalQty = dumps.reduce((a, d) => a + dumpTotalQty(d), 0);
  const totalSwatches = dumps.reduce((a, d) => a + d.swatches.length, 0);
  const weighed = dumps.filter((d) => d.weightKg != null);
  const totalKg = weighed.reduce((a, d) => a + (d.weightKg ?? 0), 0);

  const title =
    dumps.length === 1 ? `ÇUVAL İÇERİK DÖKÜMÜ — ${dumps[0]!.sackNo}` : `ÇUVAL İÇERİK DÖKÜMÜ — ${dumps.length} çuval`;

  // Genel toplam yalnız çok çuvalda anlamlı (tek çuvalda ara toplamla aynı olurdu).
  const grand =
    dumps.length > 1
      ? `<div class="grand">
          GENEL TOPLAM — ${dumps.length} çuval · ${totalRolls} top · ${fmtNum(totalQty)} m${
            weighed.length > 0
              ? ` · ${fmtNum(totalKg)} kg${weighed.length < dumps.length ? ` (${dumps.length - weighed.length} çuval tartılmadı)` : ""}`
              : " · tartılmadı"
          }${totalSwatches > 0 ? ` · ${totalSwatches} kartela` : ""}
        </div>`
      : "";

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
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
    .swatches .sub { font-size: 10px; font-weight: 700; color: #444; letter-spacing: .04em; margin-bottom: 2px; }
    .swatches ul { margin: 0; padding-left: 16px; font-size: 10px; }
    .grand { margin-top: 10px; padding-top: 6px; border-top: 2px solid #333; font-weight: 700; font-size: 11px; }
  </style></head><body>
    <h1>${esc(title)}</h1>
    <div class="doc-meta">
      ${dumps.length} çuval · ${totalRolls} top · ${fmtNum(totalQty)} m · Basım: ${esc(new Date().toLocaleString("tr-TR"))}
      ${withNotes ? " · çuval notları dahil" : ""}
    </div>
    ${dumps.map((d) => sackSection(d, withNotes)).join("")}
    ${grand}
  </body></html>`;
}
