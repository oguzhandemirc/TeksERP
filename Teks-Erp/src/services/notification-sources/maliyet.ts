// =============================================================================
// MALİYET · FİYAT LİSTESİ OLAYLARI — S4 (geniş katalog 2026-11-14)
// =============================================================================
// Tek yayma noktaları; çağıranlar sürümü/yayını yazan tx'in İÇİNDEN, claim'den SONRA çağırır. Maliyet modellerine
// dokunur → yalnız maliyet kapılı zincirden import edilir (`test_maliyet_regime_gate`). Yük TUTAR taşımaz (birim
// maliyet, liste fiyatı yok) — rakam ilgili ekranda.
// =============================================================================
import type { Prisma } from "@prisma/client";
import { emitNotification, type EmitDb } from "../helpers/notification-emit.helper";
import { off, who, type Actor } from "./satis";

type Tx = EmitDb & Prisma.TransactionClient;
const txt = (s: string | null | undefined, max = 120): string => (s?.trim() ? s.trim().slice(0, max) : "—");

/** `maliyet.standart-degisti` — yeni ACTIVE standart maliyet sürümü (`standard-cost.service.ts#writeVersion`). */
export async function emitStandardCostVersionTx(tx: Tx, versionId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const v = await tx.standardCostVersion.findUnique({
    where: { id: versionId },
    select: { itemId: true, versionNo: true, reason: true, item: { select: { name: true } } },
  });
  if (!v) return;
  await emitNotification(tx, "maliyet.standart-degisti", { type: "item", id: v.itemId, key: v.itemId }, {
    urunId: v.itemId, urunAd: v.item.name, surumNo: v.versionNo, gerekce: txt(v.reason),
  }, { actorUserId: who(actor) });
}

/** `maliyet.fiyat-listesi-yayinlandi` — DRAFT→PUBLISHED claim'i (`price-list.service.ts#publishPriceList`). */
export async function emitPriceListPublishedTx(tx: Tx, listId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const l = await tx.priceList.findUnique({ where: { id: listId }, select: { listNo: true, name: true, customer: { select: { name: true } } } });
  if (!l) return;
  await emitNotification(tx, "maliyet.fiyat-listesi-yayinlandi", { type: "price_list", id: listId, key: listId }, {
    listeId: listId, listeNo: l.listNo, listeAd: l.name, musteriAd: l.customer?.name ?? "genel",
  }, { actorUserId: who(actor) });
}
