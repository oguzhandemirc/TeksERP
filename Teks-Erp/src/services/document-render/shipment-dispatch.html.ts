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
//   2) ÇUVAL LİSTESİ: ÇUVAL NO | METRE TOPLAMI | KG TOPLAMI | TOP ADEDİ
//   3) ÇEKİ LİSTESİ : ÇUVAL NO | BARKOD | DESEN | VARYANT | METRE | KG
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

/** Belge etiketleri — cfg.language: tr | en | auto (auto → EXPORT sevkiyatta EN). */
const LABELS = {
  tr: {
    title: "SEVK İRSALİYESİ",
    to: "SAYIN",
    taxNo: "V.No",
    branch: "Şube",
    exportCode: "İhracat Kodu",
    code: "Kod",
    docNo: "İrsaliye No",
    date: "Tarih",
    direction: "Yön",
    domestic: "Yurtiçi",
    export: "Yurtdışı",
    customsNo: "Gümrük/İhracat No",
    orders: "Sipariş",
    plate: "Plaka",
    driver: "Şoför",
    carrier: "Taşıyıcı",
    urunCaption: "ÜRÜN LİSTESİ",
    stokAdi: "STOK ADI",
    topAdedi: "TOP ADEDİ",
    toplamMetre: "TOPLAM METRE",
    cuvalCaption: "ÇUVAL LİSTESİ",
    ambalajKodu: "ÇUVAL NO",
    metreToplami: "METRE TOPLAMI",
    kgToplami: "KG TOPLAMI",
    paketSayisi: "TOP ADEDİ",
    cekiCaption: "ÇEKİ LİSTESİ",
    cuvalNo: "ÇUVAL NO",
    barkodNo: "BARKOD NO",
    desen: "DESEN",
    varyant: "VARYANT",
    en: "EN",
    metre: "METRE",
    kg: "KG",
    toplam: "TOPLAM",
    sigDefaults: ["Teslim Eden", "Teslim Alan"],
    wmDraft: "TASLAK",
    wmVoid: "İPTAL",
    wmOld: "ESKİ KOPYA",
    printedAt: "Basım",
    printedBy: "Basan",
  },
  en: {
    title: "DELIVERY NOTE",
    to: "TO",
    taxNo: "Tax No",
    branch: "Branch",
    exportCode: "Export Code",
    code: "Code",
    docNo: "Delivery Note No",
    date: "Date",
    direction: "Destination",
    domestic: "Domestic",
    export: "Export",
    customsNo: "Customs/Export No",
    orders: "Orders",
    plate: "Plate",
    driver: "Driver",
    carrier: "Carrier",
    urunCaption: "PRODUCT LIST",
    stokAdi: "ITEM NAME",
    topAdedi: "ROLL COUNT",
    toplamMetre: "TOTAL METERS",
    cuvalCaption: "PACKAGE LIST",
    ambalajKodu: "PACKAGE NO",
    metreToplami: "TOTAL METERS",
    kgToplami: "TOTAL KG",
    paketSayisi: "ROLL COUNT",
    cekiCaption: "PACKING LIST",
    cuvalNo: "PACKAGE NO",
    barkodNo: "BARCODE",
    desen: "PATTERN",
    varyant: "VARIANT",
    en: "WIDTH",
    metre: "METERS",
    kg: "KG",
    toplam: "TOTAL",
    sigDefaults: ["Delivered By", "Received By"],
    wmDraft: "DRAFT",
    wmVoid: "VOID",
    wmOld: "SUPERSEDED",
    printedAt: "Printed",
    printedBy: "By",
  },
} as const;

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
  /** En (cm) — eski donmuş snapshot'larda yok (opsiyonel); kolonu açık-kapatılabilir. */
  width?: number | null;
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
    /** ŞUBE ihracat kodu (CustomerBranch.code) — tek "İhracat Kodu" satırının
     *  ÖNCELİKLİ kaynağı: dolu ise şirket exportCode'unun önüne geçer
     *  (branchCode ?? customerExportCode). Satır "exportCode" toggle'ına bağlı. */
    branchCode: string | null;
    /** ŞİRKET ihracat kodu (Customer.exportCode) — şube ihracat kodu boşsa aynı
     *  "İhracat Kodu" satırına yedek olarak basılır; "exportCode" toggle'ıyla
     *  açılıp kapanır. Eski donmuş snapshot'larda alan yoktur (opsiyonel). */
    customerExportCode?: string | null;
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
  const style = resolveDocStyle(cfg.style, { marginMm: 9 });
  const logo = docLogoHtml(meta.logoDataUrl, cfg);
  const company = snapshot.company;
  const lh = company?.letterhead ?? { addressLine: "", phone: "", taxInfo: "" };

  const h = doc.header;
  const t = doc.totals;
  // Enler boş bırakılsın mı (kolon durur, değer gelmez — elle doldurma).
  const blankWidths = cfg.blankWidths === true;
  const lang =
    cfg.language === "en" || (cfg.language === "auto" && h?.destination === "EXPORT")
      ? "en"
      : "tr";
  const L = LABELS[lang];

  const title = (cfg.titleOverride?.trim() || L.title).toUpperCase();
  const showLetterhead = cfg.showLetterhead !== false;
  const showSignatures = cfg.showSignatures !== false;
  const sigLabels =
    cfg.signatureLabels && cfg.signatureLabels.length
      ? cfg.signatureLabels
      : [...L.sigDefaults];
  const products = doc.products ?? [];
  const sacks = doc.sacks ?? [];
  const cekiRows = doc.cekiRows ?? [];

  // Antet (gönderen) satırları — sadece dolu olanlar.
  const lhLines = showLetterhead
    ? [lh.addressLine, lh.phone, lh.taxInfo ? `V.D./No: ${lh.taxInfo}` : "", ...(lh.extraLines ?? [])]
        .filter((s) => s && s.trim())
        .map((s) => `<div class="lh-line">${esc(s)}</div>`)
        .join("")
    : "";

  const watermark = meta.draft
    ? `<div class="wm wm-draft">${L.wmDraft}</div>`
    : meta.status === "VOIDED"
      ? `<div class="wm">${L.wmVoid}</div>`
      : meta.status === "SUPERSEDED"
        ? `<div class="wm wm-old">${L.wmOld}</div>`
        : "";

  // İhracat Kodu — TEK satır: şube kodu doluysa onu, yoksa müşteri ihracat kodunu
  // bas (branchCode ?? customerExportCode). "exportCode" section toggle'ıyla açılıp
  // kapanabilir (varsayılan açık); ikisi de boşsa satır zaten basılmaz.
  // Alan aç/kapa toggle'ları (hepsi varsayılan AÇIK — kapanmadıkça mevcut davranış).
  const showDocNo = sectionOn(cfg.sections, "docNo");
  const showDate = sectionOn(cfg.sections, "date");
  const showExportCode = sectionOn(cfg.sections, "exportCode");
  const showTaxNo = sectionOn(cfg.sections, "taxNo");
  const showBranchName = sectionOn(cfg.sections, "branchName");
  const showCustomerCode = sectionOn(cfg.sections, "customerCode");
  const showDirection = sectionOn(cfg.sections, "direction");
  const showProcedure = sectionOn(cfg.sections, "procedureCode");
  const showOrders = sectionOn(cfg.sections, "orders");
  const shipCode = h.branchCode ?? h.customerExportCode;
  const customerSub = [
    showTaxNo && h.customerTaxNumber ? `${L.taxNo}: ${esc(h.customerTaxNumber)}` : "",
    showBranchName && h.branchName ? `${L.branch}: ${esc(h.branchName)}` : "",
    showExportCode && shipCode ? `${L.exportCode}: ${esc(shipCode)}` : "",
    showCustomerCode && h.customerCode ? `${L.code}: ${esc(h.customerCode)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const yon = h.destination === "EXPORT" ? L.export : L.domestic;
  const headRight = [
    showDocNo ? `<div class="ln">${L.docNo}: <b>${esc(h.shipmentNo)}</b></div>` : "",
    showDate ? `<div class="ln">${L.date}: <b>${esc(fmtDate(h.date))}</b></div>` : "",
    showDirection ? `<div class="ln">${L.direction}: <b>${esc(yon)}</b></div>` : "",
    showProcedure && h.procedureCode ? `<div class="ln">${L.customsNo}: <b>${esc(h.procedureCode)}</b></div>` : "",
    showOrders && h.orderNos ? `<div class="ln sub">${L.orders}: ${esc(h.orderNos)}</div>` : "",
  ]
    .filter(Boolean)
    .join("");

  const vehicleBits = sectionOn(cfg.sections, "vehicleInfo")
    ? [
        h.plateNumber ? `${L.plate}: <b>${esc(h.plateNumber)}</b>` : "",
        h.driverName ? `${L.driver}: <b>${esc(h.driverName)}</b>` : "",
        h.carrier ? `${L.carrier}: <b>${esc(h.carrier)}</b>` : "",
      ].filter(Boolean)
    : [];
  const vehicleRow = vehicleBits.length
    ? `<div class="meta-row">${vehicleBits.join(" &nbsp;·&nbsp; ")}</div>`
    : "";

  // 1) ÜRÜN LİSTESİ — kolonlar cfg.columns.urun ile aç/kapa + sıralanır.
  const urunSection = sectionOn(cfg.sections, "urun")
    ? buildDocTable<ShipmentDocProduct>({
        className: "sec",
        caption: L.urunCaption,
        colCfg: cfg.columns?.urun,
        footLabel: L.toplam,
        rows: products,
        cols: [
          { key: "name", label: L.stokAdi, align: "l", cell: (p) => esc(p.name) },
          { key: "rollCount", label: L.topAdedi, align: "r", cell: (p) => esc(fmtCount(p.rollCount)), foot: esc(fmtCount(t.totalRolls)) },
          { key: "totalMeters", label: L.toplamMetre, align: "r", cell: (p) => esc(fmtQty(p.totalMeters)), foot: esc(fmtQty(t.totalMeters)) },
        ],
      })
    : "";

  // 2) ÇUVAL LİSTESİ
  const cuvalSection = sectionOn(cfg.sections, "cuval")
    ? buildDocTable<ShipmentDocSack>({
        className: "sec",
        caption: L.cuvalCaption,
        colCfg: cfg.columns?.cuval,
        footLabel: L.toplam,
        rows: sacks,
        cols: [
          { key: "code", label: L.ambalajKodu, align: "l", cell: (s) => esc(s.code) },
          { key: "totalMeters", label: L.metreToplami, align: "r", cell: (s) => esc(fmtQty(s.totalMeters)), foot: esc(fmtQty(t.totalMeters)) },
          { key: "totalKg", label: L.kgToplami, align: "r", cell: (s) => esc(fmtQty(s.totalKg)), foot: esc(fmtQty(t.totalKg)) },
          { key: "packageCount", label: L.paketSayisi, align: "r", cell: (s) => esc(fmtCount(s.packageCount)), foot: esc(fmtCount(t.totalRolls)) },
        ],
      })
    : "";

  // 3) ÇEKİ LİSTESİ
  const cekiSection = sectionOn(cfg.sections, "ceki")
    ? buildDocTable<ShipmentDocCeki>({
        className: "sec",
        caption: L.cekiCaption,
        colCfg: cfg.columns?.ceki,
        footLabel: L.toplam,
        rows: cekiRows,
        cols: [
          { key: "sackCode", label: L.cuvalNo, align: "l", cell: (c) => esc(c.sackCode) },
          { key: "barcode", label: L.barkodNo, align: "l", cell: (c) => esc(c.barcode ?? "—") },
          { key: "desen", label: L.desen, align: "l", cell: (c) => esc(c.desen) },
          { key: "varyant", label: L.varyant, align: "l", cell: (c) => esc(c.varyant) },
          { key: "width", label: L.en, align: "c", cell: (c) => (blankWidths ? "" : c.width != null ? `${esc(Math.round(c.width))} cm` : "—") },
          { key: "meters", label: L.metre, align: "r", cell: (c) => esc(fmtQty(c.meters)), foot: esc(fmtQty(t.totalMeters)) },
          { key: "kg", label: L.kg, align: "r", cell: (c) => (c.kg > 0 ? esc(fmtQty(c.kg)) : ""), foot: esc(fmtQty(t.totalKg)) },
        ],
      })
    : "";

  const noteBlock = cfg.footerNote
    ? `<div class="note">${esc(cfg.footerNote)}</div>`
    : "";
  // Alt not konumu (şablon ayarı): "top" → tablolardan ÖNCE, aksi halde (default)
  // tablolardan sonra imza öncesinde. Tek seferlik baskı notu her zaman altta kalır.
  const noteAtTop = cfg.footerNotePlacement === "top";

  const signatures = showSignatures
    ? `<div class="sign">${sigLabels
        .map(
          (l) =>
            `<div class="sign-box"><div class="sign-line"></div><div class="sign-lbl">${esc(l)}</div></div>`,
        )
        .join("")}</div>`
    : "";

  // Nüsha rozeti + konumlu bloklar + tek seferlik baskı notu + damga/QR çubuğu.
  const copyBadge = docCopyBadge(cfg, esc);
  const blocksTop = docBlocksHtml(cfg, "afterHeader", esc);
  const blocksBottom = docBlocksHtml(cfg, "beforeSignatures", esc);
  const printNote = docPrintNoteHtml(meta.printNote, esc);
  const stampsBar = docStampsBar(cfg, meta, esc, {
    printedAt: L.printedAt,
    printedBy: L.printedBy,
  });

  const css = scaleDocCss(
    `
  * { box-sizing: border-box; }
  ${docPageCss(style)}
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
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docTableCss(style, [".sec"])}
`,
    style,
  );

  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<style>${css}</style></head>
<body>
  ${watermark}
  <div class="sheet">
    <header>
      <div class="hl">
        ${logo.left}
        <div class="company">${esc(company?.name ?? "")}</div>
        ${lhLines}
        <div class="sayin">${L.to}: <b>${esc(h.customerName)}</b></div>
        ${customerSub ? `<div class="sub">${customerSub}</div>` : ""}
      </div>
      <div class="hr">
        ${logo.right}
        <div class="title">${esc(title)}</div>
        ${copyBadge}
        ${headRight}
      </div>
    </header>

    ${vehicleRow}
    ${blocksTop}
    ${noteAtTop ? noteBlock + printNote : ""}
    ${urunSection}
    ${cuvalSection}
    ${cekiSection}
    ${noteAtTop ? "" : noteBlock + printNote}
    ${blocksBottom}
    ${signatures}
    ${stampsBar}
  </div>
</body></html>`;
}
