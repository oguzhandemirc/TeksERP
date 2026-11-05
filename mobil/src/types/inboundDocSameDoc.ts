// `GET /gelen-belge/ayni-belge` ve 409 `DOCUMENT_SCAN_NOT_FREE` details.sameDocument tel tipi (sunucu `gelen-belge-ayni-belge.service.ts`).
export type SameDocumentState = 'DRAFT' | 'PROCESSED' | 'CANCELLED';

export interface SameDocumentMatch {
  via: 'SHA' | 'DOC_NO';
  note: { id: string; noteNo: string; status: string; senderDocNo: string | null; createdAt: string; approvedAt: string | null; updatedAt: string };
  state: SameDocumentState;
  /** Belgenin toplarının iş emirleri (iptaller dahil, en yeni önce, en çok 5). */
  workOrders: Array<{ id: string; workOrderNumber: string; status: string }>;
}

export interface SameDocumentQuery {
  sha256?: readonly string[];
  ownerCustomerId?: string | null;
  senderDocNo?: string | null;
  excludeNoteId?: string | null;
}
