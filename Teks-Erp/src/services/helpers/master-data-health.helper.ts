// =============================================================================
// ANA VERİ ARŞİV SAĞLIĞI — "Pasif kayıtta canlı referans" sayacı (URUN-YASAM-DONGUSU §10)
// =============================================================================
// Kapılar (uygulama + ürün için DB seddi) D1'i yeni yazımda tutar; bu sayaç kapının
// GÖREMEDİĞİNİ ölçer: kapıdan önce doğmuş satır, ana verideki en iyi çaba kilidinin
// kaçırdığı yarış, kapalıdan açığa dönen siparişin kalemi. Beklenen 0. Yüklemler kapılarla
// AYNI kaynaktan (`countItemLiveRefs`, `ArchiveSpec.live`) — ikinci tanım yok.
// Sağlık ucu 5 sn'de bir sorulur: ölçüm TTL'li önbellekten döner (bayat + arkada tazeler);
// hiç ölçülmediyse `null` = ÖLÇÜLEMEDİ (0 ile karıştırılmaz).
// =============================================================================
import { ItemLifecycleStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { countItemLiveRefs, totalLiveRefs } from "./item-lifecycle.helper";
import type { ArchiveEntity, ArchiveSpec } from "./master-data-archive.helper";
import { COLOR_ARCHIVE } from "./archive-gate/color-archive.helper";
import { CUSTOMER_ARCHIVE } from "./archive-gate/customer-archive.helper";
import { FABRIC_PROPERTY_ARCHIVE } from "./archive-gate/fabric-property-archive.helper";
import { SUBCONTRACTOR_ARCHIVE } from "./archive-gate/subcontractor-archive.helper";
import { WAREHOUSE_ARCHIVE } from "./archive-gate/warehouse-archive.helper";

export const MASTER_DATA_HEALTH_TTL_MS = 10 * 60_000;

const SPECS: ArchiveSpec[] = [COLOR_ARCHIVE, FABRIC_PROPERTY_ARCHIVE, CUSTOMER_ARCHIVE, WAREHOUSE_ARCHIVE, SUBCONTRACTOR_ARCHIVE];

export interface MasterDataArchiveHealth {
  measuredAt: string;
  /** Pasif (arşivlenmiş) kayıtlardan canlı referansı OLANLARIN sayısı, varlık başına. Beklenen 0. */
  archivedWithLiveRefs: Record<"item" | ArchiveEntity, number>;
  total: number;
  /** Tükenene kadar kartlar: kaçında hâlâ canlı kayıt var, kaçı Pasife hazır. */
  phaseOut: { cards: number; withLiveRefs: number; readyToArchive: number };
}

async function specLiveTotal(spec: ArchiveSpec, id: string): Promise<number> {
  let total = 0;
  for (const k of spec.live) total += await k.count(prisma, id);
  return total;
}

async function itemsWithLiveRefs(status: ItemLifecycleStatus): Promise<{ cards: number; withLive: number }> {
  const rows = await prisma.item.findMany({ where: { lifecycleStatus: status }, select: { id: true } });
  let withLive = 0;
  for (const r of rows) if (totalLiveRefs(await countItemLiveRefs(prisma, r.id)) > 0) withLive++;
  return { cards: rows.length, withLive };
}

/** Tam ölçüm — sıralı (tek bağlantı), sağlık ucu bunu önbellekten okur. */
export async function measureMasterDataArchiveHealth(): Promise<MasterDataArchiveHealth> {
  const archivedItems = await itemsWithLiveRefs(ItemLifecycleStatus.ARCHIVED);
  const phaseOut = await itemsWithLiveRefs(ItemLifecycleStatus.PHASE_OUT);
  const counts: Record<"item" | ArchiveEntity, number> = {
    item: archivedItems.withLive, color: 0, fabricProperty: 0, customer: 0, warehouse: 0, subcontractor: 0,
  };
  for (const spec of SPECS) {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "${spec.table}" WHERE "isActive" = false`);
    for (const r of rows) if ((await specLiveTotal(spec, r.id)) > 0) counts[spec.entity]++;
  }
  return {
    measuredAt: new Date().toISOString(),
    archivedWithLiveRefs: counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    phaseOut: { cards: phaseOut.cards, withLiveRefs: phaseOut.withLive, readyToArchive: phaseOut.cards - phaseOut.withLive },
  };
}

let cache: { value: MasterDataArchiveHealth; at: number } | null = null;
let inflight: Promise<void> | null = null;

function refreshInBackground(): void {
  if (inflight) return;
  inflight = measureMasterDataArchiveHealth()
    .then((value) => {
      cache = { value, at: Date.now() };
    })
    // Ölçüm düşerse önbellek eski değerini korur (bayat işaretli); hiç yoksa null kalır.
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
}

/** Sağlık ucu: önbellekteki ölçüm (bayatsa arkada tazelenir); hiç ölçülmediyse `null` + ölçüm başlar. */
export function masterDataArchiveHealthSnapshot(): (MasterDataArchiveHealth & { stale: boolean }) | null {
  const age = cache ? Date.now() - cache.at : Infinity;
  if (age > MASTER_DATA_HEALTH_TTL_MS) refreshInBackground();
  return cache ? { ...cache.value, stale: age > MASTER_DATA_HEALTH_TTL_MS } : null;
}
