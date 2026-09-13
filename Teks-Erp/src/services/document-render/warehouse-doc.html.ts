// =============================================================================
// DEPO BELGELERİ — Transfer İrsaliyesi + Mal Kabul Fişi + Stok Sayım Tutanağı
// =============================================================================
// Üçü de aynı iskelete oturuyor: antet + taraf kutusu + tablo + toplam +
// imzalar. Ayrı dosyalar yazmak, aynı tabloyu üç yerde bakmak demekti (kolon
// eklendiğinde biri unutulur). Fark BAŞLIK BLOĞU ve TABLODUR:
//   • Transfer   : kaynak depo → hedef depo · taşınan toplar
//   • Mal Kabul  : tedarikçi + irsaliye no + giren depo · kabul edilen toplar
//   • Stok Sayım : sayılan depo · beklenen ↔ sayılan ↔ durum (kendi tablosunu
//                  `mainTableHtml` ile devralır — diğer ikisi bayt-bayt aynı)
//
// ⚠️ İç belgelerdir (müşteriye gitmez) — "SAYIN" bloğu yoktur. Yine de resmi
// belge zinciri aynıdır: donmuş snapshot + versiyon + İPTAL filigranı.
// =============================================================================

import type { PrintedDocStatus } from "@prisma/client";
import type { PrintedDocSnapshot } from "../printed-document.service";
import {
  resolveDocStyle, docPageCss, docTableCss, scaleDocCss, docLogoHtml,
  docBlankGridCss, docBlankGridHtml,
  DOC_LOGO_CSS, DOC_STAMPS_CSS, docCopyBadge, docBlocksHtml, docPrintNoteHtml, docStampsBar,
} from "./doc-style";
import { buildDocTable } from "./doc-table";
import { DOC_DENSITY, docChromeCss, resolveDocPageSize, scaleW } from "./doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "./doc-fields";
import { fmtDate } from "./fmt-date";

export interface WarehouseDocLine {
  barcode: string | null;
  itemName: string;
  colorName: string | null;
  width: number | null;
  qty: number;
}

export interface WarehouseTransferDoc {
  header: {
    documentNo: string;
    date: string | null;
    fromWarehouseName: string;
    fromWarehouseCode: string | null;
    toWarehouseName: string;
    toWarehouseCode: string | null;
    createdBy: string | null;
  };
  lines: WarehouseDocLine[];
  notes: string | null;
}

export interface GoodsReceiptDoc {
  header: {
    documentNo: string;
    date: string | null;
    warehouseName: string;
    warehouseCode: string | null;
    supplierName: string | null;
    supplierCode: string | null;
    deliveryNoteNo: string | null;
    createdBy: string | null;
  };
  lines: WarehouseDocLine[];
  /**
   * İPLİK satırları (SINIF 5, 2026-08-14) — YALNIZ iplik içeren fişin
   * snapshot'ında bulunur. OPSİYONEL olması sözleşmedir (sackNote/batchNumber
   * emsali): alan yoksa TEK BAYT basılmaz, yani 2026-08-14 öncesi snapshot'lar
   * ve kumaş-only fişler bayt-bayt aynı çıkar. Bu alan gelmeden karma fişin
   * resmî kâğıdında 500 kg iplik HİÇ görünmüyordu (denetim #17 — depocu ile
   * tedarikçinin mutabakat belgesi eksik basılıyordu).
   */
  yarnLines?: Array<{ itemName: string; qtyKg: number }>;
  notes: string | null;
}

interface RenderMeta {
  status?: PrintedDocStatus; voidReason?: string | null; draft?: boolean;
  logoDataUrl?: string | null; qrDataUrl?: string | null;
  printedAtText?: string; printedBy?: string | null; printNote?: string | null;
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmtQty(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  const [int, frac] = Math.abs(n).toFixed(2).split(".");
  return (n < 0 ? "-" : "") + int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (frac ? `,${frac}` : "");
}
function sectionOn(sections: Record<string, boolean> | undefined, key: string): boolean {
  return sections?.[key] !== false;
}

/** İki belgenin ORTAK gövdesi — fark yalnız başlık satırları ve etiketlerde. */
function renderWarehouseDoc(
  snapshot: PrintedDocSnapshot,
  meta: RenderMeta,
  opts: {
    defaultTitle: string;
    configKey: string;
    /** Sağ üst blok satırları (belge no/tarih dışında). */
    headerLines: string[];
    /** Sol blok: taraf bilgisi (depo / tedarikçi). */
    partyLines: string[];
    caption: string;
    signatureLabels: string[];
    notes: string | null;
    lines: WarehouseDocLine[];
    /** Hazır-render EK tablo (iplik gibi) — boş string'de HİÇ basılmaz. */
    extraTableHtml?: string;
    /**
     * ANA tabloyu tamamen devralır (sayım listesi gibi kolon kümesi farklı olan
     * belgeler). Verilirse `lines`/`caption` kullanılmaz.
     *
     * ⚠️ `undefined` ile `""` FARKLIDIR: `undefined` = "varsayılan top tablosunu
     * kur" (transfer/mal kabul yolu BAYT-BAYT korunur), `""` = "ana tablo hiç
     * basılmasın". Boş `lines` ile devralmak, "TOPLAM (0 top)" yazan boş bir
     * tablo bastırırdı.
     */
    mainTableHtml?: string;
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

  const totalQty = opts.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const table = opts.mainTableHtml !== undefined
    ? opts.mainTableHtml
    : sectionOn(cfg.sections, "rollTable")
    ? buildDocTable<WarehouseDocLine>({
        className: "sec",
        caption: opts.caption,
        colCfg: cfg.columns?.rollTable,
        rows: opts.lines,
        footLabel: `TOPLAM (${opts.lines.length} top)`,
        cols: [
          { key: "barcode", label: "BARKOD", align: "l", cellClass: "mono", cell: (r) => esc(r.barcode ?? "—") },
          { key: "itemColor", label: "ÜRÜN / RENK", align: "l", cell: (r) => `${esc(r.itemName)}${r.colorName ? ` · ${esc(r.colorName)}` : ""}` },
          { key: "width", label: "EN", align: "c", width: "60px", cell: (r) => (r.width != null ? `${esc(Math.round(r.width))} cm` : "—") },
          {
            key: "qty", label: "METRE", align: "r", width: "90px",
            cell: (r) => esc(fmtQty(r.qty)),
            foot: esc(fmtQty(totalQty)),
          },
        ],
      })
    : "";

  const partyBox = opts.partyLines.length
    ? `<div class="box">${opts.partyLines.join("")}</div>`
    : "";
  const notesBox = opts.notes ? `<div class="box"><div class="row"><span>Not:</span><b>${esc(opts.notes)}</b></div></div>` : "";

  const signatures = showSignatures
    ? `<div class="sign">${sigLabels.map((l) => `<div class="sign-box"><div class="sign-line"></div><div class="sign-lbl">${esc(l)}</div></div>`).join("")}</div>`
    : "";
  const noteBlock = cfg.footerNote ? `<div class="note">${esc(cfg.footerNote)}</div>` : "";

  const css = scaleDocCss(
    `
  * { box-sizing: border-box; }
  ${docPageCss(style)}
  ${docChromeCss(d, { boxLabelA4: 104 })}
  /* Depo belgelerine ÖZEL — ortak chrome'dan SONRA basılır ki kazansın.
     .box tek başına duran bir kutudur (taraf bilgisi), flex çocuğu DEĞİL.
     (Şablonun içinde BACKTICK kullanma — literal'i ortadan böler.) */
  .sec { margin-top: ${scaleW(d, 6)}px; }
  .sec th.caption { background: #e2e8f0; text-align: center; font-size: ${d.secCaption}px; font-weight: 800; letter-spacing: 1px; padding: ${scaleW(d, 5)}px; }
  .sec thead th:not(.caption) { background: #f1f5f9; font-weight: 700; font-size: ${d.secHead}px; text-transform: none; }
  .box { flex: none; margin-top: ${scaleW(d, 8)}px; }
  .box .row { margin-top: 2px; }
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
    ${table}${opts.extraTableHtml ?? ""}
    ${notesBox}
    ${noteBlock}
    ${blocksBottom}
    ${printNote}
    ${signatures}
    ${stampsBar}
  </div>
</body></html>`;
}

export function renderWarehouseTransferHtml(snapshot: PrintedDocSnapshot, meta: RenderMeta = {}): string {
  const doc = snapshot.doc as unknown as WarehouseTransferDoc;
  const h = doc.header;
  const cfg = snapshot.docConfigOverride ?? {};
  return renderWarehouseDoc(snapshot, meta, {
    defaultTitle: "DEPO TRANSFER İRSALİYESİ",
    configKey: "depoTransfer",
    headerLines: [],
    partyLines: [
      `<div class="row"><span>Çıkan Depo:</span><b>${esc(h.fromWarehouseName)}${h.fromWarehouseCode ? ` (${esc(h.fromWarehouseCode)})` : ""}</b></div>`,
      `<div class="row"><span>Giren Depo:</span><b>${esc(h.toWarehouseName)}${h.toWarehouseCode ? ` (${esc(h.toWarehouseCode)})` : ""}</b></div>`,
      sectionOn(cfg.sections, "createdBy") && h.createdBy
        ? `<div class="row"><span>Düzenleyen:</span><b>${esc(h.createdBy)}</b></div>`
        : "",
    ].filter(Boolean),
    caption: "TAŞINAN TOPLAR",
    signatureLabels: ["Teslim Eden", "Teslim Alan"],
    notes: doc.notes,
    lines: doc.lines ?? [],
    documentNo: h.documentNo,
    date: h.date,
  });
}

export function renderGoodsReceiptHtml(snapshot: PrintedDocSnapshot, meta: RenderMeta = {}): string {
  const doc = snapshot.doc as unknown as GoodsReceiptDoc;
  const h = doc.header;
  const cfg = snapshot.docConfigOverride ?? {};

  // ⚠️ İPLİK TABLOSU KOŞULLU (SINIF 5): `yarnLines` YALNIZ doluysa basılır —
  // alan taşımayan eski snapshot'lar ve kumaş-only fişler BAYT-BAYT aynı çıkar
  // (interface'teki sözleşme). Boş dizi de basmaz: "KABUL EDİLEN İPLİK" başlıklı
  // boş bir tablo, kâğıdı okuyana "iplik bekleniyor muydu?" sorusu sordurur.
  const yarnRows = doc.yarnLines ?? [];
  const totalKg = yarnRows.reduce((s, y) => s + (Number(y.qtyKg) || 0), 0);
  const yarnTable =
    yarnRows.length > 0
      ? buildDocTable<{ itemName: string; qtyKg: number }>({
          className: "sec",
          caption: "KABUL EDİLEN İPLİK (kg)",
          rows: yarnRows,
          footLabel: `TOPLAM (${yarnRows.length} kalem)`,
          cols: [
            { key: "itemName", label: "İPLİK", align: "l", cell: (r) => esc(r.itemName) },
            {
              key: "qtyKg",
              label: "KG",
              align: "r",
              width: "90px",
              cell: (r) => esc(fmtQty(r.qtyKg)),
              foot: esc(fmtQty(totalKg)),
            },
          ],
        })
      : "";

  return renderWarehouseDoc(snapshot, meta, {
    defaultTitle: "MAL KABUL FİŞİ",
    configKey: "malKabul",
    headerLines: [
      sectionOn(cfg.sections, "deliveryNote") && h.deliveryNoteNo
        ? `<div class="ln">Tedarikçi İrsaliyesi: <b>${esc(h.deliveryNoteNo)}</b></div>`
        : "",
    ].filter(Boolean),
    partyLines: [
      h.supplierName
        ? `<div class="row"><span>Tedarikçi:</span><b>${esc(h.supplierName)}${h.supplierCode ? ` (${esc(h.supplierCode)})` : ""}</b></div>`
        : "",
      `<div class="row"><span>Giren Depo:</span><b>${esc(h.warehouseName)}${h.warehouseCode ? ` (${esc(h.warehouseCode)})` : ""}</b></div>`,
      sectionOn(cfg.sections, "createdBy") && h.createdBy
        ? `<div class="row"><span>Teslim Alan:</span><b>${esc(h.createdBy)}</b></div>`
        : "",
    ].filter(Boolean),
    caption: "KABUL EDİLEN TOPLAR",
    signatureLabels: ["Teslim Eden (Tedarikçi)", "Teslim Alan"],
    notes: doc.notes,
    lines: doc.lines ?? [],
    extraTableHtml: yarnTable,
    documentNo: h.documentNo,
    date: h.date,
  });
}

// =============================================================================
// TAM STOK SAYIMI — sayım listesi + fark fişi (2026-08-15, J2 #19)
// =============================================================================
// AYNI iskelete oturur (antet + depo kutusu + tablo + imza) ama ANA TABLOSU
// farklıdır: burada satır bir "taşınan top" değil, BİR KARŞILAŞMADIR
// (beklenen ↔ sayılan ↔ durum). Bu yüzden `mainTableHtml` ile devralınır;
// transfer/mal kabul yolu tek bayt değişmez.
//
// ⚠️ SAYIM LİSTESİ ile FARK FİŞİ AYRI BELGE DEĞİLDİR: aynı kâğıt hem sayılanı
// hem uygulanan farkı gösterir. Ayırmak, imzalanan liste ile uygulanan
// düzeltmenin ayrışabilmesi demekti — mutabakatın anlamı tam olarak ikisinin
// aynı kâğıtta olmasıdır.

/** ROLL satırının belgedeki hâli. */
export interface StockCountDocRollLine {
  barcode: string | null;
  itemName: string;
  colorName: string | null;
  width: number | null;
  expectedQty: number;
  /** Sayan kişinin yazdığı metraj — BİLGİ NOTU (fark fişi metraja dokunmaz). */
  countedQty: number | null;
  /**
   * Fark fişinin GERÇEKTEN kayıttan düştüğü metraj (yalnız uygulanmış `MISSING`
   * satırda dolu). `expectedQty` fotoğraftır; ikisi ayrışabilir (gerekçe
   * `stock-count.service` içindeki hesapta) ve ayrıştığında kâğıt UYGULANANI
   * söyler — sapma defteriyle aynı rakam.
   */
  appliedQty?: number | null;
  state: "FOUND" | "MISSING" | "UNCOUNTED" | "OUT_OF_SCOPE";
  /** `OUT_OF_SCOPE`ta somut sebep; diğerlerinde null. */
  outOfScopeReason: string | null;
  notes: string | null;
}

/** YARN satırının belgedeki hâli. */
export interface StockCountDocYarnLine {
  itemName: string;
  expectedKg: number;
  countedKg: number | null;
  diffKg: number | null;
  state: "APPLIED" | "MATCH" | "UNCOUNTED" | "OUT_OF_SCOPE";
  outOfScopeReason: string | null;
}

export interface StockCountDoc {
  header: {
    documentNo: string;
    date: string | null;
    warehouseName: string;
    warehouseCode: string | null;
    createdBy: string | null;
    completedBy: string | null;
    status: string;
    /**
     * Fark fişi UYGULANDI mı (sayım `COMPLETED` mi). "Kayıttan düşüldü" diyen
     * HER ifadenin ön koşulu — taslak/iptal önizlemesinde satır yalnız
     * "işaretlendi" der. Alan YOKSA (2026-08-15 öncesi donmuş snapshot) `true`
     * kabul edilir: o tarihte belge yalnız tamamlamada donuyordu.
     */
    finalized?: boolean;
  };
  rollLines: StockCountDocRollLine[];
  yarnLines: StockCountDocYarnLine[];
  /** Fark ÖZETİ — kâğıda bakan kişinin ilk okuduğu blok. */
  summary: {
    rollTotal: number;
    rollFound: number;
    rollMissing: number;
    rollUncounted: number;
    rollOutOfScope: number;
    expectedMeters: number;
    missingMeters: number;
    yarnTotal: number;
    yarnApplied: number;
    yarnUncounted: number;
    yarnOutOfScope: number;
    yarnDiffKg: number;
  };
  notes: string | null;
}

/**
 * ⚠️ DURUM ETİKETİ ZAMAN KİPİ TAŞIR. Tamamlanmış sayımda fark UYGULANMIŞTIR
 * ("kayıttan düşüldü"); taslak/iptal önizlemesinde top HÂLÂ ENVANTERDEDİR ve
 * aynı cümle YALAN olur. Panel bunu ekranda `rollStateLabel(state, status)` ile
 * çözüyordu; kâğıt tarafı çözmüyordu — iptal edilmiş bir sayımın önizlemesi
 * canlı topları "kayıttan düşüldü" diye basıyordu.
 */
const rollStateLabel = (state: StockCountDocRollLine["state"], finalized: boolean): string => {
  switch (state) {
    case "FOUND":
      return "BULUNDU";
    case "MISSING":
      return finalized ? "EKSİK — KAYITTAN DÜŞÜLDÜ" : "EKSİK (işaretlendi)";
    case "UNCOUNTED":
      return "SAYILMADI";
    case "OUT_OF_SCOPE":
      return "KAPSAM DIŞI";
  }
};

const yarnStateLabel = (state: StockCountDocYarnLine["state"], finalized: boolean): string => {
  switch (state) {
    case "APPLIED":
      return finalized ? "FARK UYGULANDI" : "FARK VAR (uygulanmadı)";
    case "MATCH":
      return "TUTTU";
    case "UNCOUNTED":
      return "SAYILMADI";
    case "OUT_OF_SCOPE":
      return "KAPSAM DIŞI";
  }
};

export function renderStockCountHtml(snapshot: PrintedDocSnapshot, meta: RenderMeta = {}): string {
  const doc = snapshot.doc as unknown as StockCountDoc;
  const h = doc.header;
  const cfg = snapshot.docConfigOverride ?? {};
  const rollLines = doc.rollLines ?? [];
  const yarnLines = doc.yarnLines ?? [];
  const s = doc.summary;
  // Alan taşımayan eski snapshot = tamamlamada donmuş belge (o tarihte başka
  // yolu yoktu) → `true`. Yeni builder her zaman açıkça yazar.
  const finalized = h.finalized !== false;

  // ── ANA TABLO: toplar ──────────────────────────────────────────────────
  const expectedTotal = rollLines.reduce((a, l) => a + (Number(l.expectedQty) || 0), 0);
  const rollTable =
    sectionOn(cfg.sections, "rollTable") && rollLines.length > 0
      ? buildDocTable<StockCountDocRollLine>({
          className: "sec",
          caption: "SAYIM LİSTESİ — TOPLAR",
          colCfg: cfg.columns?.rollTable,
          rows: rollLines,
          footLabel: `TOPLAM (${rollLines.length} top)`,
          cols: [
            { key: "barcode", label: "BARKOD", align: "l", cellClass: "mono", cell: (r) => esc(r.barcode ?? "—") },
            {
              key: "itemColor", label: "ÜRÜN / RENK", align: "l",
              cell: (r) => `${esc(r.itemName)}${r.colorName ? ` · ${esc(r.colorName)}` : ""}`,
            },
            { key: "expectedQty", label: "BEKLENEN", align: "r", width: "80px", cell: (r) => esc(fmtQty(r.expectedQty)), foot: esc(fmtQty(expectedTotal)) },
            { key: "countedQty", label: "SAYILAN", align: "r", width: "80px", cell: (r) => (r.countedQty == null ? "—" : esc(fmtQty(r.countedQty))) },
            {
              key: "state", label: "DURUM", align: "l", width: "150px",
              // Kapsam dışı satırda SEBEP de basılır: "işlenmedi" demek yetmez,
              // kâğıda bakan kişi nedenini burada görmeli (yoksa sistemin
              // sessizce atladığını sanır).
              // ⚠️ Düşülen metraj yalnız FOTOĞRAFTAN FARKLIYSA basılır: aynı
              // olduğu (yani hemen her) durumda çıktı bayt-bayt korunur, farklı
              // olduğunda ise kâğıt sapma defteriyle aynı rakamı söyler.
              cell: (r) =>
                `${esc(rollStateLabel(r.state, finalized))}${r.outOfScopeReason ? ` (${esc(r.outOfScopeReason)})` : ""}` +
                (r.appliedQty != null && r.appliedQty !== r.expectedQty
                  ? ` · düşülen ${esc(fmtQty(r.appliedQty))}`
                  : "") +
                (r.notes ? ` · ${esc(r.notes)}` : ""),
            },
          ],
        })
      : "";

  // ── EK TABLO: iplik ────────────────────────────────────────────────────
  const yarnTable =
    sectionOn(cfg.sections, "yarnTable") && yarnLines.length > 0
      ? buildDocTable<StockCountDocYarnLine>({
          className: "sec",
          caption: "SAYIM LİSTESİ — İPLİK (kg)",
          rows: yarnLines,
          footLabel: `TOPLAM (${yarnLines.length} kalem)`,
          cols: [
            { key: "itemName", label: "İPLİK", align: "l", cell: (r) => esc(r.itemName) },
            { key: "expectedKg", label: "BEKLENEN", align: "r", width: "80px", cell: (r) => esc(fmtQty(r.expectedKg)) },
            { key: "countedKg", label: "SAYILAN", align: "r", width: "80px", cell: (r) => (r.countedKg == null ? "—" : esc(fmtQty(r.countedKg))) },
            {
              key: "diffKg", label: "FARK", align: "r", width: "80px",
              cell: (r) => (r.diffKg == null ? "—" : esc(fmtQty(r.diffKg))),
              foot: esc(fmtQty(s?.yarnDiffKg ?? 0)),
            },
            {
              key: "state", label: "DURUM", align: "l", width: "150px",
              cell: (r) =>
                `${esc(yarnStateLabel(r.state, finalized))}${r.outOfScopeReason ? ` (${esc(r.outOfScopeReason)})` : ""}`,
            },
          ],
        })
      : "";

  // ── FARK ÖZETİ ─────────────────────────────────────────────────────────
  // ⚠️ Sayaçlar SNAPSHOT'TAN basılır, satırlardan YENİDEN SAYILMAZ: donmuş
  // belge ile onu doğuran işlemin aynı rakamı söylemesi gerekir. İkinci bir
  // hesap yolu, ikinci bir rakam demektir.
  const sumRows: Array<[string, string]> = s
    ? [
        ["Sayılan top (bulundu)", `${s.rollFound} / ${s.rollTotal}`],
        [
          finalized ? "Eksik (kayıttan düşülen)" : "Eksik (işaretlenen)",
          `${s.rollMissing} top · ${fmtQty(s.missingMeters)} m`,
        ],
        ["Sayılmayan satır", `${s.rollUncounted} top`],
        ["Kapsam dışı", `${s.rollOutOfScope} top · ${s.yarnOutOfScope} iplik kalemi`],
        ["Beklenen toplam metraj", `${fmtQty(s.expectedMeters)} m`],
        ["İplik farkı (net)", `${fmtQty(s.yarnDiffKg)} kg · ${s.yarnApplied} / ${s.yarnTotal} kalem uygulandı`],
      ]
    : [];
  const summaryBox =
    sectionOn(cfg.sections, "countSummary") && sumRows.length > 0
      // ⚠️ Yalnız MEVCUT sınıflar (`box`/`row`) kullanılır — ortak CSS bloğuna
      // yeni kural eklemek transfer/mal kabul çıktısını da bayt düzeyinde
      // değiştirirdi (bu ailenin CSS'i TEK ve paylaşımlıdır).
      ? `<div class="box"><div class="row"><span>FARK ÖZETİ</span><b>${esc(h.documentNo)}</b></div>${sumRows
          .map(([k, v]) => `<div class="row"><span>${esc(k)}:</span><b>${esc(v)}</b></div>`)
          .join("")}</div>`
      : "";

  return renderWarehouseDoc(snapshot, meta, {
    defaultTitle: "STOK SAYIM TUTANAĞI",
    configKey: "stokSayimi",
    headerLines: [
      sectionOn(cfg.sections, "countStatus")
        ? `<div class="ln">Durum: <b>${esc(h.status)}</b></div>`
        : "",
    ].filter(Boolean),
    partyLines: [
      `<div class="row"><span>Sayılan Depo:</span><b>${esc(h.warehouseName)}${h.warehouseCode ? ` (${esc(h.warehouseCode)})` : ""}</b></div>`,
      sectionOn(cfg.sections, "createdBy") && h.createdBy
        ? `<div class="row"><span>Sayımı Açan:</span><b>${esc(h.createdBy)}</b></div>`
        : "",
      sectionOn(cfg.sections, "createdBy") && h.completedBy
        ? `<div class="row"><span>Tamamlayan:</span><b>${esc(h.completedBy)}</b></div>`
        : "",
    ].filter(Boolean),
    caption: "SAYIM LİSTESİ",
    signatureLabels: ["Sayan", "Kontrol Eden", "Onaylayan"],
    notes: doc.notes,
    lines: [],
    mainTableHtml: rollTable,
    extraTableHtml: yarnTable + summaryBox,
    documentNo: h.documentNo,
    date: h.date,
  });
}
