import { printHtml } from './printHtml';
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// İŞ EMRİ BELGELERİ — liste + baskı (tek kapı)
// =============================================================================
// Belgeler dört ayrı kaynakta yaşıyor (TravelerCard + üç PrintedDocument tipi).
// Liste TEK uçtan gelir (`GET /work-orders/:id/documents`) ki istemciler kendi
// listelerini kurup ayrışmasın; baskı ise tipe göre iki farklı ucu kullanır:
//   • TRAVELER_CARD → /traveler-cards/:id/html  (+ print-event ile bayat işareti temizlenir)
//   • diğerleri     → /printed-documents/:docType/:sourceId/html
// Yeni belge tipi eklenirse: backend listeye ekler, burada YALNIZ `printDocument`
// dallanması gözden geçirilir (varsayılan dal zaten doğru ucu kullanır).
// =============================================================================

export type WorkOrderDocType =
  | 'TRAVELER_CARD'
  | 'SUBCONTRACTOR_DISPATCH'
  | 'SUBCONTRACTOR_RECEIPT'
  | 'SUBCONTRACTOR_DIRECT_SHIP';

export interface WorkOrderDocument {
  docType: WorkOrderDocType;
  /** Baskı ucunun kaynağı — kart için cardId, diğerleri için PrintedDocument.sourceId. */
  sourceId: string;
  documentNo: string;
  /** ISO — kartta basım anı, diğerlerinde olay anı (sevk/kabul/çıkış). */
  date: string;
  /** Gruplama başlığı: "İş Emri Belgeleri" ya da fason adımının istasyon adı. */
  group: string;
  title: string;
  subtitle: string;
  /** İptal edilmiş belge LİSTEDE KALIR (donmuş belge silinmez) — baskıda İPTAL filigranı alır. */
  cancelled: boolean;
  /** Yalnız TRAVELER_CARD: basılı kâğıt gerçekle ayrıştı mı. */
  contentDirty?: boolean;
}

export interface WorkOrderDocumentsResponse {
  workOrderNumber: string;
  documents: WorkOrderDocument[];
}

export const workOrderDocumentService = {
  list: (workOrderId: string): Promise<ApiResponse<WorkOrderDocumentsResponse>> =>
    apiClient
      .get<ApiResponse<WorkOrderDocumentsResponse>>(`/work-orders/${workOrderId}/documents`)
      .then((r) => r.data),
};

/**
 * Belgeyi bas. Kullanıcı yazdırma diyaloğunu iptal ederse `printHtml` throw eder
 * → çağıran sessiz geçer (mevcut kart/çeki baskı yollarıyla aynı sözleşme).
 */
export async function printDocument(doc: WorkOrderDocument): Promise<void> {
  if (doc.docType === 'TRAVELER_CARD') {
    const res = await apiClient.get<string>(`/traveler-cards/${doc.sourceId}/html`, {
      responseType: 'text',
      headers: { Accept: 'text/html' },
    });
    await printHtml({ html: typeof res.data === 'string' ? res.data : String(res.data) });
    // Baskı GERÇEKLEŞTİ → "kart güncel değil" işaretini temizle. GET /html bunu
    // yapamaz (önizlemeyi de besler). Bildirim hatası yutulur: kâğıt çıktı.
    try {
      await apiClient.post(`/traveler-cards/${doc.sourceId}/print-event`);
    } catch {
      /* baskı akışını hata ile kesme */
    }
    return;
  }

  const res = await apiClient.get<string>(
    `/printed-documents/${doc.docType}/${doc.sourceId}/html`,
    { responseType: 'text', headers: { Accept: 'text/html' } },
  );
  await printHtml({ html: typeof res.data === 'string' ? res.data : String(res.data) });
}
