// Gelen belge (irsaliye) girdi tipleri — gelen-belge-note.service.ts'ten bölündü (dosya boyu tavanı); servis aynı adlarla yeniden verir.
import type { DeliveryNoteSourceKind, DeliveryNoteStatus } from "@prisma/client";
import type { DeliveryNoteLineInput } from "./gelen-belge-line.service";

// ── Girdi tipleri (route Zod'u bunlara daraltır) ────────────────────────────
export interface DeliveryNoteHeaderInput {
  ownerCustomerId?: string | null;
  senderCustomerId?: string | null;
  senderText?: string | null;
  senderDocNo?: string | null;
  /** YYYY-AA-GG — takvim günü. */
  senderDocDate?: string | null;
  customerBatchNo?: string | null;
  customerOrderNo?: string | null;
  processText?: string | null;
  pageCount?: number | null;
  declaredTopCount?: number | null;
  totalsDeclared?: Record<string, unknown> | null;
}
export interface DeliveryNoteCreateInput extends DeliveryNoteHeaderInput {
  clientToken?: string | null;
  sourceKind: Exclude<DeliveryNoteSourceKind, "OCR">;
  /** Önceden yüklenmiş, sahipsiz taramalar (sha256 ile doğmuş) taslağa bağlanır. */
  scanIds?: string[];
  lines?: DeliveryNoteLineInput[];
}
export interface DeliveryNoteListQuery {
  status?: DeliveryNoteStatus;
  sourceKind?: DeliveryNoteSourceKind;
  ownerCustomerId?: string | string[];
  senderCustomerId?: string | string[];
  q?: string;
  /** createdAt aralığı (dahil); gün-yalnız değer fabrika gününün başı/sonu. */
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}
