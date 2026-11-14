// =============================================================================
// CARİ KART · ÜRÜN KARTI OLAYLARI — S4 (geniş katalog 2026-11-14)
// =============================================================================
// Tek yayma noktaları; çağıranlar kartı doğuran / durumunu geçiren tx'in İÇİNDEN çağırır. Yalnız çekirdek ana veri
// modellerini okur (finans modeli YOK — kart router'ı ön muhasebe rejim kapısına bağlanmasın). Toplu içe aktarma ve
// yönetim bulutu doğuşu bu türleri yaymaz (`notify:false`; bulut kendi türünü `cari.patron-carisi` yayar).
// =============================================================================
import type { Prisma } from "@prisma/client";
import { emitNotification, type EmitDb } from "../helpers/notification-emit.helper";
import { off, who, type Actor } from "./satis";

type Tx = EmitDb & Prisma.TransactionClient;
const subject = (type: string, id: string) => ({ type, id, key: id });
const txt = (s: string | null | undefined, max = 120): string => (s?.trim() ? s.trim().slice(0, max) : "—");

async function cardFacts(tx: Tx, customerId: string): Promise<{ cariId: string; cariAd: string; cariKodu: string } | null> {
  const c = await tx.customer.findUnique({ where: { id: customerId }, select: { name: true, code: true } });
  return c ? { cariId: customerId, cariAd: c.name, cariKodu: c.code } : null;
}

/** `cari.olusturuldu` — kart doğuş tx'i (`CustomerService.createCardInTx`; panel · hızlı kayıt · token boğazı). */
export async function emitCustomerCardCreatedTx(tx: Tx, customerId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await cardFacts(tx, customerId);
  if (!f) return;
  await emitNotification(tx, "cari.olusturuldu", subject("customer", customerId), f, { actorUserId: who(actor) });
}

/** `cari.pasife-alindi` — arşiv kapısının yazımı (`CustomerService` update/softDelete → `archiveMasterData`). */
export async function emitCustomerArchivedTx(tx: Tx, customerId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await cardFacts(tx, customerId);
  if (!f) return;
  await emitNotification(tx, "cari.pasife-alindi", subject("customer", customerId), f, { actorUserId: who(actor) });
}

async function itemFacts(tx: Tx, itemId: string): Promise<{ urunId: string; urunAd: string; urunKodu: string } | null> {
  const i = await tx.item.findUnique({ where: { id: itemId }, select: { name: true, code: true } });
  return i ? { urunId: itemId, urunAd: i.name, urunKodu: i.code } : null;
}

/** `anaveri.urun-olusturuldu` — yeni ürün kartının doğuş tx'i (`ItemService.create`; diriltme bir geçiştir, yaymaz). */
export async function emitItemCreatedTx(tx: Tx, itemId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await itemFacts(tx, itemId);
  if (!f) return;
  await emitNotification(tx, "anaveri.urun-olusturuldu", subject("item", itemId), f, { actorUserId: who(actor) });
}

/** `anaveri.urun-pasif` — yaşam döngüsünün tek yazarı, ARCHIVED claim'i (`transitionItemLifecycleTx`). */
export async function emitItemArchivedTx(tx: Tx, itemId: string, reason: string | null | undefined, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await itemFacts(tx, itemId);
  if (!f) return;
  await emitNotification(tx, "anaveri.urun-pasif", subject("item", itemId), { ...f, sebep: txt(reason) }, { actorUserId: who(actor) });
}
