// =============================================================================
// Fasondan Doğrudan Sevk İrsaliyesi — İÇERİK ÇÖZÜCÜSÜ (HTML + Excel ortak)
// =============================================================================
// Belgenin başlık satırları, bilgi kutuları ve iki listesi (karşılanan siparişler ·
// sevk edilen toplar) BURADA bir kez kurulur; HTML (`fason-direct-ship.html.ts`) ve
// Excel tabloları (`renderFasonDirectShipTables`) aynı karardan türer.
// =============================================================================

import type { PrintedDocStatus } from "@prisma/client";
import { pickExportCode } from "../helpers/shipment-destination.helper";
import type { PrintedDocSnapshot } from "../printed-document.service";
import type { DocumentConfig } from "../system-setting.service";
import type { DocColumnCfg } from "./doc-table";
import {
  resolveDocTable,
  type DocCellKind,
  type DocColSpec,
  type DocFmtKit,
  type DocTablesPayload,
} from "./doc-model";
import { fmtDate } from "./fmt-date";
import { docTitle } from "./doc-style";

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

export interface DirectShipRenderMeta {
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

export function esc(v: unknown): string {
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


/** Bir bölüm açık mı — yalnız açıkça false ise gizle (varsayılan: göster). */
function sectionOn(sections: Record<string, boolean> | undefined, key: string): boolean {
  return sections?.[key] !== false;
}

const TEXT: DocCellKind = { t: "text" };
/** Sıra no — gruplamasız tam sayı. */
const INT: DocCellKind = { t: "int" };
/** En — yuvarlanmış tam sayı + " cm". */
const WIDTH_CM: DocCellKind = { t: "int", suffix: " cm" };
/** Metre/kg: 1 ondalık. */
const QTY: DocCellKind = { t: "num", dec: 1 };
const QTY_M: DocCellKind = { t: "num", dec: 1, suffix: " m" };
const QTY_KG: DocCellKind = { t: "num", dec: 1, suffix: " kg" };

export const FMT_KIT: DocFmtKit = { esc, fmtTr };

interface HeaderItem {
  key: string;
  label: string;
  value: string;
}

/** Bilgi kutusu (müşteri · fason firma · doğrudan sevk · araç) — yalnız görünen satırlar. */
export interface InfoBox {
  key: string;
  title: string;
  rows: HeaderItem[];
}

export interface DirectShipSection<R> {
  key: "allocations" | "rollTable";
  caption: string;
  colCfg: DocColumnCfg | undefined;
  rows: R[];
  cols: DocColSpec<R>[];
  footLabel?: string;
}

const item = (key: string, label: string, value: string): HeaderItem => ({ key, label, value });

/** Başlığın sağ bloğu — İrsaliye No · Fason Sevk No · Tarih · Parti No. */
function headRightItems(doc: DirectShipDoc, cfg: DocumentConfig): HeaderItem[] {
  // Fason Sevk No satırı (dispatchNo) — sections.fasonDispatchNo !== false ise.
  const showFasonDispatchNo = sectionOn(cfg.sections, "fasonDispatchNo");
  // Parti no varsayılan AÇIK (2026-08-05 ürün kararı). Önce opt-in yapılmıştı —
  // gerekçe "müşteri belgesinin yerleşimi sormadan değişmesin"di; fabrika lot
  // no'nun müşterinin de sorduğu bir bilgi olduğuna karar verdi. `sectionOn`
  // blocklist'tir: yalnız açıkça `false` yazılırsa susar.
  const showBatchInfo = sectionOn(cfg.sections, "batchInfo");
  return [
    item("docNo", "İrsaliye No", doc.shipmentNo ?? doc.dispatchNo),
    showFasonDispatchNo && doc.shipmentNo ? item("fasonDispatchNo", "Fason Sevk No", doc.dispatchNo) : null,
    item("date", "Tarih", fmtDate(doc.directShippedAt ?? doc.dispatchedAt)),
    showBatchInfo && doc.batchNumber ? item("batchNo", "Parti No", doc.batchNumber) : null,
  ].filter((x): x is HeaderItem => x !== null);
}

/** MÜŞTERİ (Malın Gittiği) — doğrudan sevkin asıl alıcısı; bölüm anahtarından
 *  bağımsız DAİMA gösterilir (irsaliyenin muhatabı), satırları kendi anahtarlarıyla. */
function customerBox(doc: DirectShipDoc, cfg: DocumentConfig): InfoBox | null {
  const cust = doc.customer;
  if (!cust) return null;
  // İhracat Kodu — TEK satır: şube kodu doluysa onu, yoksa müşteri ihracat kodunu
  // bas (branchCode ?? exportCode). "exportCode" section toggle'ıyla (varsayılan açık).
  const custShipCode = pickExportCode({ branchCode: cust.branchCode, customerExportCode: cust.exportCode });
  const rows = [
    item("name", "Adı", cust.name),
    sectionOn(cfg.sections, "branchName") && cust.branchName ? item("branchName", "Şube", cust.branchName) : null,
    sectionOn(cfg.sections, "exportCode") && custShipCode ? item("exportCode", "İhracat Kodu", custShipCode) : null,
    sectionOn(cfg.sections, "taxNo") && cust.taxNumber ? item("taxNo", "V.No", cust.taxNumber) : null,
  ].filter((x): x is HeaderItem => x !== null);
  return { key: "customer", title: "MÜŞTERİ (Malın Gittiği)", rows };
}

/** Bilgi kutuları — bölüm anahtarları Belge Şablonu DOC_DEF'iyle aynı
 *  (subcontractorInfo / directShipInfo / vehicleInfo). */
function infoBoxes(doc: DirectShipDoc, cfg: DocumentConfig): InfoBox[] {
  const sub: InfoBox | null = sectionOn(cfg.sections, "subcontractorInfo")
    ? {
        key: "subcontractor",
        title: "FASON FİRMA (Malın Geldiği)",
        rows: [
          item("name", "Adı", doc.subcontractor.name),
          doc.subcontractor.code ? item("code", "Kod", doc.subcontractor.code) : null,
          item("workOrder", "İş Emri", doc.workOrder.workOrderNumber),
          item("step", "Adım", doc.step.station.name),
        ].filter((x): x is HeaderItem => x !== null),
      }
    : null;
  const ds: InfoBox | null = sectionOn(cfg.sections, "directShipInfo")
    ? {
        key: "directShip",
        title: "FASONDAN SEVK",
        rows: [item("by", "Sevk Eden", doc.directShippedBy || "—"), item("reason", "Sebep", doc.directShipReason || "—")],
      }
    : null;
  const veh: InfoBox | null = sectionOn(cfg.sections, "vehicleInfo")
    ? {
        key: "vehicle",
        title: "ARAÇ / SEVKİYAT",
        rows: [
          item("plate", "Plaka", doc.plateNumber || "—"),
          item("driver", "Şoför", doc.driverName || "—"),
          doc.notes ? item("notes", "Not", doc.notes) : null,
        ].filter((x): x is HeaderItem => x !== null),
      }
    : null;
  return [customerBox(doc, cfg), sub, ds, veh].filter((x): x is InfoBox => x !== null);
}

const itemColor = (name: string, color: string | null) => `${name}${color ? ` · ${color}` : ""}`;

/** İki liste — karşılanan siparişler (varsa) + sevk edilen toplar; kolonlar
 *  `cfg.columns.allocations` / `cfg.columns.rollTable` ile aç/kapa + sıralanır. */
function tableSections(doc: DirectShipDoc, cfg: DocumentConfig): DirectShipSection<never>[] {
  const allocations = doc.allocations ?? [];
  const t = doc.totals;
  const sections: DirectShipSection<never>[] = [];
  const add = <R,>(s: DirectShipSection<R>) => sections.push(s as unknown as DirectShipSection<never>);
  if (sectionOn(cfg.sections, "allocations") && allocations.length) {
    add<DirectShipAllocation>({
      key: "allocations",
      caption: `Karşılanan Siparişler (${allocations.length})`,
      colCfg: cfg.columns?.allocations,
      rows: allocations,
      cols: [
        { key: "seq", label: "#", align: "c", width: "34px", kind: INT, value: (_a, i) => i + 1 },
        { key: "orderNumber", label: "SİPARİŞ NO", align: "l", cellClass: "mono", kind: TEXT, value: (a) => a.orderNumber },
        { key: "itemColor", label: "ÜRÜN / RENK", align: "l", kind: TEXT, value: (a) => itemColor(a.itemName, a.colorName) },
        { key: "qty", label: "MİKTAR", align: "r", width: "90px", kind: QTY_M, value: (a) => a.qty },
      ],
    });
  }
  if (sectionOn(cfg.sections, "rollTable")) {
    add<DirectShipRoll>({
      key: "rollTable",
      caption: `Sevk Edilen Toplar (${t.rollCount})`,
      colCfg: cfg.columns?.rollTable,
      footLabel: "TOPLAM",
      rows: doc.rolls ?? [],
      cols: [
        { key: "seq", label: "#", align: "c", width: "34px", kind: INT, value: (r) => r.sequence },
        { key: "barcode", label: "BARKOD", align: "l", cellClass: "mono", kind: TEXT, value: (r) => r.barcode ?? "—" },
        { key: "itemColor", label: "ÜRÜN / RENK", align: "l", kind: TEXT, value: (r) => itemColor(r.itemName, r.colorName) },
        { key: "width", label: "EN", align: "c", width: "60px", kind: WIDTH_CM, value: (r) => (r.width != null ? Math.round(r.width) : "—") },
        { key: "meters", label: "METRE", align: "r", width: "80px", kind: QTY, value: (r) => r.dispatchedQty, foot: { value: t.totalQty, kind: QTY_M } },
        { key: "kg", label: "KG", align: "r", width: "70px", kind: QTY, value: (r) => r.dispatchedWeight ?? "—", foot: { value: t.totalWeight > 0 ? t.totalWeight : "—", kind: QTY_KG } },
      ],
    });
  }
  return sections;
}

/**
 * Fasondan doğrudan sevk irsaliyesinin İÇERİK kararları — TEK ÇÖZÜCÜ. HTML
 * (`renderFasonDirectShipHtml`) ve Excel (`renderFasonDirectShipTables`) buradan türer.
 */
export function directShipParts(snapshot: PrintedDocSnapshot, meta: DirectShipRenderMeta) {
  const doc = snapshot.doc as unknown as DirectShipDoc;
  const cfg = snapshot.docConfigOverride ?? {};
  const title = docTitle(cfg.titleOverride, "FASONDAN SEVK İRSALİYESİ");
  // Serbest not (cfg.footerNote) — sections.notes !== false ise (default açık).
  const footerNote = sectionOn(cfg.sections, "notes") && cfg.footerNote ? cfg.footerNote : null;
  const watermark: "draft" | "void" | "old" | null = meta.draft
    ? "draft"
    : meta.status === "VOIDED"
      ? "void"
      : meta.status === "SUPERSEDED"
        ? "old"
        : null;
  return {
    doc,
    cfg,
    title,
    headRight: headRightItems(doc, cfg),
    boxes: infoBoxes(doc, cfg),
    sections: tableSections(doc, cfg),
    footerNote,
    watermark,
  };
}

const WM_TEXT = { draft: "TASLAK", void: "İPTAL", old: "ESKİ KOPYA" } as const;

/**
 * Fasondan doğrudan sevk irsaliyesinin EXCEL karşılığı — HTML ile AYNI çözücüden
 * (`directShipParts`): kolon, sıra, başlık ve değer PDF'tekidir.
 */
export function renderFasonDirectShipTables(
  snapshot: PrintedDocSnapshot,
  meta: DirectShipRenderMeta = {},
): DocTablesPayload {
  const p = directShipParts(snapshot, meta);
  const header: Array<[string, string | null]> = [
    ...(p.watermark ? [[WM_TEXT[p.watermark], null] as [string, null]] : []),
    [p.title, null],
    ...(snapshot.company?.name ? [[snapshot.company.name, null] as [string, null]] : []),
    ...p.headRight.map((i): [string, string] => [i.label, i.value]),
    ...p.boxes.flatMap((b): Array<[string, string | null]> => [[b.title, null], ...b.rows.map((r): [string, string] => [r.label, r.value])]),
  ];
  const notes = [p.footerNote, meta.printNote].filter((n): n is string => !!n && !!n.trim());
  return {
    docType: "SUBCONTRACTOR_DIRECT_SHIP",
    documentNo: p.doc.shipmentNo ?? p.doc.dispatchNo,
    header,
    tables: p.sections.map((s) =>
      resolveDocTable({ key: s.key, caption: s.caption, cols: s.cols, rows: s.rows, colCfg: s.colCfg, footLabel: s.footLabel, kit: FMT_KIT }),
    ),
    notes,
  };
}
