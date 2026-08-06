// =============================================================================
// TOPLU BELGE — seçili iş emirlerinin belgelerini tarama / basma / PDF'e yazma
// =============================================================================
// Liste TEK KAYNAKTAN gelir: `GET /work-orders/:id/documents` (iş emri başına bir
// istek). İstemci kendi belge listesini KURMAZ — backend yeni bir belge tipi
// eklediğinde burada kod değişmez, tip seçim kutusu kendiliğinden doğar.
//
// İki çıkış yolu, ikisi de bilinçli olarak farklı:
//   • YAZDIR → belgeler TEK baskı işine birleştirilir (`mergeDocsForPrint`);
//     operatör 40 belge için 40 yazıcı diyaloğu tıklamaz.
//   • PDF    → her belge AYRI dosya (`pdf:saveBatch`), her biri kendi gizli
//     penceresinde render edilir → tekil baskıyla bire bir aynı. Arşiv/e-posta
//     yolu budur; birleştirmenin hiçbir dönüşümü buraya girmez.
//
// ⚠️ ATLANAN HİÇBİR ŞEY SESSİZ DEĞİL: belgesi olmayan iş emri, listesi alınamayan
// iş emri ve HTML'i alınamayan belge ayrı ayrı raporlanır ("42 basıldı" deyip
// 8'inin neden düştüğünü yutmak en kötü davranıştır).
// =============================================================================

import { printedDocumentService, type PrintedDocType } from "@/services/printedDocumentService";
import { mergeDocsForPrint } from "@/lib/print-merge";
import { printHtmlString } from "@/lib/print";
import { workOrderService } from "./service";
import type { WorkOrderDocument } from "./types";

export type BulkDocType = WorkOrderDocument["docType"];

export const BULK_DOC_LABELS: Record<BulkDocType, string> = {
  TRAVELER_CARD: "Refakat Kartı",
  SUBCONTRACTOR_DISPATCH: "Fason Sevk İrsaliyesi",
  SUBCONTRACTOR_RECEIPT: "Fason Kabul Makbuzu",
  SUBCONTRACTOR_DIRECT_SHIP: "Fasondan Doğrudan Sevk",
};

/** Baskı sırası — aynı tip (ve çoğunlukla aynı kâğıt boyutu) yan yana çıksın. */
export const BULK_DOC_ORDER: BulkDocType[] = [
  "TRAVELER_CARD",
  "SUBCONTRACTOR_DISPATCH",
  "SUBCONTRACTOR_RECEIPT",
  "SUBCONTRACTOR_DIRECT_SHIP",
];

/** Tek işte üretilecek belge tavanı — kazara 50 iş emri × 6 belge seçildiğinde
 *  yüzlerce sayfalık bir baskı işine sessizce girilmesin. Aşılırsa arayüz söyler. */
export const BULK_DOC_LIMIT = 300;

export interface BulkWorkOrder {
  id: string;
  workOrderNumber: string;
}

export interface BulkDocRow {
  wo: BulkWorkOrder;
  doc: WorkOrderDocument;
}

export interface ScanResult {
  rows: BulkDocRow[];
  /** Seçilmiş ama hiç belgesi olmayan iş emirleri. */
  emptyWorkOrders: BulkWorkOrder[];
  /** Belge listesi alınamayan iş emirleri (ağ/yetki). */
  failed: { wo: BulkWorkOrder; error: string }[];
}

/** Sınırlı eşzamanlılıkla sırayı koruyan map — 50 iş emri için 50 paralel istek
 *  açmak sunucuyu (ve tek connection'lı pg havuzunu) gereksiz yorar. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onDone?: (completed: number) => void,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
      onDone?.(++completed);
    }
  });
  await Promise.all(workers);
  return out;
}

const errText = (e: unknown): string =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  (e as Error)?.message ??
  "Bilinmeyen hata";

/** Seçili iş emirlerinin belge listelerini toplar (iş emri başına 1 istek). */
export async function scanWorkOrderDocuments(
  workOrders: BulkWorkOrder[],
  onProgress?: (done: number, total: number) => void,
): Promise<ScanResult> {
  const rows: BulkDocRow[] = [];
  const emptyWorkOrders: BulkWorkOrder[] = [];
  const failed: { wo: BulkWorkOrder; error: string }[] = [];

  type Scanned = { wo: BulkWorkOrder; docs: WorkOrderDocument[]; error: string | null };
  const results = await mapLimit<BulkWorkOrder, Scanned>(
    workOrders,
    5,
    async (wo) => {
      try {
        const res = await workOrderService.getDocuments(wo.id);
        return { wo, docs: res.data?.documents ?? [], error: null };
      } catch (e) {
        return { wo, docs: [], error: errText(e) };
      }
    },
    (done) => onProgress?.(done, workOrders.length),
  );

  for (const r of results) {
    if (r.error) {
      failed.push({ wo: r.wo, error: r.error });
      continue;
    }
    if (r.docs.length === 0) emptyWorkOrders.push(r.wo);
    for (const doc of r.docs) rows.push({ wo: r.wo, doc });
  }
  return { rows, emptyWorkOrders, failed };
}

/** Tip + iptal süzgeci; çıktı TİPE göre (sonra iş emri sırasına göre) sıralanır. */
export function selectRows(
  rows: BulkDocRow[],
  types: ReadonlySet<BulkDocType>,
  includeCancelled: boolean,
): BulkDocRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => types.has(row.doc.docType) && (includeCancelled || !row.doc.cancelled))
    .sort((a, b) => {
      const t = BULK_DOC_ORDER.indexOf(a.row.doc.docType) - BULK_DOC_ORDER.indexOf(b.row.doc.docType);
      return t !== 0 ? t : a.index - b.index;
    })
    .map(({ row }) => row);
}

/** Tip başına belge sayısı (iptaller dahil / hariç ayrı) — seçim kutusu etiketleri. */
export function countByType(
  rows: BulkDocRow[],
  includeCancelled: boolean,
): Record<BulkDocType, number> {
  const out = { TRAVELER_CARD: 0, SUBCONTRACTOR_DISPATCH: 0, SUBCONTRACTOR_RECEIPT: 0, SUBCONTRACTOR_DIRECT_SHIP: 0 };
  for (const r of rows) {
    if (!includeCancelled && r.doc.cancelled) continue;
    out[r.doc.docType]++;
  }
  return out;
}

export interface FetchedDoc {
  row: BulkDocRow;
  html: string;
}

/** Belgenin baskı-hazır HTML'i — kart ve resmi belgeler AYRI uçlardan gelir. */
function docHtml(row: BulkDocRow): Promise<string> {
  return row.doc.docType === "TRAVELER_CARD"
    ? workOrderService.getTravelerCardHtml(row.doc.sourceId)
    : printedDocumentService.getHtml(row.doc.docType as PrintedDocType, row.doc.sourceId);
}

export async function fetchDocHtmls(
  rows: BulkDocRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ docs: FetchedDoc[]; failed: { row: BulkDocRow; error: string }[] }> {
  const docs: FetchedDoc[] = [];
  const failed: { row: BulkDocRow; error: string }[] = [];
  type Fetched = { row: BulkDocRow; html: string; error: string | null };
  const results = await mapLimit<BulkDocRow, Fetched>(
    rows,
    4,
    async (row) => {
      try {
        return { row, html: await docHtml(row), error: null };
      } catch (e) {
        return { row, html: "", error: errText(e) };
      }
    },
    (done) => onProgress?.(done, rows.length),
  );
  for (const r of results) {
    // Boş gövde de HATADIR: baskıya boş sayfa eklemek, eksik belgeden kötüdür.
    if (r.error || !r.html) failed.push({ row: r.row, error: r.error ?? "Belge boş döndü" });
    else docs.push({ row: r.row, html: r.html });
  }
  return { docs, failed };
}

/** PDF dosya adı — klasörde iş emrine göre sıralansın diye WO no önde. */
export function pdfName(row: BulkDocRow): string {
  const label = BULK_DOC_LABELS[row.doc.docType];
  return row.doc.documentNo === row.wo.workOrderNumber
    ? `${row.wo.workOrderNumber} - ${label}`
    : `${row.wo.workOrderNumber} - ${label} - ${row.doc.documentNo}`;
}

export interface PrintOutcome {
  printed: number;
  /** Birleştirilemeyen belgeler — tek tek basılmalı (bkz. print-merge). */
  unmergeable: BulkDocRow[];
  /** Baskıda birden fazla kâğıt boyutu var mı (A5 kart + A4 çeki gibi). */
  sizes: string[];
}

/**
 * Belgeleri TEK baskı işinde yazdırır. Baskı diyaloğu açıldıktan SONRA refakat
 * kartları için `print-event` bildirilir — kartın içeriği canlı çözülüyor ve
 * basılan plan orada kaydediliyor (tekil diyalogla aynı sözleşme). Bildirim
 * hatası YUTULUR: kâğıt çıktı, baskıyı hata toast'ıyla kesmek işe yaramaz.
 *
 * ⚠️ PDF yolunda bu bildirim YAPILMAZ — dosyaya yazmak "bastım" değildir; her
 * arşiv indirmesinde kart sürümü ilerletmek numarayı anlamsızlaştırırdı.
 */
export async function printDocs(docs: FetchedDoc[]): Promise<PrintOutcome> {
  const merged = mergeDocsForPrint(docs.map((d) => d.html));
  const dropped = merged.unmergeable.map((i) => docs[i]!.row);
  // Hepsi elendiyse baskıyı hiç açma: boş kâğıt, "bir şey olmadı"dan kötüdür.
  if (dropped.length === docs.length) {
    return { printed: 0, unmergeable: dropped, sizes: [] };
  }
  printHtmlString(merged.html);

  const cardIds = docs
    .filter((d, i) => d.row.doc.docType === "TRAVELER_CARD" && !merged.unmergeable.includes(i))
    .map((d) => d.row.doc.sourceId);
  for (const id of cardIds) {
    try {
      await workOrderService.recordTravelerCardPrint(id);
    } catch {
      /* yukarıdaki gerekçe — baskı akışını düşürme */
    }
  }

  return {
    printed: docs.length - dropped.length,
    unmergeable: dropped,
    sizes: [...new Set(merged.pageSizes.filter((s): s is string => Boolean(s)))],
  };
}

export interface PdfOutcome {
  ok: boolean;
  count?: number;
  error?: string;
}

/** Tek belge → kaydet diyaloğu; çok belge → klasöre her biri ayrı PDF. */
export async function savePdfDocs(docs: FetchedDoc[]): Promise<PdfOutcome> {
  const pdfApi = typeof window !== "undefined" ? window.api?.pdf : undefined;
  if (!pdfApi) return { ok: false, error: "PDF desteği yok (masaüstü uygulaması gerekli)." };
  if (docs.length === 0) return { ok: false, error: "Belge yok." };

  if (docs.length === 1) {
    const d = docs[0]!;
    const res = await pdfApi.save({ html: d.html, suggestedName: pdfName(d.row) });
    return { ok: res.saved, count: res.saved ? 1 : 0, error: res.error };
  }
  const res = await pdfApi.saveBatch({
    items: docs.map((d) => ({ html: d.html, name: pdfName(d.row) })),
  });
  return { ok: res.saved, count: res.count, error: res.error };
}
