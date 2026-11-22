// =============================================================================
// Gövde Mutabakatı — "SİZDEKİ LEVENT GÖVDELERİMİZ" HTML + Excel (TEK KAYNAK, devere S6)
// =============================================================================
// Devereciye gider: deverecideki gövdeler (sahibiyle, bu durumda kaç gün) + dönem hareketleri.
// İç kolon (gövde notu) OPT-IN: `sections.internalNotes === true` değilse basılmaz. Kolonlar bir kez
// `DocColSpec`: HTML `toHtmlCols → buildDocTable`, Excel `resolveDocTable` (PDF = Excel).
// =============================================================================

import type { PrintedDocSnapshot } from "../printed-document.service";
import { docBlankGridHtml, docBlocksHtml, docCopyBadge, docLogoHtml, docPrintNoteHtml, docStampsBar, docTitle, resolveDocStyle } from "./doc-style";
import { buildDocTable } from "./doc-table";
import { resolveDocTable, toHtmlCols, type DocColSpec, type DocTablesPayload } from "./doc-model";
import { DOC_DENSITY, resolveDocPageSize } from "./doc-density";
import { fmtDate } from "./fmt-date";
import { commercialCss, esc, kitOf, letterheadHtml, sectionOn, signaturesHtml, watermarkHtml, watermarkText, type CommercialRenderMeta } from "./commercial-doc";

export interface BeamBodyStatementBody {
  seq: number;
  bodyNo: string;
  /** Durum metni ("Boş" · "Dolu — LV-12"). */
  stateText: string;
  /** Sahip adı; bizim gövdede "Bizim". */
  ownerText: string;
  /** Şimdiki duruma girdiği an (son etkin olay; olay yoksa kart doğuşu). */
  sinceAt: string;
  ageDays: number;
  /** İç not — yalnız `sections.internalNotes` açıkken basılır. */
  notes: string | null;
}

export interface BeamBodyStatementMove {
  seq: number;
  at: string;
  bodyNo: string;
  /** SENT = devereciye gitti · RETURNED = deverecinden döndü. */
  direction: "SENT" | "RETURNED";
  kindLabel: string;
  documentNo: string | null;
}

/** Donmuş mutabakat payload'ı — fiyat/ücret yok; iç alan yalnız `notes`. */
export interface BeamBodyStatementDoc {
  header: {
    documentNo: string;
    subcontractorName: string;
    subcontractorCode: string;
    /** Mutabakat anı (ISO). */
    asOf: string;
    /** Hareket döneminin ilk günü (fabrika günü başlangıcı, ISO). */
    periodFrom: string;
    periodDays: number;
  };
  bodies: BeamBodyStatementBody[];
  moves: BeamBodyStatementMove[];
  totals: { bodies: number; ours: number; others: number; full: number; sent: number; returned: number };
}

export const BEAM_BODY_STATEMENT_TITLE = "GÖVDE MUTABAKATI";
export const BEAM_BODY_STATEMENT_SIGNATURES = ["Gönderen", "Devereci Onayı"];
export const BEAM_BODY_STATEMENT_DIRECTION_LABELS: Record<BeamBodyStatementMove["direction"], string> = {
  SENT: "Size gönderildi",
  RETURNED: "Bize döndü",
};

const TEXT = { t: "text" } as const;

/** Gövde kolonları — PDF ve Excel bu TEK listeden; not kolonu iç alandır (opt-in). */
export function beamBodyStatementBodyColumns(): DocColSpec<BeamBodyStatementBody>[] {
  return [
    { key: "seq", label: "#", align: "c", width: "30px", kind: TEXT, value: (r) => String(r.seq) },
    { key: "bodyNo", label: "GÖVDE NO", align: "l", width: "110px", kind: TEXT, value: (r) => r.bodyNo },
    { key: "state", label: "DURUM", align: "l", kind: TEXT, value: (r) => r.stateText },
    { key: "owner", label: "SAHİBİ", align: "l", kind: TEXT, value: (r) => r.ownerText },
    { key: "since", label: "SİZDE (TARİH)", align: "c", width: "84px", kind: TEXT, value: (r) => fmtDate(r.sinceAt) },
    { key: "age", label: "GÜN", align: "r", width: "44px", kind: { t: "int" }, value: (r) => r.ageDays },
    { key: "notes", label: "NOT", align: "l", kind: TEXT, value: (r) => r.notes ?? "" },
  ];
}

export function beamBodyStatementMoveColumns(): DocColSpec<BeamBodyStatementMove>[] {
  return [
    { key: "seq", label: "#", align: "c", width: "30px", kind: TEXT, value: (r) => String(r.seq) },
    { key: "date", label: "TARİH", align: "c", width: "84px", kind: TEXT, value: (r) => fmtDate(r.at) },
    { key: "bodyNo", label: "GÖVDE NO", align: "l", width: "110px", kind: TEXT, value: (r) => r.bodyNo },
    { key: "direction", label: "YÖN", align: "l", width: "110px", kind: TEXT, value: (r) => BEAM_BODY_STATEMENT_DIRECTION_LABELS[r.direction] },
    { key: "kind", label: "HAREKET", align: "l", kind: TEXT, value: (r) => r.kindLabel },
    { key: "document", label: "BELGE", align: "l", kind: TEXT, value: (r) => r.documentNo ?? "—" },
  ];
}

/** Özet satırları ([etiket, değer]) — HTML kutusu ve Excel başlığı aynı listeden. */
export function beamBodyStatementSummary(doc: BeamBodyStatementDoc): Array<[string, string]> {
  const t = doc.totals;
  return [
    ["Sizdeki gövde", String(t.bodies)],
    ["Bizim", String(t.ours)],
    ["Başka firmanın", String(t.others)],
    ["Dolu", String(t.full)],
    [`Son ${doc.header.periodDays} gün gönderilen`, String(t.sent)],
    [`Son ${doc.header.periodDays} gün dönen`, String(t.returned)],
  ];
}

function parts(snapshot: PrintedDocSnapshot) {
  const doc = snapshot.doc as unknown as BeamBodyStatementDoc;
  const cfg = snapshot.docConfigOverride ?? {};
  const on = (k: string) => sectionOn(cfg.sections, k);
  // İç kolon OPT-IN: anahtar yokken KAPALI (müşteri belgesi sözleşmesi).
  const internal = cfg.sections?.internalNotes === true;
  const bodyColCfg = internal ? cfg.columns?.govdeler : { ...(cfg.columns?.govdeler ?? {}), hidden: [...(cfg.columns?.govdeler?.hidden ?? []), "notes"] };
  return {
    doc, cfg, on, kit: kitOf(snapshot), bodyColCfg,
    bodyTable: on("bodyTable"), moveTable: on("moveTable") && doc.moves.length > 0,
    bodyCols: beamBodyStatementBodyColumns(), moveCols: beamBodyStatementMoveColumns(),
  };
}

const periodText = (doc: BeamBodyStatementDoc): string => `${fmtDate(doc.header.periodFrom)} – ${fmtDate(doc.header.asOf)}`;

/** Excel tabloları — HTML ile AYNI kolon çözücüsü ve ayar (PDF = Excel). */
export function renderBeamBodyStatementTables(snapshot: PrintedDocSnapshot, meta: CommercialRenderMeta = {}): DocTablesPayload {
  const p = parts(snapshot);
  const h = p.doc.header;
  const wm = watermarkText(meta);
  const header: Array<[string, string | null]> = [
    ...(wm ? [[wm, null] as [string, null]] : []),
    [docTitle(p.cfg.titleOverride, BEAM_BODY_STATEMENT_TITLE), null],
    ...(snapshot.company?.name ? [[snapshot.company.name, null] as [string, null]] : []),
    ["Sayın", h.subcontractorName],
    ["Tarih", fmtDate(h.asOf)],
    ["Hareket dönemi", periodText(p.doc)],
    ...(p.on("summary") ? beamBodyStatementSummary(p.doc) : []),
  ];
  const tables = [
    ...(p.bodyTable ? [resolveDocTable({ key: "govdeler", caption: "Sizdeki gövdelerimiz", cols: p.bodyCols, rows: p.doc.bodies, colCfg: p.bodyColCfg, kit: p.kit })] : []),
    ...(p.moveTable ? [resolveDocTable({ key: "hareketler", caption: "Dönem hareketleri", cols: p.moveCols, rows: p.doc.moves, colCfg: p.cfg.columns?.hareketler, kit: p.kit })] : []),
  ];
  const notes = [p.cfg.footerNote, meta.printNote].filter((n): n is string => !!n && !!n.trim());
  return { docType: "BEAM_BODY_STATEMENT", documentNo: h.documentNo, header, tables, notes };
}

export function renderBeamBodyStatementHtml(snapshot: PrintedDocSnapshot, meta: CommercialRenderMeta = {}): string {
  const p = parts(snapshot);
  const { doc, cfg, on } = p;
  const h = doc.header;
  const d = DOC_DENSITY[resolveDocPageSize(cfg.style?.pageSize)];
  const style = resolveDocStyle(cfg.style, { marginMm: 9 });
  const logo = docLogoHtml(meta.logoDataUrl, cfg);
  const summary = on("summary")
    ? `<div class="sum">${beamBodyStatementSummary(doc).map(([k, v]) => `<div class="sum-i"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>`
    : "";
  const bodies = p.bodyTable
    ? `<div class="tbl-cap">Sizdeki gövdelerimiz (${esc(doc.bodies.length)})</div>` +
      (doc.bodies.length > 0
        ? buildDocTable<BeamBodyStatementBody>({ className: "sec", colCfg: p.bodyColCfg, rows: doc.bodies, cols: toHtmlCols(p.bodyCols, p.kit) })
        : `<div class="qn">Kayıtlarımıza göre sizde gövdemiz yok.</div>`)
    : "";
  const moves = p.moveTable
    ? `<div class="tbl-cap">Dönem hareketleri (${esc(periodText(doc))})</div>` +
      buildDocTable<BeamBodyStatementMove>({ className: "sec", colCfg: cfg.columns?.hareketler, rows: doc.moves, cols: toHtmlCols(p.moveCols, p.kit) })
    : "";
  const footer = cfg.footerNote ? `<div class="decl">${esc(cfg.footerNote)}</div>` : "";

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>${commercialCss(cfg, style, d, "govdeMutabakat")}</style></head>
<body>
  ${watermarkHtml(meta)}
  <div class="sheet">
    <header>
      <div class="hl">
        ${logo.left}
        <div class="company">${esc(snapshot.company?.name ?? "")}</div>
        ${letterheadHtml(snapshot, cfg)}
        <div class="sayin">SAYIN: <b>${esc(h.subcontractorName)}</b></div>
        ${on("subcontractorCode") ? `<div class="sub">Kod: ${esc(h.subcontractorCode)}</div>` : ""}
      </div>
      <div class="hr">
        ${logo.right}
        <div class="title">${esc(docTitle(cfg.titleOverride, BEAM_BODY_STATEMENT_TITLE))}</div>
        ${docCopyBadge(cfg, esc)}
        ${on("date") ? `<div class="ln">Tarih: <b>${esc(fmtDate(h.asOf))}</b></div>` : ""}
        <div class="ln">Dönem: <b>${esc(periodText(doc))}</b></div>
      </div>
    </header>
    ${docBlocksHtml(cfg, "afterHeader", esc) + docBlankGridHtml(cfg, "afterHeader", esc)}
    ${summary}
    ${bodies}
    ${moves}
    ${footer}
    ${docBlocksHtml(cfg, "beforeSignatures", esc) + docBlankGridHtml(cfg, "beforeSignatures", esc)}
    ${docPrintNoteHtml(meta.printNote, esc)}
    ${signaturesHtml(cfg, BEAM_BODY_STATEMENT_SIGNATURES)}
    ${docStampsBar(cfg, meta, esc, { printedAt: "Basım", printedBy: "Basan" })}
  </div>
</body></html>`;
}
