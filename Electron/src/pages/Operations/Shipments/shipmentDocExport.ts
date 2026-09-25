import { printedDocumentService } from "@/services/printedDocumentService";
import { buildWorkbook, saveWorkbook } from "@/lib/xlsx-export";
import { docTablesToSheets, type DocTablesPayload } from "@/lib/doc-tables-export";
import { accountingDispatchService } from "@/pages/Operations/AccountingDispatch/service";
import {
  buildDispatchReportSheets,
  dispatchReportNotes,
} from "@/pages/Operations/AccountingDispatch/accounting-export";
import type { DispatchReport } from "@/pages/Operations/AccountingDispatch/types";

// =============================================================================
// Sevkiyat BELGE (irsaliye / sevk fişi) indirme — PDF veya Excel, tekli/toplu.
// Sevk İrsaliyesi ve Sevkiyatlar (Muhasebe) ekranları paylaşır. Donmuş belge YALNIZ
// sevk edilmiş (DISPATCHED) sevkiyatta var → çağıran taraf yalnız onları hedef verir.
//   • PDF: getHtml → tekli save-dialog (ad=sevk no) / toplu KLASÖRE (her biri sevk no).
//   • Excel: PDF'i çizen AYNI kolon çözücüsünün tabloları (`/tables`) → tekli
//     indirme / toplu KLASÖRE. Kolon listesi burada YAZILMAZ.
// =============================================================================

export interface DocTarget {
  /** Kaynak id (Shipment.id veya DirectShipment.id). */
  id: string;
  /** Dosya adı (benzersiz) — sevkiyat no. */
  shipmentNo: string;
  /** Fasondan doğrudan sevk mi → farklı docType + rapor ucu. */
  isDirect: boolean;
}

export interface ExportOutcome {
  ok: boolean;
  count?: number;
  error?: string;
}

const docTypeOf = (t: DocTarget) =>
  t.isDirect ? ("SUBCONTRACTOR_DIRECT_SHIP" as const) : ("SHIPMENT_DISPATCH" as const);

const reportOf = (t: DocTarget) =>
  t.isDirect ? accountingDispatchService.getDirectReport(t.id) : accountingDispatchService.getReport(t.id);

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Excel tablolarını belge ucundan iste; eski sunucuda (uç yok / tip tanımsız) "legacy". */
async function fetchDocTables(
  t: DocTarget,
  opts?: TablesOpts,
): Promise<DocTablesPayload | "legacy"> {
  try {
    const res = await printedDocumentService.getTables(docTypeOf(t), t.id, opts);
    if (res.data) return res.data;
    throw new Error("Belge verisi alınamadı.");
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 404 || status === 400) return "legacy";
    throw e;
  }
}

/** `/tables` ile aynı tek seferlik seçimler (belge diyaloğundaki baskı seçenekleri). */
export interface TablesOpts {
  /** Önizlenen sürüm (null = güncel) ve "güncel şablonla" — PDF önizlemesiyle aynı. */
  version?: number | null;
  currentTemplate?: boolean;
  draft?: boolean;
  rowNotes?: boolean;
  rowTags?: boolean;
  sections?: string[];
}

/**
 * Tek sevkiyatın Excel'i. Kolonlar/satırlar/değerler PDF'in çözücüsünden gelir;
 * fiş verisi (`report`) yalnız dipnotlar (brüt · iade · taslak) için okunur.
 * Eski sunucu `/tables`ı tanımıyorsa eski fiş kurucusuna düşülür.
 */
export async function buildDispatchWorkbook(
  t: DocTarget,
  opts?: TablesOpts,
  report?: DispatchReport | null,
): Promise<Blob | null> {
  const rep = report ?? (await reportOf(t)).data ?? null;
  if (!t.isDirect) {
    const tables = await fetchDocTables(t, opts);
    if (tables !== "legacy") {
      return buildWorkbook(docTablesToSheets(tables, rep ? dispatchReportNotes(rep) : []));
    }
  }
  return rep ? buildWorkbook(buildDispatchReportSheets(rep)) : null;
}

/** Seçili sevkiyatların belgesini PDF olarak indir: tek → kaydet dialoğu; çok → klasör. */
export async function downloadDocsPdf(targets: DocTarget[]): Promise<ExportOutcome> {
  const pdfApi = typeof window !== "undefined" ? window.api?.pdf : undefined;
  if (!pdfApi) return { ok: false, error: "PDF desteği yok (masaüstü uygulaması gerekli)." };
  if (targets.length === 0) return { ok: false, error: "Sevkiyat seçilmedi." };

  if (targets.length === 1) {
    const t = targets[0]!;
    const html = await printedDocumentService.getHtml(docTypeOf(t), t.id);
    const res = await pdfApi.save({ html, suggestedName: t.shipmentNo });
    return { ok: res.saved, count: res.saved ? 1 : 0, error: res.error };
  }

  const items: { html: string; name: string }[] = [];
  for (const t of targets) {
    items.push({ html: await printedDocumentService.getHtml(docTypeOf(t), t.id), name: t.shipmentNo });
  }
  const res = await pdfApi.saveBatch({ items });
  return { ok: res.saved, count: res.count, error: res.error };
}

/** Seçili sevkiyatların belgesini Excel olarak indir: tek → indirme; çok → klasör. */
export async function downloadDocsExcel(targets: DocTarget[]): Promise<ExportOutcome> {
  if (targets.length === 0) return { ok: false, error: "Sevkiyat seçilmedi." };

  if (targets.length === 1) {
    const t = targets[0]!;
    const blob = await buildDispatchWorkbook(t);
    if (!blob) return { ok: false, error: "Fiş verisi alınamadı." };
    const saved = await saveWorkbook(blob, t.shipmentNo);
    return { ok: saved, count: saved ? 1 : 0 };
  }

  const filesApi = typeof window !== "undefined" ? window.api?.files : undefined;
  if (!filesApi) return { ok: false, error: "Dosya desteği yok (masaüstü uygulaması gerekli)." };
  const items: { name: string; base64: string }[] = [];
  for (const t of targets) {
    const blob = await buildDispatchWorkbook(t);
    if (!blob) continue;
    items.push({ name: `${t.shipmentNo}.xlsx`, base64: await blobToBase64(blob) });
  }
  if (items.length === 0) return { ok: false, error: "Fiş verisi alınamadı." };
  const res = await filesApi.saveBatch({ items });
  return { ok: res.saved, count: res.count, error: res.error };
}
