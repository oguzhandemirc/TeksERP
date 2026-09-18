// =============================================================================
// Z1 ÜRETİM BELGE ZİNCİRİ — ÜÇ KAPI, TEK HELPER (2026-09-18)
// =============================================================================
// Her bağ OPSİYONEL doğar (stoka dokuma · serbest levent · işsiz koşum meşru); zorunluluk yalnız üç davranış
// bayrağıyla açılır (`SystemSetting`, varsayılan KAPALI = bugünkü davranış). Etkin değer §3.6 resolver'larından
// (modül kapalıyken kapı KOŞMAZ). Eski istemci ne yapar: alanı göndermez → bayrak kapalıyken bugünkü gibi
// bağsız kayıt; açıkken Türkçe 400 (`details.code` sabit). Tasarım: docs/design/URETIM-BELGE-ZINCIRI.md §4.
// =============================================================================
import type { Prisma } from "@prisma/client";
import { WeavingExecutionKind, WeavingOrderStatus } from "@prisma/client";
import type prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import {
  resolveBeamWeavingLinkRequired,
  resolveOrderLineLinkRequired,
  resolveRunWeavingOrderRequired,
} from "../system-setting.service";

type Db = Prisma.TransactionClient | typeof prisma;

export const CHAIN_GATE_CODES = {
  beam: "BEAM_WEAVING_LINK_REQUIRED",
  run: "RUN_WEAVING_ORDER_REQUIRED",
  orderLine: "WEAVING_ORDER_LINE_REQUIRED",
  notLinkable: "WEAVING_ORDER_NOT_LINKABLE",
  warpSpecMismatch: "WARP_SPEC_MISMATCH",
} as const;

/** Levent sarımı/planı: bayrak açıkken dokuma işi bağı zorunlu. */
export async function assertBeamWeavingLinkGate(db: Db, weavingOrderId: string | null): Promise<void> {
  if (weavingOrderId) return;
  if (!(await resolveBeamWeavingLinkRequired(db))) return;
  throw AppError.badRequest("Levent için dokuma işi seçilmeli (ayar: levent sarımında dokuma işi zorunlu).", { code: CHAIN_GATE_CODES.beam });
}

/** Koşum açma: bayrak açıkken dokuma işi zorunlu. */
export async function assertRunWeavingOrderGate(db: Db, weavingOrderId: string | null): Promise<void> {
  if (weavingOrderId) return;
  if (!(await resolveRunWeavingOrderRequired(db))) return;
  throw AppError.badRequest("Koşum için dokuma işi seçilmeli (ayar: tezgah koşumu dokuma işine bağlı açılır).", { code: CHAIN_GATE_CODES.run });
}

/** Dokuma işi: bayrak açıkken en az bir sipariş satırı bağı zorunlu. */
export async function assertOrderLineLinkGate(db: Db, linkCount: number): Promise<void> {
  if (linkCount > 0) return;
  if (!(await resolveOrderLineLinkRequired(db))) return;
  throw AppError.badRequest("Dokuma işi en az bir sipariş satırına bağlanmalı (ayar: dokuma işi sipariş satırına bağlı).", { code: CHAIN_GATE_CODES.orderLine });
}

export interface LinkableWeavingOrder {
  id: string;
  weavingOrderNumber: string;
  status: WeavingOrderStatus;
  executionKind: WeavingExecutionKind;
  warpSpecId: string | null;
}

/**
 * Levent/koşumun bağlanabileceği iş: AÇIK (PLANNED/IN_PROGRESS) ve İÇERİDE dokunan. Fasona verilen işin
 * leventi burada sarılmaz, koşumu burada açılmaz; kapanmış işe bağ tarihi yeniden yazar — ikisi de 400.
 */
export async function assertWeavingOrderLinkableTx(db: Db, weavingOrderId: string): Promise<LinkableWeavingOrder> {
  const wo = await db.weavingOrder.findUnique({
    where: { id: weavingOrderId },
    select: { id: true, weavingOrderNumber: true, status: true, executionKind: true, warpSpecId: true },
  });
  if (!wo) throw AppError.badRequest("Dokuma işi bulunamadı.", { code: CHAIN_GATE_CODES.notLinkable });
  if (wo.status !== WeavingOrderStatus.PLANNED && wo.status !== WeavingOrderStatus.IN_PROGRESS) {
    throw AppError.badRequest(`${wo.weavingOrderNumber} kapanmış/iptal edilmiş — açık bir dokuma işi seçin.`, { code: CHAIN_GATE_CODES.notLinkable });
  }
  if (wo.executionKind !== WeavingExecutionKind.IN_HOUSE) {
    throw AppError.badRequest(`${wo.weavingOrderNumber} fasona verilmiş — levent/koşum yalnız içeride dokunan işe bağlanır.`, { code: CHAIN_GATE_CODES.notLinkable });
  }
  return wo;
}

/** Çözgü kartı uyumsuzluğu RED DEĞİL uyarıdır (`ApiResponse.warnings`, düz metin — kalıp `[WARP_SPEC_MISMATCH]` öneki); iş kartsızsa uyarı yok. */
export function warpSpecMismatchWarning(beam: { warpSpecId: string }, wo: LinkableWeavingOrder): string | null {
  if (!wo.warpSpecId || wo.warpSpecId === beam.warpSpecId) return null;
  return `[${CHAIN_GATE_CODES.warpSpecMismatch}] Leventin çözgü kartı ${wo.weavingOrderNumber} işinin çözgü kartından farklı — kayıt alındı, kontrol edin.`;
}
