// =============================================================================
// SATIŞ · TEKLİF · PLANLAMA OLAYLARI — S1 (geniş katalog 2026-11-14)
// =============================================================================
// Her OLAY türünün TEK yayma noktası bu dosyadaki fonksiyondur; çağıranlar iş kaydını doğuran/değiştiren tx'in
// İÇİNDEN çağırır (çekirdek kural: rollback → bildirim yok, replay yolunda çağrılmaz). Bayrak kapalıyken no-op.
// Yük yalnız kimlik + görüntü dizesi (tutar yok); `kullanici` emit helper'ında aktörden dolar (K4).
// =============================================================================
import type { Prisma } from "@prisma/client";
import { factoryDateTr } from "../../constants/time";
import { currentOrigin } from "../../lib/request-context";
import { emitNotification, type EmitDb } from "../helpers/notification-emit.helper";
import { readNotificationInboxEnabled } from "../system-setting/labels";
import { readNotificationParamsTx } from "../helpers/notification-params.helper";
import { formatNotificationNumber } from "../helpers/notification-render.helper";
import { readReworkReasonCode } from "../helpers/rework-billing.helper";
import { ITEM_UNIT_LABEL } from "../../constants/item-unit";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";

type Db = EmitDb & Pick<Prisma.TransactionClient, "order" | "orderLine" | "notificationFactoryDefault">;
export type Actor = string | null | undefined;
/** Aktör verilmeyen iç yollar (ör. sevk sonrası yeniden hesap) istek bağlamının kullanıcısına düşer; job'da null. */
export const who = (actor: Actor): string | null => actor ?? currentOrigin().userId ?? null;
/** Bayrak kapalı kurulumda yük okumalarını hiç yapma (emit helper da okur; bu ön kapı gereksiz sorguyu keser). */
export const off = async (tx: EmitDb): Promise<boolean> => !(await readNotificationInboxEnabled(tx));

async function orderFacts(tx: Db, orderId: string): Promise<{ siparisNo: string; musteriAd: string } | null> {
  const o = await tx.order.findUnique({ where: { id: orderId }, select: { orderNumber: true, customer: { select: { name: true } } } });
  return o ? { siparisNo: o.orderNumber, musteriAd: o.customer?.name ?? "—" } : null;
}

const ORDER = (id: string) => ({ type: "order", id, key: id });

/**
 * Siparişin birim başına miktarı (S6a, kullanıcı kararı "tutar yok, metre/adet"): canlı kalemler; hiç canlı kalem yoksa
 * (iptalde kalemler de kapanır) bütün kalemler. Metin "1250 m · 40 adet"; `metre` yalnız MT kalemleri.
 */
async function orderQuantity(tx: Db, orderId: string): Promise<{ miktar: string; metre: number }> {
  const groups = async (live: boolean) => tx.orderLine.groupBy({
    by: ["unit"], where: { orderId, ...(live ? { cancelledAt: null } : {}) }, _sum: { quantity: true }, orderBy: { unit: "asc" },
  });
  let rows = await groups(true);
  if (rows.length === 0) rows = await groups(false);
  const qty = (v: unknown) => Math.round(Number(String(v ?? 0)) * 100) / 100;
  const parts = rows.map((r) => `${formatNotificationNumber(qty(r._sum.quantity))} ${ITEM_UNIT_LABEL[r.unit]}`);
  const metre = qty(rows.find((r) => r.unit === "MT")?._sum.quantity);
  return { miktar: parts.length > 0 ? parts.join(" · ") : "kalem yok", metre };
}

/**
 * `siparis.olusturuldu` — sipariş doğuş tx'i (`insertPreparedOrderTx`, hızlı sipariş); aynı doğuşta MT toplamı katalog
 * `metre` eşiğine (varsayılan 5000) ulaşırsa `siparis.buyuk-siparis` (S6a). Bulut doğuşu (`notify:false`) ikisini de yazmaz.
 */
export async function emitOrderCreatedTx(tx: Db, orderId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await orderFacts(tx, orderId);
  if (!f) return;
  const kalemSayisi = await tx.orderLine.count({ where: { orderId } });
  const q = await orderQuantity(tx, orderId);
  await emitNotification(tx, "siparis.olusturuldu", ORDER(orderId), { siparisId: orderId, ...f, kalemSayisi, miktar: q.miktar }, { actorUserId: who(actor) });
  const esik = Number((await readNotificationParamsTx(tx, "siparis.buyuk-siparis")).metre ?? 5000);
  if (q.metre >= esik) {
    await emitNotification(tx, "siparis.buyuk-siparis", ORDER(orderId), { siparisId: orderId, ...f, kalemSayisi, metre: q.metre, esik }, { actorUserId: who(actor) });
  }
}

/** `siparis.degisti` / `siparis.termin-degisti` — sipariş güncelleme tx'i (`OrderService.update`). */
export async function emitOrderUpdatedTx(
  tx: Db,
  orderId: string,
  change: { deadline?: { from: Date | null; to: Date | null }; parts: string[] },
  actor: Actor,
): Promise<void> {
  if (await off(tx)) return;
  const f = await orderFacts(tx, orderId);
  if (!f) return;
  const d = change.deadline;
  if (d && (d.from?.getTime() ?? null) !== (d.to?.getTime() ?? null)) {
    await emitNotification(tx, "siparis.termin-degisti", ORDER(orderId), {
      siparisId: orderId, siparisNo: f.siparisNo,
      eskiTermin: d.from ? factoryDateTr(d.from) : "yok", yeniTermin: d.to ? factoryDateTr(d.to) : "yok",
    }, { actorUserId: who(actor) });
  }
  if (change.parts.length > 0) {
    await emitNotification(tx, "siparis.degisti", ORDER(orderId), {
      siparisId: orderId, siparisNo: f.siparisNo, degisiklik: change.parts.join(", "),
    }, { actorUserId: who(actor) });
  }
}

type LineLike = { id?: unknown; quantity?: unknown; unitPrice?: unknown; cancelledAt?: unknown };
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(String(v)));
/** Başlık alanları dışında kalan "termin" ayrı türdür; burada yalnız sözcük listesi (tutar YOK). Saf fonksiyon. */
export function describeOrderChanges(
  current: readonly LineLike[],
  incoming: readonly LineLike[] | null | undefined,
  headerKeys: readonly string[],
): string[] {
  const parts: string[] = [];
  const header = headerKeys.filter((k) => k !== "deadline" && k !== "updatedById" && k !== "totalAmount");
  if (header.length > 0) parts.push("başlık");
  if (!incoming) return parts;
  const live = current.filter((l) => l.cancelledAt == null);
  const byId = new Map(live.map((l) => [String(l.id), l]));
  const ids = new Set(incoming.map((l) => (typeof l.id === "string" ? l.id : "")).filter(Boolean));
  const added = incoming.filter((l) => typeof l.id !== "string" || !l.id).length;
  const removed = live.filter((l) => !ids.has(String(l.id))).length;
  let qty = 0;
  let price = 0;
  for (const l of incoming) {
    const old = typeof l.id === "string" ? byId.get(l.id) : undefined;
    if (!old) continue;
    if (num(l.quantity) !== null && num(l.quantity) !== num(old.quantity)) qty++;
    if (l.unitPrice !== undefined && num(l.unitPrice) !== num(old.unitPrice)) price++;
  }
  if (added) parts.push(`${added} kalem eklendi`);
  if (removed) parts.push(`${removed} kalem çıkarıldı`);
  if (qty) parts.push(`${qty} kalemde miktar`);
  if (price) parts.push(`${price} kalemde fiyat`);
  return parts;
}

/** `siparis.kalem-iptal` — kalem iptal tx'i (`cancelOrderLine`). */
export async function emitOrderLineCancelledTx(tx: Db, orderId: string, kalem: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await orderFacts(tx, orderId);
  if (!f) return;
  await emitNotification(tx, "siparis.kalem-iptal", ORDER(orderId), { siparisId: orderId, siparisNo: f.siparisNo, kalem }, { actorUserId: who(actor) });
}

/** `siparis.iptal` / `siparis.tamamlandi` — siparişi terminal duruma geçiren her yol (iptal ucu, silme, yeniden hesap, elle kapatma). */
export async function emitOrderTerminalTx(tx: Db, orderId: string, status: "CANCELLED" | "COMPLETED", actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await orderFacts(tx, orderId);
  if (!f) return;
  const payload = { siparisId: orderId, ...f, miktar: (await orderQuantity(tx, orderId)).miktar };
  if (status === "CANCELLED") await emitNotification(tx, "siparis.iptal", ORDER(orderId), payload, { actorUserId: who(actor) });
  else await emitNotification(tx, "siparis.tamamlandi", ORDER(orderId), payload, { actorUserId: who(actor) });
}

// ── İş emri ─────────────────────────────────────────────────────────────────
type WoDb = EmitDb & Pick<Prisma.TransactionClient, "workOrder">;
const WO = (id: string) => ({ type: "work_order", id, key: id });

/** `isemri.acildi` — iş emri doğuşunun TEK yolu `createWorkOrderTx`. */
export async function emitWorkOrderCreatedTx(tx: WoDb, workOrderId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const w = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: { workOrderNumber: true, targetItem: { select: { name: true } } },
  });
  if (!w) return;
  await emitNotification(tx, "isemri.acildi", WO(workOrderId), {
    isEmriId: workOrderId, isEmriNo: w.workOrderNumber, urunAd: w.targetItem?.name ?? "—",
  }, { actorUserId: who(actor) });
}

/**
 * `fason.yeniden-islem` (S6a, genel fason F9) — yeniden işlem sebepli İE doğuşu (`createWorkOrderTx`); sınıf İE'ye DONMUŞ
 * `reworkBillable`dan (false = bizim hatamız/faturasız · true = müşteri talebi · null = sınıfsız/ücretli), sebep katalog etiketi.
 */
export async function emitWorkOrderReworkTx(tx: WoDb & Pick<Prisma.TransactionClient, "reasonPreset">, workOrderId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const w = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { workOrderNumber: true, parameters: true, reworkBillable: true } });
  const code = w ? readReworkReasonCode(w.parameters) : null;
  if (!w || !code) return;
  const preset = await tx.reasonPreset.findUnique({ where: { kind_code: { kind: "WORK_ORDER_REWORK", code } }, select: { label: true } });
  const sinif = w.reworkBillable === false ? "bizim hatamız, faturaya girmez" : w.reworkBillable === true ? "müşteri talebi, ücretli" : "sınıfsız, ücretli";
  await emitNotification(tx, "fason.yeniden-islem", WO(workOrderId), {
    isEmriId: workOrderId, isEmriNo: w.workOrderNumber, sebep: preset?.label ?? code, sinif,
  }, { actorUserId: who(actor) });
}

/** `isemri.acil-isaretlendi` (S6a) — kurşun kuyruğu acil rozetinin KAPALI→AÇIK geçişi (`KursunQcService.setQueueUrgent`). */
export async function emitWorkOrderUrgentTx(
  tx: EmitDb & Pick<Prisma.TransactionClient, "workOrderStep">, stepId: string, actor: Actor,
): Promise<void> {
  if (await off(tx)) return;
  const st = await sequentialTx(tx).workOrderStep.findUnique({
    where: { id: stepId },
    select: { station: { select: { name: true } }, workOrder: { select: { id: true, workOrderNumber: true } } },
  });
  if (!st) return;
  await emitNotification(tx, "isemri.acil-isaretlendi", WO(st.workOrder.id), {
    isEmriId: st.workOrder.id, isEmriNo: st.workOrder.workOrderNumber, istasyonAd: st.station?.name ?? "—",
  }, { actorUserId: who(actor) });
}

/**
 * `isemri.baslatildi` (PLANNED→IN_PROGRESS) · `isemri.tamamlandi` (→COMPLETED) · `isemri.iptal` (→CANCELLED) —
 * statü değişiminin TEK yolu `claimWorkOrderStatusTx`. Yeniden açılma (COMPLETED→IN_PROGRESS) başlama sayılmaz.
 */
export async function emitWorkOrderStatusTx(tx: WoDb, workOrderId: string, { from, to }: { from: string; to: string }, actor: Actor): Promise<void> {
  const starts = to === "IN_PROGRESS" && from === "PLANNED";
  if (!starts && to !== "COMPLETED" && to !== "CANCELLED") return;
  if (await off(tx)) return;
  const w = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { workOrderNumber: true } });
  if (!w) return;
  const payload = { isEmriId: workOrderId, isEmriNo: w.workOrderNumber };
  const opts = { actorUserId: who(actor) };
  // Tür literal: tek-yayma tarayıcıları türü değişkenden okuyamaz.
  if (starts) await emitNotification(tx, "isemri.baslatildi", WO(workOrderId), payload, opts);
  else if (to === "COMPLETED") await emitNotification(tx, "isemri.tamamlandi", WO(workOrderId), payload, opts);
  else await emitNotification(tx, "isemri.iptal", WO(workOrderId), payload, opts);
}

/** `isemri.rota-degisti` — rota etiketi farkı (`workorder-field-diff.helper` rota satırı). */
export async function emitWorkOrderRouteChangedTx(tx: WoDb, workOrderId: string, { from, to }: { from: string; to: string }, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const w = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { workOrderNumber: true } });
  if (!w) return;
  await emitNotification(tx, "isemri.rota-degisti", WO(workOrderId), {
    isEmriId: workOrderId, isEmriNo: w.workOrderNumber, eskiRota: from || "—", yeniRota: to || "—",
  }, { actorUserId: who(actor) });
}
