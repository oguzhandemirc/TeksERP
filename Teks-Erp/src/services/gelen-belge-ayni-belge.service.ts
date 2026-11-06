// =============================================================================
// GELEN BELGE — "bu belge zaten var" kısayolu (aynı fotoğraf / aynı belge no; salt okuma)
// =============================================================================
// Tablet taslak AÇMADAN önce sorar: aynı bayt (sha256) yükleme yolunun yeniden kullanacağı kayda mı gidecek, ya da
// BLOCK kipinde (sahip, belge no) iptal dışı başka belgede mi duruyor. Karar yükleme/onay yolunun AYNI helper'larıyla
// verilir (`latestScanBySha` · `scanNeedsFreshRecord` · iptal dışı eş) — kısayol yüklemenin kararını öngörür, ayrışmaz.
// =============================================================================
import { DeliveryNoteStatus, type WorkOrderStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { readDuplicateDocNoMode } from "./system-setting.service";
import { latestScanBySha, scanNeedsFreshRecord } from "./helpers/gelen-belge-mukerrer.helper";
import { whereWorkOrdersOfRolls } from "./helpers/workorder-rolls.helper";

export type SameDocumentState = "DRAFT" | "PROCESSED" | "CANCELLED";

export interface SameDocumentMatch {
  via: "SHA" | "DOC_NO";
  note: { id: string; noteNo: string; status: DeliveryNoteStatus; senderDocNo: string | null; createdAt: Date; approvedAt: Date | null; updatedAt: Date };
  state: SameDocumentState;
  /** Belgenin toplarının iş emirleri (iptaller dahil, en yeni önce, en çok 5). */
  workOrders: Array<{ id: string; workOrderNumber: string; status: WorkOrderStatus }>;
}

export interface SameDocumentQuery {
  sha256?: string[];
  ownerCustomerId?: string | null;
  senderDocNo?: string | null;
  excludeNoteId?: string | null;
}

/** Taslak (onay öncesi) → forma açılır; iptal → yalnız bilgi; kalan her durum işlenmiş sayılır. */
function stateOf(status: DeliveryNoteStatus): SameDocumentState {
  if (status === DeliveryNoteStatus.CANCELLED) return "CANCELLED";
  return status === DeliveryNoteStatus.DRAFT ? "DRAFT" : "PROCESSED";
}

/** Bir belgenin kısayol kartı verisi — 409 `DOCUMENT_SCAN_NOT_FREE` ayrıntısı da buradan. */
export async function sameDocumentByNoteId(noteId: string, via: SameDocumentMatch["via"]): Promise<SameDocumentMatch | null> {
  const note = await prisma.customerDeliveryNote.findUnique({
    where: { id: noteId },
    select: { id: true, noteNo: true, status: true, senderDocNo: true, createdAt: true, approvedAt: true, updatedAt: true },
  });
  if (!note) return null;
  const workOrders = await prisma.workOrder.findMany({
    where: whereWorkOrdersOfRolls({ deliveryNoteLine: { noteId } }),
    select: { id: true, workOrderNumber: true, status: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 5,
  });
  return { via, note, state: stateOf(note.status), workOrders };
}

/**
 * SHA: yüklemenin yeniden kullanacağı kayıt bir belgeye bağlıysa (ve o belge çağıranın kendi taslağı değilse) eşleşme;
 * WARN/ALLOW'da bitmiş belgenin fotoğrafı yeni kayıt doğurur → eşleşme yok. DOC_NO: yalnız BLOCK — iptal dışı eş.
 */
export async function findSameDocument(q: SameDocumentQuery): Promise<{ match: SameDocumentMatch | null }> {
  const mode = await readDuplicateDocNoMode();
  for (const sha of q.sha256 ?? []) {
    const scan = await latestScanBySha(prisma, sha, { noteId: true });
    if (!scan?.noteId || scan.noteId === q.excludeNoteId) continue;
    if (await scanNeedsFreshRecord(prisma, scan, mode)) continue;
    const match = await sameDocumentByNoteId(scan.noteId, "SHA");
    if (match) return { match };
  }
  const docNo = q.senderDocNo?.trim();
  if (mode === "BLOCK" && q.ownerCustomerId && docNo) {
    const peer = await prisma.customerDeliveryNote.findFirst({
      where: {
        ownerCustomerId: q.ownerCustomerId, senderDocNo: docNo, status: { not: DeliveryNoteStatus.CANCELLED },
        ...(q.excludeNoteId ? { id: { not: q.excludeNoteId } } : {}),
      },
      select: { id: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    if (peer) return { match: await sameDocumentByNoteId(peer.id, "DOC_NO") };
  }
  return { match: null };
}
