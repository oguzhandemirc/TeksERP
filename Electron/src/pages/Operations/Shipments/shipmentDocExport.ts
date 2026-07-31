import { printedDocumentService } from "@/services/printedDocumentService";
import { buildWorkbook, saveWorkbook } from "@/lib/xlsx-export";
import { accountingDispatchService } from "@/pages/Operations/AccountingDispatch/service";
import { buildDispatchReportSheets } from "@/pages/Operations/AccountingDispatch/accounting-export";

// =============================================================================
// Sevkiyat BELGE (irsaliye / sevk fişi) indirme — PDF veya Excel, tekli/toplu.
// Sevk İrsaliyesi ve Sevkiyatlar (Muhasebe) ekranları paylaşır. Donmuş belge YALNIZ
// sevk edilmiş (DISPATCHED) sevkiyatta var → çağıran taraf yalnız onları hedef verir.
//   • PDF: getHtml → tekli save-dialog (ad=sevk no) / toplu KLASÖRE (her biri sevk no).
//   • Excel: sevk fişi 3-bölüm veri → tekli indirme / toplu KLASÖRE.
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
    const report = (await reportOf(t)).data;
    if (!report) return { ok: false, error: "Fiş verisi alınamadı." };
    const blob = await buildWorkbook(buildDispatchReportSheets(report));
    const saved = await saveWorkbook(blob, t.shipmentNo);
    return { ok: saved, count: saved ? 1 : 0 };
  }

  const filesApi = typeof window !== "undefined" ? window.api?.files : undefined;
  if (!filesApi) return { ok: false, error: "Dosya desteği yok (masaüstü uygulaması gerekli)." };
  const items: { name: string; base64: string }[] = [];
  for (const t of targets) {
    const report = (await reportOf(t)).data;
    if (!report) continue;
    const blob = await buildWorkbook(buildDispatchReportSheets(report));
    items.push({ name: `${t.shipmentNo}.xlsx`, base64: await blobToBase64(blob) });
  }
  if (items.length === 0) return { ok: false, error: "Fiş verisi alınamadı." };
  const res = await filesApi.saveBatch({ items });
  return { ok: res.saved, count: res.count, error: res.error };
}
