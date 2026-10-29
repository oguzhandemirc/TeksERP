// İçerideki İşler → Kumaş Stoğu derin bağlantısı (saf). Kova ↔ Envanter sekmesi eşlemesi backend kova tanımının
// aynasıdır (waiting = adımsız STOCK, inProcess = adımda, ready = WAREHOUSE/A1_STOCK); "other"ın sekmesi yok.
import type { ConsignedOwnerRow } from "./service";

export type ConsignedBucketKey = "waiting" | "inProcess" | "ready";

export const BUCKET_TAB: Record<ConsignedBucketKey, "RAW_STOCK" | "PRODUCTION" | "FINISHED_STOCK"> = {
  waiting: "RAW_STOCK",
  inProcess: "PRODUCTION",
  ready: "FINISHED_STOCK",
};

/** Sahibin süzgeciyle top listesi. Fire kaliteli emanet top da içeride sayılır ⇒ `includeFire` liste ile özet aynı kalsın diye. */
export function rollsLinkFor(ownerCustomerId: string, bucket: ConsignedBucketKey): string {
  const sp = new URLSearchParams();
  sp.set("tab", BUCKET_TAB[bucket]);
  sp.set("filter[ownerCustomerId]", ownerCustomerId);
  sp.set("filter[includeFire]", "true");
  return `/operations/rolls?${sp.toString()}`;
}

/** Satır tıklaması: en çok topu olan kovanın sekmesi (eşitlikte iş akışı sırası: işlemde → bekliyor → hazır). */
export function primaryBucket(row: ConsignedOwnerRow): ConsignedBucketKey {
  const order: ConsignedBucketKey[] = ["inProcess", "waiting", "ready"];
  return order.reduce((best, k) => (row[k].count > row[best].count ? k : best), order[0]!);
}
