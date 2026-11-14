// =============================================================================
// KURŞUN GRAM FİYATI OLAYI — S4 (geniş katalog 2026-11-14)
// =============================================================================
// Tek yayma noktası. Çağıranlar fiyat kolonunu + sürüm satırını yazan tx'in İÇİNDEN, `recordKursunGramPriceVersionTx`
// `true` döndüğünde (değer gerçekten değişti) çağırır. Ayrı dosya: istasyon router'ı da çağırır → finans modeli
// OKUNMAZ; cari sahibinin adını çağıran (cari servisi) verir. Yük fiyatı TAŞIMAZ (tutar yasağı), yalnız "değişti/kaldırıldı".
// =============================================================================
import type { Prisma } from "@prisma/client";
import { emitNotification, type EmitDb } from "../helpers/notification-emit.helper";
import { off, who, type Actor } from "./satis";

type Tx = EmitDb & Prisma.TransactionClient;
export type KursunPriceOwnerRef = { kind: "station"; id: string } | { kind: "cari"; id: string; name: string };

/** `maliyet.kursun-fiyat-degisti` — istasyon (`kursun-station.service.ts`) ya da cari (`cari.service.ts#update`) fiyatı. */
export async function emitKursunGramPriceChangedTx(tx: Tx, owner: KursunPriceOwnerRef, cleared: boolean, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  let sahipAd: string;
  if (owner.kind === "station") {
    const s = await tx.station.findUnique({ where: { id: owner.id }, select: { name: true } });
    if (!s) return;
    sahipAd = s.name;
  } else {
    sahipAd = owner.name;
  }
  await emitNotification(tx, "maliyet.kursun-fiyat-degisti", { type: owner.kind, id: owner.id, key: owner.id }, {
    sahipId: owner.id, sahipTuru: owner.kind === "station" ? "istasyonu" : "carisi", sahipAd,
    islem: cleared ? "kaldırdı" : "değiştirdi",
  }, { actorUserId: who(actor) });
}
