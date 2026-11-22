// =============================================================================
// Levent Kartı — A6 bilet (plastik kılıf, flanş askısı) HTML + Excel (TEK KAYNAK, devere S5)
// =============================================================================
// İÇ belge: ücret/fiyat payload'a hiç girmez (`warp-beam-card.service` select'i sınırdır). Kâğıt
// A6 sabittir (`@page size: A6`; belge ayarının A4/A5 seçimi bu türde yoktur). Bilgi satırları,
// iplik kolonları ve el yazısı satırları burada bir kez tanımlıdır; tasarımcı sözleşmesi aynı
// yardımcıları okur (şablon hesap yapmaz). Kalıcı kimlik boyalı gövde no'dur, kart bilgi taşır.
// =============================================================================

import type { PrintedDocSnapshot } from "../printed-document.service";
import { renderQrSvg } from "../helpers/barcode-svg.helper";
import { docTitle, resolveDocStyle, scaleDocCss, type ResolvedDocStyle } from "./doc-style";
import { buildDocTable } from "./doc-table";
import { resolveDocTable, toHtmlCols, type DocColSpec, type DocTablesPayload } from "./doc-model";
import { fmtDate } from "./fmt-date";
import { docNum } from "./fmt-num";
import { esc, kitOf, sectionOn, watermarkHtml, watermarkText, type CommercialRenderMeta } from "./commercial-doc";

export interface WarpBeamCardYarn {
  seq: number;
  yarnCode: string;
  yarnName: string;
  endsCount: number;
  denier: number;
  kg: number;
  /** Bu iplikten levente giden lot no'ları ("L1, L2"); lotsuzsa null. */
  lots: string | null;
}

/** Donmuş kart payload'ı — sarım (WOUND) gerçekleri + kabul bağlamı; ücret YOK. */
export interface WarpBeamCardDoc {
  header: {
    documentNo: string;
    beamNo: string;
    /** Gövde no — kayıtlı gövde (`BeamBody.bodyNo`), yoksa elle yazılan `physicalBeamNo`. */
    bodyNo: string | null;
    warpSpecCode: string;
    warpSpecName: string;
    itemName: string | null;
    weavingOrderNumber: string | null;
    woundAt: string | null;
    lengthM: number | null;
    endsCount: number | null;
    theoreticalKg: number | null;
    weighedNetKg: number | null;
    ownerName: string | null;
    subcontractorName: string | null;
    deliveryNoteNo: string | null;
    receiveDocNo: string | null;
    warpingOrderNo: string | null;
  };
  /** Doğuş kırılımı (WOUND kopyası) — kart sonradan değişse de leventin ipliği değişmez. */
  yarns: WarpBeamCardYarn[];
  totals: { endsCount: number; kg: number };
}

export const WARP_BEAM_CARD_TITLE = "LEVENT KARTI";
/** A6 kenar boşluğu varsayılanı (mm) — kılıfa girecek küçük bilet. */
export const WARP_BEAM_CARD_MARGIN_MM = 5;
/** Bölüm anahtarları — değer = anahtar yokken davranış (hepsi açık). */
export const WARP_BEAM_CARD_SECTIONS = { fason: true, yarnTable: true, lots: true, handwriting: true } as const;

const TEXT = { t: "text" } as const;

export type WarpBeamCardFoot = WarpBeamCardDoc["totals"];

/** İplik kolonları — PDF ve Excel bu TEK listeden; lot kolonu `sections.lots` kapalıysa gizli. */
export function warpBeamCardYarnColumns(t: WarpBeamCardFoot): DocColSpec<WarpBeamCardYarn>[] {
  return [
    { key: "seq", label: "#", align: "c", width: "14px", kind: TEXT, value: (r) => String(r.seq) },
    { key: "yarn", label: "İPLİK", align: "l", kind: TEXT, value: (r) => r.yarnCode },
    { key: "ends", label: "TEL", align: "r", width: "34px", kind: { t: "int" }, value: (r) => r.endsCount, foot: { value: t.endsCount } },
    { key: "denier", label: "DNY", align: "r", width: "30px", kind: { t: "num", dec: 0 }, value: (r) => r.denier },
    { key: "kg", label: "KG", align: "r", width: "38px", kind: { t: "num", dec: 1 }, value: (r) => r.kg, foot: { value: t.kg } },
    { key: "lots", label: "LOT", align: "l", kind: TEXT, value: (r) => r.lots ?? "—" },
  ];
}

type Fmt = (n: number | null | undefined, d: number) => string;

/**
 * Bilgi satırları ([etiket, değer]) — HTML kutusu, Excel başlığı ve tasarımcı bağlamı AYNI listeden.
 * Boş alan satır doğurmaz; `fason` kapalıysa devereci/irsaliye/kabul/sipariş basılmaz.
 */
export function warpBeamCardInfoRows(doc: WarpBeamCardDoc, sections: Record<string, boolean> | undefined, fmt: Fmt): Array<[string, string]> {
  const h = doc.header;
  const rows: Array<[string, string | null]> = [
    ["Çözgü kartı", `${h.warpSpecCode} — ${h.warpSpecName}`],
    ["Kumaş", h.itemName],
    ["Dokuma iş emri", h.weavingOrderNumber],
    ["Metre", h.lengthM == null ? null : `${fmt(h.lengthM, 1)} m`],
    ["Tel", h.endsCount == null ? null : String(h.endsCount)],
    ["Hesap kg", h.theoreticalKg == null ? null : `${fmt(h.theoreticalKg, 1)} kg`],
    ["Tartı net kg", h.weighedNetKg == null ? null : `${fmt(h.weighedNetKg, 1)} kg`],
    ["Sarım tarihi", h.woundAt ? fmtDate(h.woundAt) : null],
    ["Sahibi", h.ownerName],
  ];
  if (sectionOn(sections, "fason")) {
    rows.push(["Devereci", h.subcontractorName], ["İrsaliye no", h.deliveryNoteNo], ["Kabul belgesi", h.receiveDocNo], ["Devere siparişi", h.warpingOrderNo]);
  }
  return rows.filter((r): r is [string, string] => r[1] != null && r[1] !== "");
}

/** Kartın CSS'i (`@page` hariç) — renderer ve Liquid eşleniği aynı fonksiyonu çağırır. */
export function warpBeamCardCss(style: ResolvedDocStyle): string {
  return scaleDocCss(
    `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 9px; }
  .wm { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 40px; font-weight: 700; color: rgba(200,0,0,0.18); transform: rotate(-24deg); }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; border-bottom: 1.5px solid #000; padding-bottom: 4px; }
  .company { font-size: 8px; font-weight: 400; }
  .title { font-size: 11px; font-weight: 700; letter-spacing: 1px; }
  .beamno { font-size: 15px; font-weight: 700; font-family: "Courier New", monospace; margin-top: 2px; }
  .qr svg { width: 26mm; height: 26mm; display: block; }
  .body-no { display: flex; align-items: baseline; gap: 6px; margin: 4px 0; padding: 3px 6px; border: 2px solid #000; }
  .body-no span { font-size: 9px; font-weight: 700; }
  .body-no b { font-size: 24px; font-weight: 700; font-family: "Courier New", monospace; }
  table.info { width: 100%; border-collapse: collapse; margin-top: 3px; }
  table.info th { text-align: left; font-weight: 400; width: 34%; padding: 1px 3px 1px 0; vertical-align: top; font-size: 8px; color: #333; }
  table.info td { font-weight: 700; padding: 1px 0; font-size: 9px; word-break: break-word; }
  .tbl-cap { font-size: 8px; font-weight: 700; margin-top: 5px; }
  table.sec { width: 100%; border-collapse: collapse; margin-top: 2px; table-layout: fixed; }
  table.sec th, table.sec td { border: 1px solid #555; padding: 1px 2px; font-size: 8px; word-break: break-word; }
  table.sec th { background: #eee; font-weight: 700; }
  table.sec .l { text-align: left; } table.sec .r { text-align: right; } table.sec .c { text-align: center; }
  table.sec tr.tot td { font-weight: 700; }
  .hand { margin-top: 6px; border-top: 1px dashed #000; padding-top: 3px; }
  .hand-row { display: flex; align-items: flex-end; gap: 4px; margin-top: 6px; font-size: 8px; font-weight: 700; }
  .hand-row i { flex: 1; border-bottom: 1px solid #000; height: 10px; }
  .decl { margin-top: 4px; font-size: 7px; font-weight: 400; }
`,
    style,
  );
}

/** `@page` — A6 sabit, kenar ayardan. */
export function warpBeamCardPageCss(style: ResolvedDocStyle): string {
  const m = style.margins;
  return `@page { size: A6; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }`;
}

export const WARP_BEAM_CARD_HAND_HTML =
  `<div class="hand"><div class="hand-row"><span>Takıldı — Tezgah:</span><i></i><span>Tarih:</span><i></i></div>` +
  `<div class="hand-row"><span>Bitti — Tarih:</span><i></i><span>Artık:</span><i></i></div></div>`;

function parts(snapshot: PrintedDocSnapshot) {
  const doc = snapshot.doc as unknown as WarpBeamCardDoc;
  const cfg = snapshot.docConfigOverride ?? {};
  const on = (k: string) => sectionOn(cfg.sections, k);
  const yarnTable = on("yarnTable") && doc.yarns.length > 0;
  // Lot kolonu bölüm anahtarıyla da kapanır — kolon ayarıyla birlikte (hidden birleşir).
  const colCfg = on("lots") ? cfg.columns?.iplikler : { ...(cfg.columns?.iplikler ?? {}), hidden: [...(cfg.columns?.iplikler?.hidden ?? []), "lots"] };
  return { doc, cfg, on, kit: kitOf(snapshot), yarnTable, colCfg, cols: warpBeamCardYarnColumns(doc.totals) };
}

/** Excel tabloları — HTML ile AYNI kolon çözücüsü ve satırlar (PDF = Excel). */
export function renderWarpBeamCardTables(snapshot: PrintedDocSnapshot, meta: CommercialRenderMeta = {}): DocTablesPayload {
  const p = parts(snapshot);
  const h = p.doc.header;
  const wm = watermarkText(meta);
  const header: Array<[string, string | null]> = [
    ...(wm ? [[wm, null] as [string, null]] : []),
    [docTitle(p.cfg.titleOverride, WARP_BEAM_CARD_TITLE), null],
    ...(snapshot.company?.name ? [[snapshot.company.name, null] as [string, null]] : []),
    ["Levent no", h.beamNo],
    ...(h.bodyNo ? [["Gövde no", h.bodyNo] as [string, string]] : []),
    ...warpBeamCardInfoRows(p.doc, p.cfg.sections, docNum(snapshot).tr),
  ];
  const tables = p.yarnTable
    ? [resolveDocTable({ key: "iplikler", caption: "İplik kırılımı", cols: p.cols, rows: p.doc.yarns, colCfg: p.colCfg, footLabel: "TOPLAM", kit: p.kit })]
    : [];
  const notes = [p.cfg.footerNote, meta.printNote].filter((n): n is string => !!n && !!n.trim());
  return { docType: "WARP_BEAM_CARD", documentNo: h.documentNo, header, tables, notes };
}

export function renderWarpBeamCardHtml(snapshot: PrintedDocSnapshot, meta: CommercialRenderMeta = {}): string {
  const p = parts(snapshot);
  const { doc, cfg } = p;
  const h = doc.header;
  const style = resolveDocStyle(cfg.style, { marginMm: WARP_BEAM_CARD_MARGIN_MM });
  const info = warpBeamCardInfoRows(doc, cfg.sections, docNum(snapshot).tr);
  const yarns = p.yarnTable
    ? `<div class="tbl-cap">İplik kırılımı</div>` +
      // Toplam etiketi ilk (dar "#") kolona oturur; A6'da "TOPLAM" harf harf kırılıyordu → "Σ".
    buildDocTable<WarpBeamCardYarn>({ className: "sec", colCfg: p.colCfg, footLabel: "Σ", rows: doc.yarns, cols: toHtmlCols(p.cols, p.kit) })
    : "";

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>${warpBeamCardPageCss(style)}${warpBeamCardCss(style)}</style></head>
<body>
  ${watermarkHtml(meta)}
  <div class="sheet">
    <header class="top">
      <div class="tl">
        <div class="company">${esc(snapshot.company?.name ?? "")}</div>
        <div class="title">${esc(docTitle(cfg.titleOverride, WARP_BEAM_CARD_TITLE))}</div>
        <div class="beamno">${esc(h.beamNo)}</div>
      </div>
      <div class="qr">${renderQrSvg(h.beamNo)}</div>
    </header>
    ${h.bodyNo ? `<div class="body-no"><span>GÖVDE</span><b>${esc(h.bodyNo)}</b></div>` : ""}
    <table class="info"><tbody>${info.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>
    ${yarns}
    ${p.on("handwriting") ? WARP_BEAM_CARD_HAND_HTML : ""}
    ${cfg.footerNote ? `<div class="decl">${esc(cfg.footerNote)}</div>` : ""}
  </div>
</body></html>`;
}
