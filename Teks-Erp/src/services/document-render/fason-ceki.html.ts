// =============================================================================
// Fason sevk çeki listesi — "KUMAŞ İRSALİYESİ" HTML renderer (TEK KAYNAK)
// =============================================================================
// Tüm cihazlar (mobil expo-print + Electron printHtmlString) bu backend HTML'ini
// basar → format her yerde birebir aynı. Donmuş PrintedDocument snapshot'ından
// (envelope + doc) üretilir; fiziksel KUMAŞ İRSALİYESİ formuna uyar:
//   üst: SAYIN (fason firma) + gönderen antet + İrsaliye No + Tarih
//   orta: 100 hücreli Top/Metre/Cm gridi (5 grup × 20 satır, sayfa başına)
//   alt:  CİNSİ | TOP | METRE | FİYATI | TUTARI + TOPLAM  (fason'da fiyat YOK → boş)
// =============================================================================

import type { PrintedDocStatus } from "@prisma/client";
import type { PrintedDocSnapshot } from "../printed-document.service";

interface FasonCekiRoll {
  sequence: number;
  barcode: string | null;
  itemCode: string;
  itemName: string;
  colorCode: string | null;
  colorName: string | null;
  dispatchedQty: number;
  dispatchedWeight: number | null;
  qualityGrade: string;
  width: number | null;
}

interface FasonCekiDoc {
  dispatchNo: string;
  dispatchedAt: string;
  driverName: string | null;
  plateNumber: string | null;
  notes: string | null;
  workOrder: { id: string; workOrderNumber: string; type: string };
  subcontractor: { id: string; name: string; code: string | null };
  /** Boyamanın hedef rengi — sevkte toplar ham gider, çeki "şu renge boya" der. */
  requestedColor?: string | null;
  /** Fason talimatı (instruction) — fasoncuya "ne yapılacak" notu. Sevkte donar;
   *  `documents.config sections.dyehouseNote` ile aç/kapa (default açık). */
  instruction?: string | null;
  step: { stepSequence: number; station: { name: string; code: string } };
  rolls: FasonCekiRoll[];
  totals: { rollCount: number; totalQty: number; totalWeight: number };
}

interface RenderMeta {
  status?: PrintedDocStatus;
  voidReason?: string | null;
  /** Donmamış canlı önizleme (sevk öncesi) → TASLAK filigranı. */
  draft?: boolean;
}

const SLOTS_PER_PAGE = 100; // 5 grup × 20 satır (fiziksel formla aynı)
const GROUPS = 5;
const ROWS = 20;

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 1 ondalık; tam sayıysa ondalıksız (115.0→"115", 100.5→"100.5"). Boş/0 → "". */
function fmtMetre(n: number | null | undefined): string {
  if (n == null || n === 0) return "";
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function fmtCm(n: number | null | undefined): string {
  if (n == null) return "";
  return String(Math.round(n));
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Tek bir 100 hücreli grid sayfası (rolls[startIdx .. startIdx+99]). */
function renderGridPage(rolls: FasonCekiRoll[], startIdx: number): string {
  const head =
    "<tr>" +
    Array.from({ length: GROUPS })
      .map(() => `<th class="c-top">Top</th><th class="c-met">Metre</th><th class="c-cm">Cm</th>`)
      .join("") +
    "</tr>";

  let body = "";
  for (let r = 0; r < ROWS; r++) {
    body += "<tr>";
    for (let g = 0; g < GROUPS; g++) {
      const topNo = startIdx + g * ROWS + r + 1; // 1-bazlı sıra no
      const roll = rolls[topNo - 1];
      body +=
        `<td class="c-top">${topNo}</td>` +
        `<td class="c-met">${roll ? esc(fmtMetre(roll.dispatchedQty)) : ""}</td>` +
        `<td class="c-cm">${roll ? esc(fmtCm(roll.width)) : ""}</td>`;
    }
    body += "</tr>";
  }
  return `<table class="grid"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

export function renderFasonCekiHtml(
  snapshot: PrintedDocSnapshot,
  meta: RenderMeta = {},
): string {
  const doc = snapshot.doc as unknown as FasonCekiDoc;
  const cfg = snapshot.docConfigOverride ?? {};
  const company = snapshot.company;
  const lh = company?.letterhead ?? { addressLine: "", phone: "", taxInfo: "" };

  const title = (cfg.titleOverride?.trim() || "KUMAŞ İRSALİYESİ").toUpperCase();
  const showLetterhead = cfg.showLetterhead !== false;
  const showSignatures = cfg.showSignatures !== false;
  const sigLabels =
    cfg.signatureLabels && cfg.signatureLabels.length
      ? cfg.signatureLabels
      : ["Teslim Eden", "Teslim Alan"];

  const cins = doc.rolls[0]?.itemName ?? "";
  // İstenen (hedef) renk öncelikli; yoksa topların mevcut rengi (boyanmış dönüşte).
  const renk = doc.requestedColor ?? doc.rolls[0]?.colorName ?? "";

  // Çok sayfa: 100'er hücrelik gridler (çoğu sevk tek sayfa).
  const pageCount = Math.max(1, Math.ceil(doc.rolls.length / SLOTS_PER_PAGE));
  let grids = "";
  for (let p = 0; p < pageCount; p++) {
    grids += renderGridPage(doc.rolls, p * SLOTS_PER_PAGE);
  }

  // Antet (gönderen) satırları — sadece dolu olanlar.
  const lhLines = showLetterhead
    ? [lh.addressLine, lh.phone, lh.taxInfo ? `V.D./No: ${lh.taxInfo}` : ""]
        .filter((s) => s && s.trim())
        .map((s) => `<div class="lh-line">${esc(s)}</div>`)
        .join("")
    : "";

  const watermark = meta.draft
    ? `<div class="wm wm-draft">TASLAK</div>`
    : meta.status === "VOIDED"
      ? `<div class="wm">İPTAL</div>`
      : meta.status === "SUPERSEDED"
        ? `<div class="wm wm-old">ESKİ KOPYA</div>`
        : "";

  const vehicleRow =
    doc.plateNumber || doc.driverName
      ? `<div class="meta-row">${doc.plateNumber ? `Plaka: <b>${esc(doc.plateNumber)}</b>` : ""}${
          doc.plateNumber && doc.driverName ? " &nbsp;·&nbsp; " : ""
        }${doc.driverName ? `Şoför: <b>${esc(doc.driverName)}</b>` : ""}</div>`
      : "";

  const noteBlock =
    doc.notes || cfg.footerNote
      ? `<div class="note">${esc(doc.notes || "")}${
          doc.notes && cfg.footerNote ? " — " : ""
        }${esc(cfg.footerNote || "")}</div>`
      : "";

  // Fason talimatı bloğu — sections.dyehouseNote !== false ise (default açık) basılır.
  const showInstruction = cfg.sections?.dyehouseNote !== false;
  const instrBlock =
    showInstruction && doc.instruction && doc.instruction.trim()
      ? `<div class="instr"><div class="instr-lbl">FASON TALİMATI</div><div class="instr-txt">${esc(
          doc.instruction,
        )}</div></div>`
      : "";

  const signatures = showSignatures
    ? `<div class="sign">${sigLabels
        .map((l) => `<div class="sign-box"><div class="sign-line"></div><div class="sign-lbl">${esc(l)}</div></div>`)
        .join("")}</div>`
    : "";

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 8mm; }
  body { margin: 0; font-family: Arial, "Helvetica Neue", sans-serif; color: #111; font-size: 11px; }
  .sheet { position: relative; width: 100%; }
  .wm { position: fixed; top: 42%; left: 0; right: 0; text-align: center;
        font-size: 96px; font-weight: 800; color: rgba(220,38,38,0.16);
        transform: rotate(-22deg); letter-spacing: 8px; z-index: 0; }
  .wm-old { color: rgba(100,116,139,0.18); }
  .wm-draft { color: rgba(100,116,139,0.16); } /* F196: taslak filigranı ESKİ KOPYA'dan ayrı sınıf */
  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 8px; gap: 12px; }
  .hl { flex: 1; min-width: 0; }
  .company { font-size: 16px; font-weight: 800; text-transform: uppercase; }
  .lh-line { font-size: 10px; color: #333; }
  .sayin { margin-top: 6px; font-size: 13px; }
  .sayin b { font-size: 15px; text-transform: uppercase; }
  .sub { font-size: 10px; color: #444; margin-top: 1px; }
  .hr { text-align: right; white-space: nowrap; }
  .title { font-size: 18px; font-weight: 800; letter-spacing: 1px; }
  .hr .ln { margin-top: 3px; font-size: 11px; }
  .hr .ln b { font-size: 13px; }
  table { border-collapse: collapse; width: 100%; }
  .grid { margin-bottom: 4px; table-layout: fixed; }
  .grid th, .grid td { border: 1px solid #000; height: 18px; text-align: center;
                       font-size: 10px; padding: 0 2px; overflow: hidden; }
  .grid th { background: #f1f5f9; font-weight: 700; }
  .grid .c-top { width: 4.5%; background: #f8fafc; }
  .grid .c-met { width: 9%; }
  .grid .c-cm  { width: 5%; }
  .grid tbody .c-top { font-weight: 700; }
  .meta-row { margin: 4px 0; font-size: 11px; }
  .totals { margin-top: 8px; }
  .totals th, .totals td { border: 1px solid #000; padding: 5px 8px; font-size: 12px; }
  .totals th { background: #f1f5f9; text-align: left; font-size: 10px; text-transform: uppercase; }
  .totals .cins { font-weight: 700; }
  .totals .toplam td { font-weight: 800; background: #f8fafc; }
  .note { margin-top: 8px; font-size: 11px; white-space: pre-wrap; border: 1px solid #cbd5e1; padding: 6px 8px; border-radius: 4px; }
  .instr { margin-top: 8px; border: 2px solid #000; padding: 6px 8px; border-radius: 4px; }
  .instr-lbl { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #333; }
  .instr-txt { margin-top: 2px; font-size: 12px; font-weight: 600; white-space: pre-wrap; }
  .sign { display: flex; gap: 24px; margin-top: 26px; }
  .sign-box { flex: 1; text-align: center; }
  .sign-line { border-top: 1px solid #000; margin-bottom: 3px; }
  .sign-lbl { font-size: 10px; color: #333; }
</style></head>
<body>
  ${watermark}
  <div class="sheet">
    <header>
      <div class="hl">
        <div class="company">${esc(company?.name ?? "")}</div>
        ${lhLines}
        <div class="sayin">SAYIN: <b>${esc(doc.subcontractor.name)}</b></div>
        <div class="sub">${esc(doc.step.station.name)} · İş Emri ${esc(doc.workOrder.workOrderNumber)}${
          doc.subcontractor.code ? ` · Hesap: ${esc(doc.subcontractor.code)}` : ""
        }</div>
      </div>
      <div class="hr">
        <div class="title">${esc(title)}</div>
        <div class="ln">İrsaliye No: <b>${esc(doc.dispatchNo)}</b></div>
        <div class="ln">Tarih: <b>${esc(fmtDate(doc.dispatchedAt))}</b></div>
      </div>
    </header>

    ${vehicleRow}
    ${grids}

    <table class="totals">
      <thead>
        <tr><th style="width:42%">CİNSİ</th><th>TOP</th><th>METRE</th><th>FİYATI</th><th>TUTARI</th></tr>
      </thead>
      <tbody>
        <tr>
          <td class="cins">${esc(cins)}${renk ? ` · ${esc(renk)}` : ""}</td>
          <td>${esc(doc.totals.rollCount)}</td>
          <td>${esc(fmtMetre(doc.totals.totalQty))}</td>
          <td></td>
          <td></td>
        </tr>
        <tr class="toplam">
          <td>TOPLAM</td>
          <td>${esc(doc.totals.rollCount)}</td>
          <td>${esc(fmtMetre(doc.totals.totalQty))}</td>
          <td></td>
          <td></td>
        </tr>
      </tbody>
    </table>

    ${instrBlock}
    ${noteBlock}
    ${signatures}
  </div>
</body></html>`;
}
