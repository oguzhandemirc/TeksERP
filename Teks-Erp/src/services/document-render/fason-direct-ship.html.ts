// =============================================================================
// Fasondan Doğrudan Sevk İrsaliyesi — HTML renderer (TEK KAYNAK)
// =============================================================================
// Fason firmasındaki malın fabrikaya dönmeden DOĞRUDAN müşteriye sevk edildiği
// resmi irsaliye. Normal fason çeki listesinden (KUMAŞ İRSALİYESİ) ayrı belge
// zinciri — burada mal müşteriye gider, fasona değil. Tüm cihazlar bu backend
// HTML'ini basar → format her yerde aynı. Donmuş PrintedDocument snapshot'ından
// üretilir; düzen:
//   üst:   firma anteti + başlık + İrsaliye No + Tarih
//   meta:  Fason Firma / Sevk Bilgileri (sebep, sevk eden, iş emri, araç)
//   bölüm: Karşılanan Siparişler (allocations: sipariş no, ürün, renk, miktar)
//   tablo: # | Barkod | Ürün/Renk | En | Metre | Kg  (+ TOPLAM)
//   alt:   serbest not + imza kutuları + filigran (TASLAK/İPTAL/ESKİ KOPYA)
// =============================================================================

import type { PrintedDocStatus } from "@prisma/client";
import type { PrintedDocSnapshot } from "../printed-document.service";

interface DirectShipRoll {
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

interface DirectShipAllocation {
  orderNumber: string;
  itemCode: string;
  itemName: string;
  colorName: string | null;
  qty: number;
}

/** Donmuş doğrudan-sevk payload'ı — buildFasonDirectShipDoc ile aynı şekil. */
interface DirectShipDoc {
  directShip: true;
  shipmentNo?: string;
  dispatchNo: string;
  directShippedAt: string | null;
  directShipReason: string | null;
  directShippedBy: string | null;
  dispatchedAt: string;
  driverName: string | null;
  plateNumber: string | null;
  notes: string | null;
  /** Malın gittiği müşteri — doğrudan sevk irsaliyesinin asıl alıcısı. */
  customer?: {
    id: string;
    name: string;
    code: string | null;
    taxNumber: string | null;
    branchName: string | null;
  };
  workOrder: { id: string; workOrderNumber: string; type: string };
  subcontractor: { id: string; name: string; code: string | null };
  step: { id: string; stepSequence: number; station: { name: string; code: string } };
  rolls: DirectShipRoll[];
  allocations: DirectShipAllocation[];
  totals: { rollCount: number; totalQty: number; totalWeight: number };
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

/** Metre/kg: 1 ondalık. */
const fmtQty = (n: number | null | undefined): string => fmtTr(n, 1);

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

export function renderFasonDirectShipHtml(
  snapshot: PrintedDocSnapshot,
  meta: RenderMeta = {},
): string {
  const doc = snapshot.doc as unknown as DirectShipDoc;
  const cfg = snapshot.docConfigOverride ?? {};
  const company = snapshot.company;
  const lh = company?.letterhead ?? { addressLine: "", phone: "", taxInfo: "" };

  const title = (cfg.titleOverride?.trim() || "FASONDAN SEVK İRSALİYESİ").toUpperCase();
  const showLetterhead = cfg.showLetterhead !== false;
  const showSignatures = cfg.showSignatures !== false;
  const sigLabels =
    cfg.signatureLabels && cfg.signatureLabels.length
      ? cfg.signatureLabels
      : ["Teslim Eden", "Teslim Alan"];

  const rolls = doc.rolls ?? [];
  const allocations = doc.allocations ?? [];
  const t = doc.totals;
  const shippedDate = doc.directShippedAt ?? doc.dispatchedAt;

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

  // Meta grid: Fason Firma + Doğrudan Sevk (sebep/onay) + Araç. Bölüm key'leri
  // Belge Şablonu DOC_DEF'iyle aynı (subcontractorInfo / directShipInfo / vehicleInfo).
  const showSub = sectionOn(cfg.sections, "subcontractorInfo");
  const showDs = sectionOn(cfg.sections, "directShipInfo");
  const showVeh = sectionOn(cfg.sections, "vehicleInfo");
  // MÜŞTERİ (Malın Gittiği) — doğrudan sevkin asıl alıcısı; section toggle'dan
  // bağımsız DAİMA gösterilir (irsaliyenin muhatabı).
  const cust = doc.customer;
  const custBox = cust
    ? `<div class="box"><div class="box-t">MÜŞTERİ (Malın Gittiği)</div>
        <div class="row"><span>Adı:</span><b>${esc(cust.name)}</b></div>
        ${cust.branchName ? `<div class="row"><span>Şube:</span><b>${esc(cust.branchName)}</b></div>` : ""}
        ${cust.taxNumber ? `<div class="row"><span>V.No:</span><b>${esc(cust.taxNumber)}</b></div>` : ""}
      </div>`
    : "";
  const subBox = showSub
    ? `<div class="box"><div class="box-t">FASON FİRMA (Malın Geldiği)</div>
        <div class="row"><span>Adı:</span><b>${esc(doc.subcontractor.name)}</b></div>
        ${doc.subcontractor.code ? `<div class="row"><span>Kod:</span><b>${esc(doc.subcontractor.code)}</b></div>` : ""}
        <div class="row"><span>İş Emri:</span><b>${esc(doc.workOrder.workOrderNumber)}</b></div>
        <div class="row"><span>Adım:</span><b>${esc(doc.step.station.name)}</b></div>
      </div>`
    : "";
  const dsBox = showDs
    ? `<div class="box"><div class="box-t">FASONDAN SEVK</div>
        <div class="row"><span>Sevk Eden:</span><b>${esc(doc.directShippedBy || "—")}</b></div>
        <div class="row"><span>Sebep:</span><b>${esc(doc.directShipReason || "—")}</b></div>
      </div>`
    : "";
  const vehBox = showVeh
    ? `<div class="box"><div class="box-t">ARAÇ / SEVKİYAT</div>
        <div class="row"><span>Plaka:</span><b>${esc(doc.plateNumber || "—")}</b></div>
        <div class="row"><span>Şoför:</span><b>${esc(doc.driverName || "—")}</b></div>
        ${doc.notes ? `<div class="row"><span>Not:</span><b>${esc(doc.notes)}</b></div>` : ""}
      </div>`
    : "";
  const infoGrid =
    custBox || subBox || dsBox || vehBox
      ? `<div class="info">${custBox}${subBox}${dsBox}${vehBox}</div>`
      : "";

  // Karşılanan siparişler (allocations) — sevkin hangi sipariş satırlarını kapattığı.
  const allocTable =
    sectionOn(cfg.sections, "allocations") && allocations.length
      ? `<div class="tbl-cap">Karşılanan Siparişler (${esc(allocations.length)})</div>
         <table class="sec">
          <thead>
            <tr>
              <th class="c" style="width:34px">#</th>
              <th class="l">SİPARİŞ NO</th>
              <th class="l">ÜRÜN / RENK</th>
              <th class="r" style="width:90px">MİKTAR</th>
            </tr>
          </thead>
          <tbody>
            ${allocations
              .map(
                (a, i) =>
                  `<tr>
                    <td class="c">${esc(i + 1)}</td>
                    <td class="l mono">${esc(a.orderNumber)}</td>
                    <td class="l">${esc(a.itemName)}${a.colorName ? ` · ${esc(a.colorName)}` : ""}</td>
                    <td class="r">${esc(fmtQty(a.qty))} m</td>
                  </tr>`,
              )
              .join("")}
          </tbody>
        </table>`
      : "";

  // Toplar tablosu.
  const rollTable = sectionOn(cfg.sections, "rollTable")
    ? `<div class="tbl-cap">Sevk Edilen Toplar (${esc(t.rollCount)})</div>
       <table class="sec">
        <thead>
          <tr>
            <th class="c" style="width:34px">#</th>
            <th class="l">BARKOD</th>
            <th class="l">ÜRÜN / RENK</th>
            <th class="c" style="width:60px">EN</th>
            <th class="r" style="width:80px">METRE</th>
            <th class="r" style="width:70px">KG</th>
          </tr>
        </thead>
        <tbody>
          ${rolls
            .map(
              (r) =>
                `<tr>
                  <td class="c">${esc(r.sequence)}</td>
                  <td class="l mono">${esc(r.barcode ?? "—")}</td>
                  <td class="l">${esc(r.itemName)}${r.colorName ? ` · ${esc(r.colorName)}` : ""}</td>
                  <td class="c">${r.width != null ? `${esc(Math.round(r.width))} cm` : "—"}</td>
                  <td class="r">${esc(fmtQty(r.dispatchedQty))}</td>
                  <td class="r">${r.dispatchedWeight != null ? esc(fmtQty(r.dispatchedWeight)) : "—"}</td>
                </tr>`,
            )
            .join("")}
          <tr class="tot">
            <td class="l" colspan="4">TOPLAM</td>
            <td class="r">${esc(fmtQty(t.totalQty))} m</td>
            <td class="r">${t.totalWeight > 0 ? `${esc(fmtQty(t.totalWeight))} kg` : "—"}</td>
          </tr>
        </tbody>
      </table>`
    : "";

  const noteBlock = cfg.footerNote ? `<div class="note">${esc(cfg.footerNote)}</div>` : "";

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
  .mono { font-family: ui-monospace, "Courier New", monospace; }
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
  .hr { text-align: right; white-space: nowrap; }
  .title { font-size: 18px; font-weight: 800; letter-spacing: 1px; }
  .hr .ln { margin-top: 3px; font-size: 11px; }
  .hr .ln b { font-size: 12px; }
  .info { display: flex; gap: 12px; margin: 8px 0; }
  .box { flex: 1; border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px 8px; }
  .box-t { font-size: 10px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 3px; }
  .box .row { display: grid; grid-template-columns: 72px 1fr; gap: 6px; font-size: 11px; }
  .box .row span { color: #555; }
  .tbl-cap { font-size: 11px; font-weight: 700; text-transform: uppercase; margin: 6px 0 3px; }
  table { border-collapse: collapse; width: 100%; }
  .sec th, .sec td { border: 1px solid #000; padding: 3px 6px; font-size: 11px; }
  .sec thead th { background: #f1f5f9; font-weight: 700; font-size: 10px; text-transform: uppercase; }
  .sec .l { text-align: left; }
  .sec .r { text-align: right; }
  .sec .c { text-align: center; }
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
      </div>
      <div class="hr">
        <div class="title">${esc(title)}</div>
        <div class="ln">İrsaliye No: <b>${esc(doc.shipmentNo ?? doc.dispatchNo)}</b></div>
        ${doc.shipmentNo ? `<div class="ln">Fason Sevk No: <b>${esc(doc.dispatchNo)}</b></div>` : ""}
        <div class="ln">Tarih: <b>${esc(fmtDate(shippedDate))}</b></div>
      </div>
    </header>

    ${infoGrid}
    ${allocTable}
    ${rollTable}
    ${noteBlock}
    ${signatures}
  </div>
</body></html>`;
}
