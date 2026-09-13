// =============================================================================
// Kartela Çeki Listesi — HTML renderer (TEK KAYNAK)
// =============================================================================
// Kartela fasonuna giden topların resmi çeki belgesi. Tüm cihazlar (Electron
// printHtmlString/iframe + mobil expo-print) bu backend HTML'ini basar → format
// her yerde aynı. Donmuş PrintedDocument snapshot'ından üretilir; mevcut
// KartelaCekiSheet (PrintableCeki) düzenini yansıtır:
//   üst:   firma anteti + başlık + Sevk No + Tarih
//   bölüm: Kartela Firması (subcontractorInfo) | Sevk Bilgileri (vehicleInfo)
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
  docBlankGridCss,
  docBlankGridHtml,
  docPrintNoteHtml,
  docStampsBar,
} from "./doc-style";
import { buildDocTable } from "./doc-table";
import { DOC_DENSITY, docChromeCss, resolveDocPageSize } from "./doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "./doc-fields";
import { fmtDate } from "./fmt-date";

interface KartelaCekiRoll {
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

/** Donmuş kartela çeki payload'ı — buildKartelaDispatchDoc ile aynı şekil. */
interface KartelaCekiDoc {
  dispatchNo: string;
  dispatchedAt: string;
  driverName: string | null;
  plateNumber: string | null;
  notes: string | null;
  subcontractor: { id: string; name: string; code: string | null };
  rolls: KartelaCekiRoll[];
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

/** Metre/kg: 1 ondalık (mevcut kartela çeki görünümüyle aynı). */
const fmtQty = (n: number | null | undefined): string => fmtTr(n, 1);

/** Bir bölüm açık mı — yalnız açıkça false ise gizle (varsayılan: göster). */
function sectionOn(sections: Record<string, boolean> | undefined, key: string): boolean {
  return sections?.[key] !== false;
}

export function renderKartelaCekiHtml(
  snapshot: PrintedDocSnapshot,
  meta: RenderMeta = {},
): string {
  const doc = snapshot.doc as unknown as KartelaCekiDoc;
  const cfg = snapshot.docConfigOverride ?? {};
  // Yoğunluk profili sayfa boyutundan çözülür; ortak chrome CSS'i oradan beslenir.
  const pageSize = resolveDocPageSize(cfg.style?.pageSize);
  const d = DOC_DENSITY[pageSize];
  const style = resolveDocStyle(cfg.style, { marginMm: 9 });
  const logo = docLogoHtml(meta.logoDataUrl, cfg);
  const company = snapshot.company;
  const lh = company?.letterhead ?? { addressLine: "", phone: "", taxInfo: "" };

  const title = (cfg.titleOverride?.trim() || "KARTELA ÇEKİ LİSTESİ").toUpperCase();
  const showLetterhead = cfg.showLetterhead !== false;
  const showSignatures = cfg.showSignatures !== false;
  const sigLabels =
    cfg.signatureLabels && cfg.signatureLabels.length
      ? cfg.signatureLabels
      : ["Teslim Eden", "Teslim Alan"];

  const rolls = doc.rolls ?? [];
  const t = doc.totals;

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

  // Bölüm grid: Kartela Firması + Sevk Bilgileri.
  const showSub = sectionOn(cfg.sections, "subcontractorInfo");
  const showVeh = sectionOn(cfg.sections, "vehicleInfo");
  const subBox = showSub
    ? `<div class="box"><div class="box-t">KARTELA FİRMASI</div>
        <div class="row"><span>Adı:</span><b>${esc(doc.subcontractor.name)}</b></div>
        ${doc.subcontractor.code ? `<div class="row"><span>Kod:</span><b>${esc(doc.subcontractor.code)}</b></div>` : ""}
      </div>`
    : "";
  const vehBox = showVeh
    ? `<div class="box"><div class="box-t">SEVK BİLGİLERİ</div>
        <div class="row"><span>Plaka:</span><b>${esc(doc.plateNumber || "—")}</b></div>
        <div class="row"><span>Şoför:</span><b>${esc(doc.driverName || "—")}</b></div>
        ${doc.notes ? `<div class="row"><span>Not:</span><b>${esc(doc.notes)}</b></div>` : ""}
      </div>`
    : "";
  const infoGrid = subBox || vehBox ? `<div class="info">${subBox}${vehBox}</div>` : "";

  // Toplar tablosu — kolonlar cfg.columns.rollTable ile aç/kapa + sıralanır.
  const rollTable = sectionOn(cfg.sections, "rollTable")
    ? `<div class="tbl-cap">Gönderilen Toplar (${esc(t.rollCount)})</div>` +
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
  ${docChromeCss(d, { boxLabelA4: 56 })}
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss(cfg)}
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(cfg.fields, DOC_FIELD_CATALOGS["kartelaCeki"], d)}
`,
    style,
  );

  // Nüsha rozeti + konumlu bloklar + tek seferlik baskı notu + damga/QR çubuğu.
  const copyBadge = docCopyBadge(cfg, esc);
  const blocksTop = docBlocksHtml(cfg, "afterHeader", esc) + docBlankGridHtml(cfg, "afterHeader", esc);
  const blocksBottom = docBlocksHtml(cfg, "beforeSignatures", esc) + docBlankGridHtml(cfg, "beforeSignatures", esc);
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
        <div class="ln">Sevk No: <b>${esc(doc.dispatchNo)}</b></div>
        <div class="ln">Tarih: <b>${esc(fmtDate(doc.dispatchedAt))}</b></div>
      </div>
    </header>

    ${infoGrid}
    ${blocksTop}
    ${rollTable}
    ${noteBlock}
    ${blocksBottom}
    ${printNote}
    ${signatures}
    ${stampsBar}
  </div>
</body></html>`;
}
