// =============================================================================
// Sevk İrsaliyesi / Sevk Fişi — "SEVK İRSALİYESİ" HTML renderer (TEK KAYNAK)
// =============================================================================
// Müşteri sevkiyatının resmi sevk belgesi. Tüm cihazlar (mobil expo-print +
// Electron printHtmlString + muhasebe ekranı) bu backend HTML'ini basar → format
// her yerde birebir aynı; "muhasebe sevk fişi" ile "sevk irsaliyesi" TEK kaynaktan
// aynı çıkar. Donmuş PrintedDocument snapshot'ından (envelope + doc) üretilir.
//
// Yapı (ornek-fis.pdf 3 bölümü + yasal irsaliye başlığı):
//   üst:   firma anteti + SAYIN müşteri (+vergi no/şube) · İrsaliye No · Tarih · Yön
//   araç:  Plaka / Şoför / Taşıyıcı (varsa)
//   1) ÜRÜN LİSTESİ : STOK ADI | TOP ADEDİ | TOPLAM METRE
//   2) ÇUVAL LİSTESİ: AMBALAJ KODU | METRE TOPLAMI | KG TOPLAMI | PAKET SAYISI
//   3) ÇEKİ LİSTESİ : ÇUVAL NO | BARKOD | DESEN | VARYANT | METRE | KG
//   alt:   serbest not + imza kutuları + filigran (TASLAK/İPTAL/ESKİ KOPYA)
// =============================================================================

import type { PrintedDocStatus } from "@prisma/client";
import type { PrintedDocSnapshot } from "../printed-document.service";

interface ShipmentDocProduct {
  name: string;
  rollCount: number;
  totalMeters: number;
}

interface ShipmentDocSack {
  code: string;
  seq: number;
  totalMeters: number;
  totalKg: number;
  packageCount: number;
}

interface ShipmentDocCeki {
  sackCode: string;
  barcode: string | null;
  desen: string;
  varyant: string;
  meters: number;
  kg: number;
}

/** Donmuş sevk belgesi payload'ı — collectShipmentDocContent / getDispatchReport
 *  ile BİREBİR aynı şekil (tek kaynak: muhasebe fişi == sevk irsaliyesi). */
export interface ShipmentDispatchDoc {
  header: {
    shipmentNo: string;
    customerName: string;
    customerCode: string | null;
    customerTaxNumber: string | null;
    branchName: string | null;
    /** Müşteri şube kodu (CustomerBranch.code) — ihracatta kullanılır; belgede
     *  "branchCode" section toggle'ıyla açılıp kapanabilir. */
    branchCode: string | null;
    procedureCode: string | null;
    destination: "DOMESTIC" | "EXPORT";
    status: string;
    date: string | null;
    plateNumber: string | null;
    driverName: string | null;
    carrier: string | null;
    orderNos: string;
  };
  products: ShipmentDocProduct[];
  sacks: ShipmentDocSack[];
  cekiRows: ShipmentDocCeki[];
  totals: { totalRolls: number; totalMeters: number; totalKg: number; sackCount: number };
}

interface RenderMeta {
  status?: PrintedDocStatus;
  voidReason?: string | null;
  /** Kaynak henüz donmamış (canlı önizleme) → TASLAK filigranı. */
  draft?: boolean;
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Türkçe sayı: binlik "." ondalık "," (sunucu ICU'suna bağımlı değil). */
function fmtTr(n: number | null | undefined, dec: number): string {
  if (n == null || Number.isNaN(n)) return "";
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(dec);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (neg ? "-" : "") + grouped + (dec > 0 && frac ? `,${frac}` : "");
}

/** Metre/kg: 2 ondalık (mevcut muhasebe fişiyle aynı görünüm). */
const fmtQty = (n: number | null | undefined): string => fmtTr(n, 2);
/** Adet (top/paket): tam sayı. */
const fmtCount = (n: number | null | undefined): string => fmtTr(n, 0);

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Bir bölüm açık mı — yalnız açıkça false ise gizle (varsayılan: göster). */
function sectionOn(sections: Record<string, boolean> | undefined, key: string): boolean {
  return sections?.[key] !== false;
}

export function renderShipmentDispatchHtml(
  snapshot: PrintedDocSnapshot,
  meta: RenderMeta = {},
): string {
  const doc = snapshot.doc as unknown as ShipmentDispatchDoc;
  const cfg = snapshot.docConfigOverride ?? {};
  const company = snapshot.company;
  const lh = company?.letterhead ?? { addressLine: "", phone: "", taxInfo: "" };

  const title = (cfg.titleOverride?.trim() || "SEVK İRSALİYESİ").toUpperCase();
  const showLetterhead = cfg.showLetterhead !== false;
  const showSignatures = cfg.showSignatures !== false;
  const sigLabels =
    cfg.signatureLabels && cfg.signatureLabels.length
      ? cfg.signatureLabels
      : ["Teslim Eden", "Teslim Alan"];

  const h = doc.header;
  const t = doc.totals;
  const products = doc.products ?? [];
  const sacks = doc.sacks ?? [];
  const cekiRows = doc.cekiRows ?? [];

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

  // Şube kodu (ihracat) — "branchCode" section toggle'ıyla açılıp kapanabilir (varsayılan açık).
  const showBranchCode = sectionOn(cfg.sections, "branchCode");
  const customerSub = [
    h.customerTaxNumber ? `V.No: ${esc(h.customerTaxNumber)}` : "",
    h.branchName ? `Şube: ${esc(h.branchName)}` : "",
    showBranchCode && h.branchCode ? `Şube Kodu: ${esc(h.branchCode)}` : "",
    h.customerCode ? `Kod: ${esc(h.customerCode)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const yon = h.destination === "EXPORT" ? "Yurtdışı" : "Yurtiçi";
  const headRight = [
    `<div class="ln">İrsaliye No: <b>${esc(h.shipmentNo)}</b></div>`,
    `<div class="ln">Tarih: <b>${esc(fmtDate(h.date))}</b></div>`,
    `<div class="ln">Yön: <b>${esc(yon)}</b></div>`,
    h.procedureCode ? `<div class="ln">Gümrük/İhr. No: <b>${esc(h.procedureCode)}</b></div>` : "",
    h.orderNos ? `<div class="ln sub">Sipariş: ${esc(h.orderNos)}</div>` : "",
  ]
    .filter(Boolean)
    .join("");

  const vehicleBits = [
    h.plateNumber ? `Plaka: <b>${esc(h.plateNumber)}</b>` : "",
    h.driverName ? `Şoför: <b>${esc(h.driverName)}</b>` : "",
    h.carrier ? `Taşıyıcı: <b>${esc(h.carrier)}</b>` : "",
  ].filter(Boolean);
  const vehicleRow = vehicleBits.length
    ? `<div class="meta-row">${vehicleBits.join(" &nbsp;·&nbsp; ")}</div>`
    : "";

  // 1) ÜRÜN LİSTESİ
  const urunSection = sectionOn(cfg.sections, "urun")
    ? `<table class="sec">
        <thead>
          <tr><th class="caption" colspan="3">ÜRÜN LİSTESİ</th></tr>
          <tr><th class="l">STOK ADI</th><th class="r">TOP ADEDİ</th><th class="r">TOPLAM METRE</th></tr>
        </thead>
        <tbody>
          ${products
            .map(
              (p) =>
                `<tr><td class="l">${esc(p.name)}</td><td class="r">${esc(fmtCount(p.rollCount))}</td><td class="r">${esc(fmtQty(p.totalMeters))}</td></tr>`,
            )
            .join("")}
          <tr class="tot"><td class="l">TOPLAM</td><td class="r">${esc(fmtCount(t.totalRolls))}</td><td class="r">${esc(fmtQty(t.totalMeters))}</td></tr>
        </tbody>
      </table>`
    : "";

  // 2) ÇUVAL LİSTESİ
  const cuvalSection = sectionOn(cfg.sections, "cuval")
    ? `<table class="sec">
        <thead>
          <tr><th class="caption" colspan="4">ÇUVAL LİSTESİ</th></tr>
          <tr><th class="l">AMBALAJ KODU</th><th class="r">METRE TOPLAMI</th><th class="r">KG TOPLAMI</th><th class="r">PAKET SAYISI</th></tr>
        </thead>
        <tbody>
          ${sacks
            .map(
              (s) =>
                `<tr><td class="l">${esc(s.code)}</td><td class="r">${esc(fmtQty(s.totalMeters))}</td><td class="r">${esc(fmtQty(s.totalKg))}</td><td class="r">${esc(fmtCount(s.packageCount))}</td></tr>`,
            )
            .join("")}
          <tr class="tot"><td class="l">TOPLAM</td><td class="r">${esc(fmtQty(t.totalMeters))}</td><td class="r">${esc(fmtQty(t.totalKg))}</td><td class="r">${esc(fmtCount(t.totalRolls))}</td></tr>
        </tbody>
      </table>`
    : "";

  // 3) ÇEKİ LİSTESİ
  const cekiSection = sectionOn(cfg.sections, "ceki")
    ? `<table class="sec">
        <thead>
          <tr><th class="caption" colspan="6">ÇEKİ LİSTESİ</th></tr>
          <tr><th class="l">ÇUVAL NO</th><th class="l">BARKOD NO</th><th class="l">DESEN</th><th class="l">VARYANT</th><th class="r">METRE</th><th class="r">KG</th></tr>
        </thead>
        <tbody>
          ${cekiRows
            .map(
              (c) =>
                `<tr><td class="l">${esc(c.sackCode)}</td><td class="l">${esc(c.barcode ?? "—")}</td><td class="l">${esc(c.desen)}</td><td class="l">${esc(c.varyant)}</td><td class="r">${esc(fmtQty(c.meters))}</td><td class="r">${c.kg > 0 ? esc(fmtQty(c.kg)) : ""}</td></tr>`,
            )
            .join("")}
          <tr class="tot"><td class="l" colspan="4">TOPLAM</td><td class="r">${esc(fmtQty(t.totalMeters))}</td><td class="r">${esc(fmtQty(t.totalKg))}</td></tr>
        </tbody>
      </table>`
    : "";

  const noteBlock = cfg.footerNote
    ? `<div class="note">${esc(cfg.footerNote)}</div>`
    : "";

  const signatures = showSignatures
    ? `<div class="sign">${sigLabels
        .map(
          (l) =>
            `<div class="sign-box"><div class="sign-line"></div><div class="sign-lbl">${esc(l)}</div></div>`,
        )
        .join("")}</div>`
    : "";

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 9mm; }
  body { margin: 0; font-family: Arial, "Helvetica Neue", sans-serif; color: #111; font-size: 11px; }
  .sheet { position: relative; width: 100%; }
  .wm { position: fixed; top: 42%; left: 0; right: 0; text-align: center;
        font-size: 96px; font-weight: 800; color: rgba(220,38,38,0.16);
        transform: rotate(-22deg); letter-spacing: 8px; z-index: 0; }
  .wm-old { color: rgba(100,116,139,0.18); }
  .wm-draft { color: rgba(100,116,139,0.16); }
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
  .hr .ln b { font-size: 12px; }
  .hr .ln.sub { font-size: 10px; color: #444; white-space: normal; max-width: 240px; }
  .meta-row { margin: 4px 0 8px; font-size: 11px; }
  table { border-collapse: collapse; width: 100%; }
  .sec { margin-bottom: 12px; }
  .sec th, .sec td { border: 1px solid #000; padding: 3px 6px; font-size: 11px; }
  .sec th.caption { background: #e2e8f0; text-align: center; font-size: 12px;
                    font-weight: 800; letter-spacing: 1px; padding: 5px; }
  .sec thead th:not(.caption) { background: #f1f5f9; font-weight: 700; font-size: 10px; }
  .sec .l { text-align: left; }
  .sec .r { text-align: right; }
  .sec .tot td { font-weight: 800; background: #f8fafc; border-top: 2px solid #000; }
  .note { margin-top: 8px; font-size: 11px; white-space: pre-wrap;
          border: 1px solid #cbd5e1; padding: 6px 8px; border-radius: 4px; }
  .sign { display: flex; gap: 24px; margin-top: 28px; }
  .sign-box { flex: 1; text-align: center; }
  .sign-line { border-top: 1px solid #000; margin-bottom: 3px; margin-top: 28px; }
  .sign-lbl { font-size: 10px; color: #333; }
</style></head>
<body>
  ${watermark}
  <div class="sheet">
    <header>
      <div class="hl">
        <div class="company">${esc(company?.name ?? "")}</div>
        ${lhLines}
        <div class="sayin">SAYIN: <b>${esc(h.customerName)}</b></div>
        ${customerSub ? `<div class="sub">${customerSub}</div>` : ""}
      </div>
      <div class="hr">
        <div class="title">${esc(title)}</div>
        ${headRight}
      </div>
    </header>

    ${vehicleRow}
    ${urunSection}
    ${cuvalSection}
    ${cekiSection}
    ${noteBlock}
    ${signatures}
  </div>
</body></html>`;
}
