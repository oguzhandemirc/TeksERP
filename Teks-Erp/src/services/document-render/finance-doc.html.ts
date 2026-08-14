// =============================================================================
// ÖN MUHASEBE BELGELERİ — iç fatura + tahsilat/ödeme makbuzu
// =============================================================================
// İkisi de aynı iskelete oturuyor (başlık · taraf kutusu · tablo · toplam ·
// imza); fark satır tablosunun kolonları ve toplam bloğu. `warehouse-doc`
// emsalindeki gerekçenin aynısı: ayrı iki dosya "aynı tabloyu iki yerde
// bakmak" demekti.
//
// ⚠️ FATURA ile MAKBUZ FARKLI ŞEY SÖYLER, karıştırma:
//   • Fatura BORÇ doğurur (mal/hizmet karşılığı) — kalemleri, KDV'si, tevkifatı
//     vardır ve cari deftere onayda işler.
//   • Makbuz ÖDEMENİN İZİdir (para el değiştirdi) — tek satırdır, KDV'si yoktur.
// Aynı kâğıt gibi görünmeleri kullanıcıyı yanıltır; bu yüzden başlıkları,
// tablo başlıkları ve imza etiketleri bilinçli olarak ayrı.
//
// ⚠️ TUTARLAR SNAPSHOT'TAN BASILIR, yeniden HESAPLANMAZ. Belge donduğu anda
// tutar zaten `computeLineAmounts` ile Decimal olarak hesaplanıp yazıldı;
// burada tekrar çarpmak, yuvarlama farkıyla kâğıt ile defterin ayrışması
// demekti (JS float ile Decimal aynı sonucu vermez).
//
// ⚠️ Şablonun içinde BACKTICK kullanma — literal'i ortadan böler.
// =============================================================================
import {
  resolveDocStyle, docPageCss, docTableCss, scaleDocCss, docLogoHtml,
  docBlankGridCss, docBlankGridHtml, DOC_LOGO_CSS, DOC_STAMPS_CSS,
  docCopyBadge, docBlocksHtml, docPrintNoteHtml, docStampsBar,
} from "./doc-style";
import { buildDocTable } from "./doc-table";
import { DOC_DENSITY, docChromeCss, resolveDocPageSize, scaleW } from "./doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "./doc-fields";
import type { PrintedDocSnapshot } from "../printed-document.service";

/** Fatura kalemi — tutarlar STRING (Decimal serileştirmesi; float'a çevrilmez). */
export interface InvoiceDocLine {
  description: string;
  qty: string;
  unit: string;
  unitPrice: string;
  discountRate: string;
  vatRate: string;
  lineNet: string;
  lineVat: string;
}

export interface InvoiceDoc {
  header: {
    documentNo: string;
    date: string | null;
    dueDate: string | null;
    type: string;
    typeLabel: string;
    partyName: string;
    partyCode: string | null;
    partyTaxInfo: string | null;
    currency: string;
    exchangeRate: string | null;
    externalNo: string | null;
    createdBy: string | null;
  };
  lines: InvoiceDocLine[];
  totals: { net: string; vat: string; withholding: string; grand: string; grandTry: string | null };
  notes: string | null;
}

export interface PaymentReceiptDoc {
  header: {
    documentNo: string;
    date: string | null;
    direction: string;
    directionLabel: string;
    partyName: string;
    partyCode: string | null;
    method: string;
    methodLabel: string;
    accountName: string | null;
    currency: string;
    exchangeRate: string | null;
    createdBy: string | null;
  };
  amount: string;
  amountTry: string | null;
  notes: string | null;
}

interface RenderMeta {
  status?: string;
  draft?: boolean;
  logoDataUrl?: string | null;
  printNote?: string | null;
  printedAt?: string | null;
  printedBy?: string | null;
}

const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** Decimal string → tr-TR gösterimi. Sayıya çevirmeden ÖNCE null/boş elenir. */
function fmtMoney(v: string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return esc(v);
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQty(v: string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return esc(v);
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("tr-TR");
}

/** Bölüm açık mı — ayar yoksa AÇIK (blocklist semantiği, belge emsali). */
const sectionOn = (sections: Record<string, boolean> | undefined, key: string): boolean =>
  sections?.[key] !== false;

function renderFinanceDoc(
  snapshot: PrintedDocSnapshot,
  meta: RenderMeta,
  opts: {
    defaultTitle: string;
    configKey: string;
    headerLines: string[];
    partyLines: string[];
    caption: string;
    signatureLabels: string[];
    notes: string | null;
    table: string;
    totalsBox: string;
    documentNo: string;
    date: string | null;
  },
): string {
  const cfg = snapshot.docConfigOverride ?? {};
  const pageSize = resolveDocPageSize(cfg.style?.pageSize);
  const d = DOC_DENSITY[pageSize];
  const style = resolveDocStyle(cfg.style, { marginMm: 9 });
  const logo = docLogoHtml(meta.logoDataUrl, cfg);
  const company = snapshot.company;
  const lh = company?.letterhead ?? { addressLine: "", phone: "", taxInfo: "" };

  const title = (cfg.titleOverride?.trim() || opts.defaultTitle).toUpperCase();
  const showLetterhead = cfg.showLetterhead !== false;
  const showSignatures = cfg.showSignatures !== false;
  const sigLabels = cfg.signatureLabels?.length ? cfg.signatureLabels : opts.signatureLabels;

  const lhLines = showLetterhead
    ? [lh.addressLine, lh.phone, ...(lh.extraLines ?? [])]
        .filter((s) => s && s.trim()).map((s) => `<div class="lh-line">${esc(s)}</div>`).join("")
    : "";

  const watermark = meta.draft ? `<div class="wm wm-draft">TASLAK</div>`
    : meta.status === "VOIDED" ? `<div class="wm">İPTAL</div>`
      : meta.status === "SUPERSEDED" ? `<div class="wm wm-old">ESKİ KOPYA</div>` : "";

  const partyBox = opts.partyLines.length ? `<div class="box">${opts.partyLines.join("")}</div>` : "";
  const notesBox = opts.notes
    ? `<div class="box"><div class="row"><span>Not:</span><b>${esc(opts.notes)}</b></div></div>`
    : "";
  const signatures = showSignatures
    ? `<div class="sign">${sigLabels.map((l: string) => `<div class="sign-box"><div class="sign-line"></div><div class="sign-lbl">${esc(l)}</div></div>`).join("")}</div>`
    : "";
  const noteBlock = cfg.footerNote ? `<div class="note">${esc(cfg.footerNote)}</div>` : "";

  const css = scaleDocCss(
    `
  * { box-sizing: border-box; }
  ${docPageCss(style)}
  ${docChromeCss(d, { boxLabelA4: 104 })}
  /* Ön muhasebe belgelerine ÖZEL — ortak chrome'dan SONRA basılır ki kazansın.
     .box tek başına duran bir kutudur (taraf bilgisi), flex çocuğu DEĞİL. */
  .sec { margin-top: ${scaleW(d, 6)}px; }
  .sec th.caption { background: #e2e8f0; text-align: center; font-size: ${d.secCaption}px; font-weight: 800; letter-spacing: 1px; padding: ${scaleW(d, 5)}px; }
  .sec thead th:not(.caption) { background: #f1f5f9; font-weight: 700; font-size: ${d.secHead}px; text-transform: none; }
  .box { flex: none; margin-top: ${scaleW(d, 8)}px; }
  .box .row { margin-top: 2px; }
  /* Toplam bloğu SAĞA yaslı ve dar: muhasebe belgesi standardı — gözün
     rakamları tek sütunda alt alta takip etmesi için. */
  .tot { margin-top: ${scaleW(d, 8)}px; margin-left: auto; width: ${scaleW(d, 260)}px; }
  .tot .row { display: flex; justify-content: space-between; padding: 2px 0; }
  .tot .grand { border-top: 2px solid #0f172a; margin-top: 3px; padding-top: 4px; font-weight: 800; font-size: ${d.secCell}px; }
  .tot .try { color: #475569; font-weight: 600; }
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss(cfg)}
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(cfg.fields, DOC_FIELD_CATALOGS[opts.configKey], d)}
`,
    style,
  );

  const copyBadge = docCopyBadge(cfg, esc);
  const blocksTop = docBlocksHtml(cfg, "afterHeader", esc) + docBlankGridHtml(cfg, "afterHeader", esc);
  const blocksBottom = docBlocksHtml(cfg, "beforeSignatures", esc) + docBlankGridHtml(cfg, "beforeSignatures", esc);
  const printNote = docPrintNoteHtml(meta.printNote, esc);
  const stampsBar = docStampsBar(cfg, meta, esc, { printedAt: "Basım", printedBy: "Basan" });

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>${css}</style></head>
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
        ${sectionOn(cfg.sections, "documentNo") ? `<div class="ln">Belge No: <b>${esc(opts.documentNo)}</b></div>` : ""}
        ${sectionOn(cfg.sections, "date") ? `<div class="ln">Tarih: <b>${esc(fmtDate(opts.date))}</b></div>` : ""}
        ${opts.headerLines.join("")}
      </div>
    </header>
    ${blocksTop}
    ${partyBox}
    ${opts.table}
    ${opts.totalsBox}
    ${notesBox}
    ${noteBlock}
    ${blocksBottom}
    ${printNote}
    ${signatures}
    ${stampsBar}
  </div>
</body></html>`;
}

export function renderInvoiceInternalHtml(snapshot: PrintedDocSnapshot, meta: RenderMeta = {}): string {
  const doc = snapshot.doc as unknown as InvoiceDoc;
  const h = doc.header;
  const cfg = snapshot.docConfigOverride ?? {};
  const lines = doc.lines ?? [];
  const cur = esc(h.currency);

  const table = sectionOn(cfg.sections, "lineTable")
    ? buildDocTable<InvoiceDocLine>({
        className: "sec",
        caption: "FATURA KALEMLERİ",
        colCfg: cfg.columns?.lineTable,
        rows: lines,
        footLabel: `TOPLAM (${lines.length} kalem)`,
        cols: [
          { key: "description", label: "AÇIKLAMA", align: "l", cell: (r) => esc(r.description) },
          { key: "qty", label: "MİKTAR", align: "r", width: "80px", cell: (r) => `${esc(fmtQty(r.qty))} ${esc(r.unit)}` },
          { key: "unitPrice", label: "B.FİYAT", align: "r", width: "90px", cell: (r) => esc(fmtMoney(r.unitPrice)) },
          { key: "discountRate", label: "İSK.%", align: "c", width: "55px", cell: (r) => esc(fmtQty(r.discountRate)) },
          { key: "vatRate", label: "KDV%", align: "c", width: "55px", cell: (r) => esc(fmtQty(r.vatRate)) },
          {
            key: "lineNet", label: "TUTAR", align: "r", width: "100px",
            cell: (r) => esc(fmtMoney(r.lineNet)),
            foot: esc(fmtMoney(doc.totals.net)),
          },
        ],
      })
    : "";

  // Tevkifat satırı YALNIZ varsa basılır: sıfır tevkifatlı faturada boş bir
  // "Tevkifat: 0,00" satırı, olmayan bir yükümlülüğü varmış gibi gösterir.
  const wh = Number(doc.totals.withholding);
  const totalsBox = sectionOn(cfg.sections, "totals")
    ? `<div class="tot">
        <div class="row"><span>Ara Toplam</span><b>${esc(fmtMoney(doc.totals.net))} ${cur}</b></div>
        <div class="row"><span>KDV</span><b>${esc(fmtMoney(doc.totals.vat))} ${cur}</b></div>
        ${Number.isFinite(wh) && wh > 0 ? `<div class="row"><span>Tevkifat (−)</span><b>${esc(fmtMoney(doc.totals.withholding))} ${cur}</b></div>` : ""}
        <div class="row grand"><span>GENEL TOPLAM</span><b>${esc(fmtMoney(doc.totals.grand))} ${cur}</b></div>
        ${h.currency !== "TRY" && doc.totals.grandTry ? `<div class="row try"><span>TL Karşılığı (kur ${esc(fmtQty(h.exchangeRate))})</span><b>${esc(fmtMoney(doc.totals.grandTry))} TRY</b></div>` : ""}
      </div>`
    : "";

  return renderFinanceDoc(snapshot, meta, {
    // Başlık TÜRDEN gelir: alış faturası "aldık", satış "sattık" der. Tek bir
    // "FATURA" başlığı iki zıt olayı aynı kâğıtta gösterirdi.
    defaultTitle: h.typeLabel,
    configKey: "fatura",
    headerLines: [
      sectionOn(cfg.sections, "dueDate") && h.dueDate
        ? `<div class="ln">Vade: <b>${esc(fmtDate(h.dueDate))}</b></div>`
        : "",
      sectionOn(cfg.sections, "externalNo") && h.externalNo
        ? `<div class="ln">Belge/İrsaliye No: <b>${esc(h.externalNo)}</b></div>`
        : "",
    ].filter(Boolean),
    partyLines: [
      `<div class="row"><span>Cari:</span><b>${esc(h.partyName)}${h.partyCode ? ` (${esc(h.partyCode)})` : ""}</b></div>`,
      h.partyTaxInfo ? `<div class="row"><span>Vergi:</span><b>${esc(h.partyTaxInfo)}</b></div>` : "",
      `<div class="row"><span>Para Birimi:</span><b>${cur}</b></div>`,
      sectionOn(cfg.sections, "createdBy") && h.createdBy
        ? `<div class="row"><span>Düzenleyen:</span><b>${esc(h.createdBy)}</b></div>`
        : "",
    ].filter(Boolean),
    caption: "FATURA KALEMLERİ",
    signatureLabels: ["Düzenleyen", "Teslim Alan"],
    notes: doc.notes,
    table,
    totalsBox,
    documentNo: h.documentNo,
    date: h.date,
  });
}

export function renderPaymentReceiptHtml(snapshot: PrintedDocSnapshot, meta: RenderMeta = {}): string {
  const doc = snapshot.doc as unknown as PaymentReceiptDoc;
  const h = doc.header;
  const cfg = snapshot.docConfigOverride ?? {};
  const cur = esc(h.currency);

  // ⚠️ MAKBUZDA SATIR TABLOSU YOK — makbuz TEK bir olayı belgeler ("şu kadar
  // para alındı"). Faturanın kalem tablosunu buraya kopyalamak, tek satırlık
  // bir tabloyla kâğıdı faturaya benzetir ve ikisi karıştırılır.
  const totalsBox = `<div class="tot">
      <div class="row grand"><span>${esc(h.directionLabel).toLocaleUpperCase("tr")}</span><b>${esc(fmtMoney(doc.amount))} ${cur}</b></div>
      ${h.currency !== "TRY" && doc.amountTry ? `<div class="row try"><span>TL Karşılığı (kur ${esc(fmtQty(h.exchangeRate))})</span><b>${esc(fmtMoney(doc.amountTry))} TRY</b></div>` : ""}
    </div>`;

  return renderFinanceDoc(snapshot, meta, {
    defaultTitle: h.directionLabel,
    configKey: "tahsilatMakbuzu",
    headerLines: [],
    partyLines: [
      `<div class="row"><span>Cari:</span><b>${esc(h.partyName)}${h.partyCode ? ` (${esc(h.partyCode)})` : ""}</b></div>`,
      `<div class="row"><span>Ödeme Şekli:</span><b>${esc(h.methodLabel)}</b></div>`,
      sectionOn(cfg.sections, "account") && h.accountName
        ? `<div class="row"><span>Kasa/Banka:</span><b>${esc(h.accountName)}</b></div>`
        : "",
      sectionOn(cfg.sections, "createdBy") && h.createdBy
        ? `<div class="row"><span>Düzenleyen:</span><b>${esc(h.createdBy)}</b></div>`
        : "",
    ].filter(Boolean),
    caption: "",
    // ⚠️ İmza etiketleri YÖNE göre: tahsilatta parayı biz ALIRIZ (müşteri öder),
    // ödemede biz VERİRİZ. Sabit "Teslim Eden / Teslim Alan" yarısında yanlış olurdu.
    signatureLabels:
      h.direction === "IN" ? ["Ödeyen", "Tahsil Eden"] : ["Ödeyen (Firma)", "Teslim Alan"],
    notes: doc.notes,
    table: "",
    totalsBox,
    documentNo: h.documentNo,
    date: h.date,
  });
}
