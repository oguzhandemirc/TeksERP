// =============================================================================
// ÖN MUHASEBE BELGELERİ — fatura · makbuz · mutabakat mektubu · çek bordrosu
// =============================================================================
// Dördü de aynı iskelete oturuyor (başlık · taraf kutusu · tablo · toplam ·
// imza); fark satır tablosunun kolonları ve toplam bloğu. `warehouse-doc`
// emsalindeki gerekçenin aynısı: ayrı dosyalar "aynı tabloyu iki yerde
// bakmak" demekti. İskeleti kuran `renderFinanceDoc` bu dosyaya ÖZELdir
// (export edilmez) — yeni bir ön muhasebe belgesi de buraya yazılır.
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
import {
  resolveDocTable,
  toHtmlCols,
  type DocCellKind,
  type DocCellValue,
  type DocColSpec,
  type DocFmtKit,
  type DocTablesPayload,
} from "./doc-model";
import { DOC_DENSITY, docChromeCss, resolveDocPageSize, scaleW } from "./doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "./doc-fields";
import type { PrintedDocSnapshot } from "../printed-document.service";
import { fmtDate } from "./fmt-date";
import { upperTr } from "../../utils/tr-case";

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

/** Mutabakat satırı — TEK para birimi. Tutarlar STRING (Decimal serileştirmesi). */
export interface ReconciliationBalanceRow {
  currency: string;
  debit: string;
  credit: string;
  /** BORÇ − ALACAK. POZİTİF = cari BİZE borçlu (projenin tek yön sözleşmesi). */
  balance: string;
}

export interface ReconciliationLetterDoc {
  header: {
    documentNo: string;
    /** Düzenleme tarihi — mektubun kesildiği gün. */
    date: string | null;
    /** BAKİYE KESİTİ — içeriğin tarihi; düzenleme tarihinden FARKLI olabilir. */
    asOf: string | null;
    partyName: string;
    partyCode: string | null;
    partyTaxInfo: string | null;
    createdBy: string | null;
  };
  balances: ReconciliationBalanceRow[];
  notes: string | null;
}

/** Bordro satırı — çekin kâğıda basılan kimliği + tutarı. */
export interface ChequeDeliveryLine {
  docNo: string;
  serialNo: string | null;
  issueDate: string | null;
  dueDate: string | null;
  drawerName: string | null;
  bankName: string | null;
  currency: string;
  amount: string;
}

/** Para birimi bazlı ara toplam (H6: farklı para birimleri TOPLANMAZ). */
export interface ChequeDeliveryTotal {
  currency: string;
  count: number;
  amount: string;
}

export interface ChequeDeliveryNoteDoc {
  header: {
    documentNo: string;
    /** TESLİM tarihi. */
    date: string | null;
    kind: string;
    kindLabel: string;
    /** Teslim edilen taraf — banka hesabı / cari / serbest metin (biri ya da hiçbiri). */
    targetName: string | null;
    targetKindLabel: string | null;
    createdBy: string | null;
  };
  lines: ChequeDeliveryLine[];
  totals: ChequeDeliveryTotal[];
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

/** Bölüm açık mı — ayar yoksa AÇIK (blocklist semantiği, belge emsali). */
const sectionOn = (sections: Record<string, boolean> | undefined, key: string): boolean =>
  sections?.[key] !== false;

/** Belge başlığı — PDF ile Excel aynı metni basar. */
function financeDocTitle(override: string | undefined, fallback: string): string {
  return (override?.trim() || fallback).toUpperCase();
}

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
    /**
     * BEYAN/RİCA metni (`.decl`) — tablodan ve toplam bloğundan SONRA basılır.
     *
     * ⚠️ `notes`/`footerNote` ile karıştırma: bunlar OPSİYONEL açıklamalardır,
     * beyan ise belgenin HUKUKİ CÜMLESİDİR ("mutabık olup olmadığınızı imzalayıp
     * iade ediniz" / "aşağıdaki kıymetler teslim edilmiştir"). O cümle olmadan
     * kâğıt yalnız bir dökümdür ve karşı taraf neyi imzaladığını bilmez.
     * Verilmezse tek bayt CSS/HTML basılmaz — fatura ve makbuzun çıktısı
     * bayt-bayt korunur (kalite sertifikasındaki `.decl` deseni).
     */
    declaration?: string;
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

  const title = financeDocTitle(cfg.titleOverride, opts.defaultTitle);
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
  // ⚠️ Bölüm kapatılabilir ("declaration") ama VARSAYILAN AÇIK: beyan cümlesini
  // sessizce düşürmek belgenin anlamını değiştirir, bu yüzden opt-out.
  const declBlock =
    opts.declaration && sectionOn(cfg.sections, "declaration")
      ? `<div class="decl">${esc(opts.declaration)}</div>`
      : "";

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
  ${
    // Beyan bloğu YOKSA tek bayt CSS de basılmaz (fatura/makbuz parmak izi korunur).
    opts.declaration
      ? `.decl { clear: both; margin-top: ${scaleW(d, 12)}px; font-size: ${d.note}px; white-space: pre-wrap;
          border: 1px solid #cbd5e1; padding: ${scaleW(d, 8)}px ${scaleW(d, 10)}px; border-radius: 4px; font-style: italic; }`
      : ""
  }
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
        ${sectionOn(cfg.sections, "date") ? `<div class="ln">Tarih: <b>${esc(fmtDate(opts.date, "—"))}</b></div>` : ""}
        ${opts.headerLines.join("")}
      </div>
    </header>
    ${blocksTop}
    ${partyBox}
    ${opts.table}
    ${opts.totalsBox}
    ${declBlock}
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
        ? `<div class="ln">Vade: <b>${esc(fmtDate(h.dueDate, "—"))}</b></div>`
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
      <div class="row grand"><span>${upperTr(esc(h.directionLabel))}</span><b>${esc(fmtMoney(doc.amount))} ${cur}</b></div>
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

// =============================================================================
// CARİ MUTABAKAT MEKTUBU (2026-08-15)
// =============================================================================
// ⚠️ FATURA/MAKBUZDAN FARKI: bu kâğıt karşı tarafa BİR SORU sorar ve imzalanıp
// GERİ GELMESİ beklenir. Bu yüzden beyan bloğu (`.decl`) opsiyonel bir süs
// değil, belgenin kendisidir; imza etiketleri de "Düzenleyen / Mutabıkız"tır
// ("Teslim Alan" DEĞİL — teslim alınan bir şey yok).
//
// ⚠️ TOPLAM SATIRI YOK ve bu bilinçli: farklı para birimlerinin bakiyeleri
// TOPLANMAZ (cari bakiye modelinin temel kuralı — `CariBalance` para birimi
// bazında ayrıdır). Tek satırlık bir "GENEL TOPLAM", 1.000 USD ile 30.000 TL'yi
// toplayıp anlamsız bir sayı basardı.

/** Bakiye işaretinin İNSAN KARŞILIĞI — mektubun en çok yanlış okunan yeri. */
function balanceSideLabel(balance: string): string {
  const n = Number(balance);
  if (!Number.isFinite(n) || n === 0) return "KAPALI";
  return n > 0 ? "BORÇ" : "ALACAK";
}

/** Mutlak tutar — işaret DURUM kolonunda yazıyor, sayıda tekrar edilmez. */
function fmtAbsMoney(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? fmtMoney(Math.abs(n).toFixed(2)) : fmtMoney(v);
}

export function renderReconciliationLetterHtml(
  snapshot: PrintedDocSnapshot,
  meta: RenderMeta = {},
): string {
  const doc = snapshot.doc as unknown as ReconciliationLetterDoc;
  const h = doc.header;
  const cfg = snapshot.docConfigOverride ?? {};
  const rows = doc.balances ?? [];

  const table = sectionOn(cfg.sections, "balanceTable")
    ? buildDocTable<ReconciliationBalanceRow>({
        className: "sec",
        caption: "BAKİYE DÖKÜMÜ",
        colCfg: cfg.columns?.balanceTable,
        rows,
        cols: [
          { key: "currency", label: "PARA", align: "c", width: "60px", cell: (r) => esc(r.currency) },
          { key: "debit", label: "BORÇ", align: "r", width: "110px", cell: (r) => esc(fmtMoney(r.debit)) },
          { key: "credit", label: "ALACAK", align: "r", width: "110px", cell: (r) => esc(fmtMoney(r.credit)) },
          { key: "balance", label: "BAKİYE", align: "r", width: "110px", cell: (r) => esc(fmtAbsMoney(r.balance)) },
          { key: "side", label: "DURUM", align: "c", width: "90px", cell: (r) => esc(balanceSideLabel(r.balance)) },
        ],
      })
    : "";

  // Hareketi hiç olmayan cari için mektup kesilebilir (sıfır mutabakatı da bir
  // mutabakattır) — o zaman tablo boş kalır ve kâğıt bunu AÇIKÇA söyler.
  const emptyBox = rows.length === 0
    ? `<div class="box"><div class="row"><span>Bakiye:</span><b>Belirtilen tarih itibarıyla kayıtlı hareket bulunmamaktadır.</b></div></div>`
    : "";

  const declaration =
    `${fmtDate(h.asOf, "—")} tarihi itibarıyla defterlerimizde görünen yukarıdaki bakiyeler için ` +
    "mutabakatınızı rica ederiz. Mutabık iseniz belgeyi kaşeleyip imzalayarak tarafımıza iade " +
    "etmenizi, mutabık değilseniz farkın gerekçesini bildirmenizi rica ederiz.\n" +
    "BORÇ bakiyesi tarafınızın firmamıza, ALACAK bakiyesi firmamızın tarafınıza olan borcunu ifade eder.";

  return renderFinanceDoc(snapshot, meta, {
    defaultTitle: "Cari Mutabakat Mektubu",
    configKey: "mutabakatMektubu",
    headerLines: [
      // ⚠️ KESİT TARİHİ BAŞLIKTA ve "Tarih"ten AYRI satırda: ikisi farklı günler
      // olabilir ve karıştırılırsa mektup başka bir dönemi anlatıyor sanılır.
      sectionOn(cfg.sections, "asOf")
        ? `<div class="ln">Bakiye Tarihi: <b>${esc(fmtDate(h.asOf, "—"))}</b></div>`
        : "",
    ].filter(Boolean),
    partyLines: [
      `<div class="row"><span>Cari:</span><b>${esc(h.partyName)}${h.partyCode ? ` (${esc(h.partyCode)})` : ""}</b></div>`,
      h.partyTaxInfo ? `<div class="row"><span>Vergi:</span><b>${esc(h.partyTaxInfo)}</b></div>` : "",
      sectionOn(cfg.sections, "createdBy") && h.createdBy
        ? `<div class="row"><span>Düzenleyen:</span><b>${esc(h.createdBy)}</b></div>`
        : "",
    ].filter(Boolean),
    caption: "BAKİYE DÖKÜMÜ",
    signatureLabels: ["Düzenleyen", "Mutabıkız — Kaşe / İmza"],
    notes: doc.notes,
    table,
    totalsBox: emptyBox,
    declaration,
    documentNo: h.documentNo,
    date: h.date,
  });
}

// =============================================================================
// ÇEK / SENET TESLİM BORDROSU (2026-08-15)
// =============================================================================
// Bordronun TEK kâğıdı (K1, 2026-09-26): resmî BRD de numarasız taslak da buradan
// basılır; Excel aynı kolon tanımından (`chequeTableCols`) türer. Karşı taraf hangi
// kâğıdı aldığını (belge/seri no), ne zaman paraya döneceğini (keşide/vade), kimin
// borçlandığını (keşideci/banka) ve ne kadar için imza attığını (para birimi +
// tutar) görmeli.
//
// ⚠️ FARKLI PARA BİRİMLERİ TOPLANMAZ (H6 kuralı birebir): tek TOPLAM yalnız
// liste tek para birimindeyken yazılır; her durumda para birimi bazlı ara
// toplamlar basılır. Karışık listede anlamsız bir toplam basmaktansa sayı hiç
// yazılmaz — kırılım kaybolmasın diye ara toplam kutusu HER ZAMAN var.
//
// ⚠️ YATAY (landscape) DEĞİL: H6 Excel/rapor dışa aktarımı için landscape
// seçmişti; resmi belge zinciri ortak A4 dikey chrome'unu kullanır (kâğıt boyu
// zaten `?pageSize=` ve şablon ayarıyla değiştirilebilir).

/** `fmtMoney`ın sayı biçimi — PDF hücresi ve Excel'in geri okuduğu değer aynı metinden. */
const fmtTr = (n: number | null | undefined, dec: number): string =>
  n == null || !Number.isFinite(n)
    ? ""
    : n.toLocaleString("tr-TR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const FMT_KIT: DocFmtKit = { esc, fmtTr };

const TEXT: DocCellKind = { t: "text" };
const INT: DocCellKind = { t: "int" };
const MONEY: DocCellKind = { t: "num", dec: 2 };

/** Tutarın ham değeri — `fmtMoney` ile aynı hâller: boş "—", sayı, çözülemeyen metin olduğu gibi. */
function moneyValue(v: string | null | undefined): DocCellValue {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}

const CHEQUE_TABLE_CAPTION = "TESLİM EDİLEN ÇEK / SENETLER";

/** Çek tablosunun TEK kolon tanımı — PDF (`toHtmlCols`) ve Excel (`resolveDocTable`) buradan türer. */
function chequeTableCols(single: ChequeDeliveryTotal | null): DocColSpec<ChequeDeliveryLine>[] {
  return [
    { key: "no", label: "SIRA", align: "c", width: "40px", kind: INT, value: (_r, i) => i + 1 },
    { key: "docNo", label: "BELGE NO", align: "l", cellClass: "mono", kind: TEXT, value: (r) => r.docNo },
    { key: "serialNo", label: "SERİ NO", align: "l", cellClass: "mono", kind: TEXT, value: (r) => r.serialNo ?? "—" },
    { key: "issueDate", label: "KEŞİDE", align: "c", width: "80px", kind: TEXT, value: (r) => fmtDate(r.issueDate, "—") },
    { key: "dueDate", label: "VADE", align: "c", width: "80px", kind: TEXT, value: (r) => fmtDate(r.dueDate, "—") },
    { key: "drawer", label: "KEŞİDECİ", align: "l", kind: TEXT, value: (r) => r.drawerName ?? "—" },
    { key: "bank", label: "BANKA", align: "l", kind: TEXT, value: (r) => r.bankName ?? "—" },
    { key: "currency", label: "PARA", align: "c", width: "50px", kind: TEXT, value: (r) => r.currency },
    {
      key: "amount", label: "TUTAR", align: "r", width: "100px", kind: MONEY,
      value: (r) => moneyValue(r.amount),
      // Karışık para biriminde hücre BOŞ — kırılım ara toplam kutusunda.
      foot: { value: single ? moneyValue(single.amount) : null },
    },
  ];
}

/**
 * Bordronun İÇERİK kararları — TEK ÇÖZÜCÜ. HTML (`renderChequeDeliveryNoteHtml`) ve
 * Excel (`renderChequeDeliveryNoteTables`) buradan türer; kolon, taraf satırı, toplam
 * ve beyan ikinci bir yerde yeniden kurulmaz.
 */
function chequeDeliveryParts(snapshot: PrintedDocSnapshot) {
  const doc = snapshot.doc as unknown as ChequeDeliveryNoteDoc;
  const h = doc.header;
  const cfg = snapshot.docConfigOverride ?? {};
  const lines = doc.lines ?? [];
  const totals = doc.totals ?? [];
  const single = totals.length === 1 ? totals[0]! : null;

  const party: Array<[string, string]> = [
    ...(h.targetName ? [[h.targetKindLabel ?? "Teslim Edilen", h.targetName] as [string, string]] : []),
    ["Adet", String(lines.length)],
    ...(sectionOn(cfg.sections, "createdBy") && h.createdBy ? [["Düzenleyen", h.createdBy] as [string, string]] : []),
  ];

  const declaration =
    (h.kind === "RECEIVED"
      ? "Aşağıda dökümü verilen çek/senetler portföyümüzden teslim edilmiştir."
      : "Aşağıda dökümü verilen çek/senetler tarafımızca düzenlenmiş olup teslim edilmiştir.") +
    (totals.length > 1
      ? "\nListede birden fazla para birimi vardır; farklı para birimleri toplanmadığı için tek TOPLAM yazılmamıştır — kırılım yukarıdadır."
      : "") +
    "\nİki nüsha düzenlenir; bir nüsha teslim alan tarafta kalır.";

  return {
    doc,
    h,
    cfg,
    lines,
    totals,
    party,
    declaration,
    cols: chequeTableCols(single),
    tableOn: sectionOn(cfg.sections, "chequeTable"),
    footLabel: `TOPLAM (${lines.length} adet)`,
    // Başlık YÖNDEN gelir: aldığımız kıymetlerin teslimi ile kendi borç
    // senetlerimizin teslimi aynı kâğıt değildir (H6 tek-yön kuralının başlıktaki
    // karşılığı) — tek "TESLİM BORDROSU" başlığı iki zıt olayı aynı görürdü.
    defaultTitle: `${h.kindLabel} Çek / Senet Teslim Bordrosu`,
  };
}

export function renderChequeDeliveryNoteHtml(
  snapshot: PrintedDocSnapshot,
  meta: RenderMeta = {},
): string {
  const p = chequeDeliveryParts(snapshot);

  const table = p.tableOn
    ? buildDocTable<ChequeDeliveryLine>({
        className: "sec",
        caption: CHEQUE_TABLE_CAPTION,
        colCfg: p.cfg.columns?.chequeTable,
        rows: p.lines,
        footLabel: p.footLabel,
        cols: toHtmlCols(p.cols, FMT_KIT),
      })
    : "";

  const totalsBox = p.totals.length
    ? `<div class="tot">
        ${p.totals
          .map(
            (t) =>
              `<div class="row"><span>${esc(t.currency)} (${t.count} adet)</span><b>${esc(fmtMoney(t.amount))} ${esc(t.currency)}</b></div>`,
          )
          .join("")}
      </div>`
    : "";

  return renderFinanceDoc(snapshot, meta, {
    defaultTitle: p.defaultTitle,
    configKey: "cekTeslimBordrosu",
    headerLines: [],
    partyLines: p.party.map(([l, v]) => `<div class="row"><span>${esc(l)}:</span><b>${esc(v)}</b></div>`),
    caption: CHEQUE_TABLE_CAPTION,
    signatureLabels: ["Teslim Eden", "Teslim Alan"],
    notes: p.doc.notes,
    table,
    totalsBox,
    declaration: p.declaration,
    documentNo: p.h.documentNo,
    date: p.h.date,
  });
}

/**
 * Excel'in içeriği — HTML ile AYNI çözücüden (`chequeDeliveryParts`): başlık bloğu,
 * çek tablosu (şablonun gizle/sırala/başlık ayarı dahil), ara toplamlar ve beyan.
 */
export function renderChequeDeliveryNoteTables(
  snapshot: PrintedDocSnapshot,
  meta: RenderMeta = {},
): DocTablesPayload {
  const p = chequeDeliveryParts(snapshot);
  const wm = meta.draft ? "TASLAK" : meta.status === "VOIDED" ? "İPTAL" : meta.status === "SUPERSEDED" ? "ESKİ KOPYA" : null;
  const header: Array<[string, string | null]> = [
    ...(wm ? [[wm, null] as [string, null]] : []),
    [financeDocTitle(p.cfg.titleOverride, p.defaultTitle), null],
    ...(snapshot.company?.name ? [[snapshot.company.name, null] as [string, null]] : []),
    ...(sectionOn(p.cfg.sections, "documentNo") ? [["Belge No", p.h.documentNo] as [string, string]] : []),
    ...(sectionOn(p.cfg.sections, "date") ? [["Tarih", fmtDate(p.h.date, "—")] as [string, string]] : []),
    ...p.party,
  ];
  const notes = [
    ...p.totals.map((t) => `${t.currency} (${t.count} adet): ${fmtMoney(t.amount)} ${t.currency}`),
    ...(sectionOn(p.cfg.sections, "declaration") ? p.declaration.split("\n") : []),
    ...(p.doc.notes ? [`Not: ${p.doc.notes}`] : []),
    ...(p.cfg.footerNote ? [p.cfg.footerNote] : []),
    ...(meta.printNote?.trim() ? [meta.printNote] : []),
  ];
  return {
    docType: "CHEQUE_DELIVERY_NOTE",
    documentNo: p.h.documentNo,
    header,
    tables: p.tableOn
      ? [
          resolveDocTable({
            key: "chequeTable",
            caption: CHEQUE_TABLE_CAPTION,
            cols: p.cols,
            rows: p.lines,
            colCfg: p.cfg.columns?.chequeTable,
            footLabel: p.footLabel,
            kit: FMT_KIT,
          }),
        ]
      : [],
    notes,
  };
}
