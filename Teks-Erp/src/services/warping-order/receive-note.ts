// =============================================================================
// FASON DEVERE DÖNÜŞ KABULÜ — irsaliye no TEKRARI + dönüş TARTISI kipi (devere ek E1)
// =============================================================================
// İki ayar: `devere.duplicateDeliveryNote` (ALLOW · WARN varsayılan · BLOCK 409) ve `devere.receiveWeighing`
// (OFF · OPTIONAL varsayılan · REQUIRED). Tek-sipariş `/receive` ve kabul belgesi AYNI fonksiyonları çağırır.
// "Kullanılmış" = aynı deverecinin İPTAL EDİLMEMİŞ fason sarımlarından birinin WOUND olayında aynı no (harf duyarsız).
// BLOCK yarışı: aynı no'yu yazan iki kabul `lockDeliveryNoteTx` (8029 kapsamı) ile serileşir — tx'in ilk ifadesi.
// =============================================================================
import { Prisma, WarpBeamOrigin, WarpBeamStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { lockCodeScopeTx } from "../helpers/code-unique.helper";
import { settingRowPath } from "../../constants/panel-ayar-yolu";
import { factoryDateTr } from "../../constants/time";
import type { DevereDuplicateDeliveryNote, DevereReceiveWeighing } from "../system-setting/devere-receive";

type Db = Prisma.TransactionClient | typeof prisma;
export const DELIVERY_NOTE_LOCK_SCOPE = "warpingDeliveryNote";

export const normalizeDeliveryNoteNo = (v: string | null | undefined): string | null => v?.trim() || null;

/** Aynı irsaliye no'yu yazan kabulleri serileştirir (BLOCK kipinde ikiz doğmasın). Tx'in İLK ifadesi olmalı. */
export async function lockDeliveryNoteTx(tx: Prisma.TransactionClient, deliveryNoteNo: string | null): Promise<void> {
  if (deliveryNoteNo) await lockCodeScopeTx(tx, DELIVERY_NOTE_LOCK_SCOPE, deliveryNoteNo);
}

export interface DeliveryNoteUse { orderNo: string; docNo: string | null; receivedAt: string }

/** Deverecide bu irsaliye no ile yapılmış canlı kabuller (sipariş başı bir satır, en eski önce). */
export async function findDeliveryNoteUses(db: Db, subcontractorId: string, deliveryNoteNo: string | null): Promise<DeliveryNoteUse[]> {
  if (!deliveryNoteNo) return [];
  const beams = await db.warpBeam.findMany({
    where: {
      subcontractorId, originKind: WarpBeamOrigin.SUBCONTRACT, warpingOrderId: { not: null }, status: { not: WarpBeamStatus.CANCELLED },
      events: { some: { kind: "WOUND", deliveryNoteNo: { equals: deliveryNoteNo, mode: "insensitive" } } },
    },
    select: { warpingReceiptKey: true, createdAt: true, warpingOrder: { select: { orderNo: true } }, warpingReceiveDoc: { select: { docNo: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
  });
  const seen = new Set<string>();
  const out: DeliveryNoteUse[] = [];
  for (const b of beams) {
    const k = b.warpingReceiptKey ?? "";
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ orderNo: b.warpingOrder?.orderNo ?? "", docNo: b.warpingReceiveDoc?.docNo ?? null, receivedAt: b.createdAt.toISOString() });
  }
  return out;
}

const usesText = (uses: DeliveryNoteUse[]) =>
  uses.slice(0, 3).map((u) => `${u.docNo ? `${u.docNo} · ` : ""}${u.orderNo} (${factoryDateTr(new Date(u.receivedAt))})`).join(", ") + (uses.length > 3 ? ` ve ${uses.length - 3} kabul daha` : "");

/**
 * İrsaliye no tekrarı kararı. `enforce` (kabul tx'i) BLOCK'ta 409 atar; önizleme `enforce:false` ile engeli UYARI
 * metni olarak döner (kullanıcı göndermeden görür). ALLOW'da hiçbir şey dönmez.
 */
export async function deliveryNoteVerdict(db: Db, p: { subcontractorId: string; deliveryNoteNo: string | null; mode: DevereDuplicateDeliveryNote; enforce: boolean }): Promise<{ uses: DeliveryNoteUse[]; warnings: string[] }> {
  if (p.mode === "ALLOW" || !p.deliveryNoteNo) return { uses: [], warnings: [] };
  const uses = await findDeliveryNoteUses(db, p.subcontractorId, p.deliveryNoteNo);
  if (uses.length === 0) return { uses, warnings: [] };
  const base = `"${p.deliveryNoteNo}" irsaliye no bu deverecide daha önce kullanıldı: ${usesText(uses)}`;
  if (p.mode === "BLOCK") {
    const msg = `${base} — bu kurulumda aynı irsaliye no ile ikinci kabul engelli (${settingRowPath("devereDuplicateDeliveryNote")}).`;
    if (p.enforce) throw AppError.conflict(msg, { code: "WARPING_DELIVERY_NOTE_USED", deliveryNoteNo: p.deliveryNoteNo });
    return { uses, warnings: [msg] };
  }
  return { uses, warnings: [`${base} — aynı irsaliyenin devamıysa sorun yok; değilse irsaliye no'yu kontrol edin.`] };
}

/** Tartı kipi kapısı (DB'siz; ayar çağırandan). OFF'ta tartı girdisi 400, REQUIRED'da brütsüz satır 400. */
export function assertReceiveWeighing(beams: Array<{ grossKg?: number | null; tareKg?: number | null }>, mode: DevereReceiveWeighing, label = ""): void {
  if (mode === "OPTIONAL") return;
  beams.forEach((b, i) => {
    const has = b.grossKg != null || b.tareKg != null;
    if (mode === "OFF" && has) {
      throw AppError.badRequest(`${label}${i + 1}. satır: bu kurulumda dönüş tartısı kapalı — brüt/dara yazılmaz (${settingRowPath("devereReceiveWeighing")}).`, { code: "WARPING_RECEIVE_WEIGHING_OFF" });
    }
    if (mode === "REQUIRED" && b.grossKg == null) {
      throw AppError.badRequest(`${label}${i + 1}. satır: bu kurulumda dönüş tartısı zorunlu — brüt kg yazın.`, { code: "WARPING_RECEIVE_WEIGHING_REQUIRED" });
    }
  });
}
