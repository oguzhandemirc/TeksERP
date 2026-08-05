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
import {
  resolveDocStyle,
  docPageCss,
  docTableCss,
  scaleDocCss,
  docLogoHtml,
  DOC_LOGO_CSS,
  DOC_STAMPS_CSS,
  docCopyBadge,
  docBlocksHtml,
  docPrintNoteHtml,
  docStampsBar,
} from "./doc-style";
import { buildDocTable } from "./doc-table";
import { DOC_DENSITY, docChromeCss, resolveDocPageSize } from "./doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "./doc-fields";

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
  /** Kaynak fason sevkin partisi (K10). Varsayılan BASILIR; `sections.batchInfo`
   *  ile kapatılır. Eski donmuş belgelerde alan YOK → satır doğmaz. */
  batchNumber?: string | null;
  /** Malın gittiği müşteri — doğrudan sevk irsaliyesinin asıl alıcısı. */
  customer?: {
    id: string;
    name: string;
    code: string | null;
    taxNumber: string | null;
    branchName: string | null;
    /** ŞUBE ihracat kodu (CustomerBranch.code) — tek "İhracat Kodu" satırının
     *  öncelikli kaynağı (branchCode ?? exportCode); "exportCode" toggle'ına bağlı. */
    branchCode: string | null;
    /** ŞİRKET ihracat kodu (Customer.exportCode) — şube ihracat kodu boşsa yedek
     *  olarak aynı satıra basılır. Eski donmuş snapshot'larda yoktur (opsiyonel). */
    exportCode?: string | null;
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
  /** Snapshot logoHash'inin çözülmüş görseli (servis katmanı çözer). */
  logoDataUrl?: string | null;
  /** cfg.qr açıksa belge doğrulama karekodu (servis üretir). */
  qrDataUrl?: string | null;
  /** Basım damgası (dd.MM.yyyy HH:mm) — cfg.stamps.printedAt açıksa. */
  printedAtText?: string;
  /** Basan kullanıcı — cfg.stamps.printedBy açıksa. */
  printedBy?: string | null;
  /** Tek seferlik baskı notu (?printNote= — persist edilmez). */
  printNote?: string | null;
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
  // Yoğunluk profili sayfa boyutundan çözülür; ortak chrome CSS'i oradan beslenir.
  const pageSize = resolveDocPageSize(cfg.style?.pageSize);
  const d = DOC_DENSITY[pageSize];
  const style = resolveDocStyle(cfg.style, { marginMm: 9 });
  const logo = docLogoHtml(meta.logoDataUrl, cfg);
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
    ? [lh.addressLine, lh.phone, lh.taxInfo ? `V.D./No: ${lh.taxInfo}` : "", ...(lh.extraLines ?? [])]
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
  // Fason Sevk No satırı (dispatchNo) — sections.fasonDispatchNo !== false ise.
  const showFasonDispatchNo = sectionOn(cfg.sections, "fasonDispatchNo");
  // Parti no varsayılan AÇIK (2026-08-05 ürün kararı). Önce opt-in yapılmıştı —
  // gerekçe "müşteri belgesinin yerleşimi sormadan değişmesin"di; fabrika lot
  // no'nun müşterinin de sorduğu bir bilgi olduğuna karar verdi. `sectionOn`
  // blocklist'tir: yalnız açıkça `false` yazılırsa susar.
  const showBatchInfo = sectionOn(cfg.sections, "batchInfo");
  // İhracat Kodu — TEK satır: şube kodu doluysa onu, yoksa müşteri ihracat kodunu
  // bas (branchCode ?? exportCode). "exportCode" section toggle'ıyla (varsayılan açık).
  const showExportCode = sectionOn(cfg.sections, "exportCode");
  // Müşteri kutusundaki Şube (branchName) ve V.No (taxNumber) satırları — kendi
  // section toggle'larıyla (varsayılan açık). Kutunun kendisi DAİMA gösterilir.
  const showBranchName = sectionOn(cfg.sections, "branchName");
  const showTaxNo = sectionOn(cfg.sections, "taxNo");
  // MÜŞTERİ (Malın Gittiği) — doğrudan sevkin asıl alıcısı; section toggle'dan
  // bağımsız DAİMA gösterilir (irsaliyenin muhatabı).
  const cust = doc.customer;
  const custShipCode = cust ? (cust.branchCode ?? cust.exportCode) : null;
  const custBox = cust
    ? `<div class="box"><div class="box-t">MÜŞTERİ (Malın Gittiği)</div>
        <div class="row"><span>Adı:</span><b>${esc(cust.name)}</b></div>
        ${showBranchName && cust.branchName ? `<div class="row"><span>Şube:</span><b>${esc(cust.branchName)}</b></div>` : ""}
        ${showExportCode && custShipCode ? `<div class="row"><span>İhracat Kodu:</span><b>${esc(custShipCode)}</b></div>` : ""}
        ${showTaxNo && cust.taxNumber ? `<div class="row"><span>V.No:</span><b>${esc(cust.taxNumber)}</b></div>` : ""}
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

  // Karşılanan siparişler (allocations) — kolonlar cfg.columns.allocations ile.
  const allocTable =
    sectionOn(cfg.sections, "allocations") && allocations.length
      ? `<div class="tbl-cap">Karşılanan Siparişler (${esc(allocations.length)})</div>` +
        buildDocTable<(typeof allocations)[number]>({
          className: "sec",
          colCfg: cfg.columns?.allocations,
          rows: allocations,
          cols: [
            { key: "seq", label: "#", align: "c", width: "34px", cell: (_a, i) => esc(i + 1) },
            { key: "orderNumber", label: "SİPARİŞ NO", align: "l", cellClass: "mono", cell: (a) => esc(a.orderNumber) },
            { key: "itemColor", label: "ÜRÜN / RENK", align: "l", cell: (a) => `${esc(a.itemName)}${a.colorName ? ` · ${esc(a.colorName)}` : ""}` },
            { key: "qty", label: "MİKTAR", align: "r", width: "90px", cell: (a) => `${esc(fmtQty(a.qty))} m` },
          ],
        })
      : "";

  // Toplar tablosu — kolonlar cfg.columns.rollTable ile aç/kapa + sıralanır.
  const rollTable = sectionOn(cfg.sections, "rollTable")
    ? `<div class="tbl-cap">Sevk Edilen Toplar (${esc(t.rollCount)})</div>` +
      buildDocTable<(typeof rolls)[number]>({
        className: "sec",
        colCfg: cfg.columns?.rollTable,
        footLabel: "TOPLAM",
        rows: rolls,
        cols: [
          { key: "seq", label: "#", align: "c", width: "34px", cell: (r) => esc(r.sequence) },
          { key: "barcode", label: "BARKOD", align: "l", cellClass: "mono", cell: (r) => esc(r.barcode ?? "—") },
          { key: "itemColor", label: "ÜRÜN / RENK", align: "l", cell: (r) => `${esc(r.itemName)}${r.colorName ? ` · ${esc(r.colorName)}` : ""}` },
          { key: "width", label: "EN", align: "c", width: "60px", cell: (r) => (r.width != null ? `${esc(Math.round(r.width))} cm` : "—") },
          { key: "meters", label: "METRE", align: "r", width: "80px", cell: (r) => esc(fmtQty(r.dispatchedQty)), foot: `${esc(fmtQty(t.totalQty))} m` },
          { key: "kg", label: "KG", align: "r", width: "70px", cell: (r) => (r.dispatchedWeight != null ? esc(fmtQty(r.dispatchedWeight)) : "—"), foot: t.totalWeight > 0 ? `${esc(fmtQty(t.totalWeight))} kg` : "—" },
        ],
      })
    : "";

  // Serbest not (cfg.footerNote) — sections.notes !== false ise (default açık).
  const showNotes = sectionOn(cfg.sections, "notes");
  const noteBlock = showNotes && cfg.footerNote ? `<div class="note">${esc(cfg.footerNote)}</div>` : "";

  const signatures = showSignatures
    ? `<div class="sign">${sigLabels
        .map(
          (l) =>
            `<div class="sign-box"><div class="sign-line"></div><div class="sign-lbl">${esc(l)}</div></div>`,
        )
        .join("")}</div>`
    : "";

  const css = scaleDocCss(
    `
  * { box-sizing: border-box; }
  ${docPageCss(style)}
  ${docChromeCss(d, { boxLabelA4: 72 })}
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(cfg.fields, DOC_FIELD_CATALOGS["fasonDirectShip"], d)}
`,
    style,
  );

  // Nüsha rozeti + konumlu bloklar + tek seferlik baskı notu + damga/QR çubuğu.
  const copyBadge = docCopyBadge(cfg, esc);
  const blocksTop = docBlocksHtml(cfg, "afterHeader", esc);
  const blocksBottom = docBlocksHtml(cfg, "beforeSignatures", esc);
  const printNote = docPrintNoteHtml(meta.printNote, esc);
  const stampsBar = docStampsBar(cfg, meta, esc, { printedAt: "Basım", printedBy: "Basan" });

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<style>${css}</style></head>
<body>
  ${watermark}
  <div class="sheet">
    <header>
      <div class="hl">
        ${logo.left}
        <div class="company">${esc(company?.name ?? "")}</div>
        ${lhLines}
      </div>
      <div class="hr">
        ${logo.right}
        <div class="title">${esc(title)}</div>
        ${copyBadge}
        <div class="ln">İrsaliye No: <b>${esc(doc.shipmentNo ?? doc.dispatchNo)}</b></div>
        ${showFasonDispatchNo && doc.shipmentNo ? `<div class="ln">Fason Sevk No: <b>${esc(doc.dispatchNo)}</b></div>` : ""}
        <div class="ln">Tarih: <b>${esc(fmtDate(shippedDate))}</b></div>
        ${showBatchInfo && doc.batchNumber ? `<div class="ln">Parti No: <b>${esc(doc.batchNumber)}</b></div>` : ""}
      </div>
    </header>

    ${infoGrid}
    ${blocksTop}
    ${allocTable}
    ${rollTable}
    ${noteBlock}
    ${blocksBottom}
    ${printNote}
    ${signatures}
    ${stampsBar}
  </div>
</body></html>`;
}
