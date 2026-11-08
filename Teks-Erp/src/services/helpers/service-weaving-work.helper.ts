// =============================================================================
// DOKUMA HİZMET İŞLERİ — müşteri ipliğiyle dokunan top (genel fason F4, PLAN-genel-fason §4a)
// =============================================================================
// Soru: "bu (emanet) topların hangisi bizim dokumamızdan doğdu, hangi hizmet kartıyla, kaç metre?"
// Öznesi DOĞAN TOPTUR (ROLL; ayrı dokuma öznesi yok): top → dokuma işi yalnız `weavingOrdersOfRolls`
// (`weaving-order-of-roll.helper`, tekil okuyucuyla aynı zincir). Dokuma rotada adım değildir
// (`NON_ROUTABLE_STATION_KINDS`) ⇒ F3 adım işiyle çakışmaz; adım kimliği NULL.
// Hizmet kartı yalnız `service_item_processes`ten (süreç türü → kart, F3 ile tek kaynak): indirme yolunda
// tezgahın istasyonunun varsayılan süreç türü; tezgahı bilinmeyen topta (makbuz / KK1 iş seçimi) eşlenmiş
// TEK dokuma istasyonu türü — birden çok ya da hiç yoksa iş girmez, sayılır (çağıran uyarır, sessiz düşmez).
// Metre: doğuş metresi (`initialQty`, WOVEN); hizmet anı: topun doğuşu. Yalnız okur.
// =============================================================================
import { Prisma, StationKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { loadProcessMap } from "./service-step-work.helper";
import { weavingOrdersOfRolls } from "./weaving-order-of-roll.helper";
import type { ServiceRollWork } from "./service-pricing.helper";

type Db = Prisma.TransactionClient | typeof prisma;

export interface ProcessHit {
  categoryId: string;
  categoryName: string;
  serviceItemId: string;
}

export interface WeavingWork {
  rollId: string;
  serviceItemId: string;
  categoryName: string;
  meters: Prisma.Decimal;
  serviceAt: Date;
}

export interface WeavingWorkList {
  works: WeavingWork[];
  /** Süreç türü hizmet kartına eşlenmemiş (ya da tezgahsız topta belirsiz) dokuma işleri — çağıran uyarır. */
  unmappedCount: number;
  /** Doğuş metresi 0 olan dokuma işleri — çağıran uyarır. */
  zeroMeterCount: number;
}

/** Makine → istasyonunun süreç türü → hizmet kartı (`service_item_processes`). Eşlenmemiş makine haritada YOK. */
export async function processOfMachines(db: Db, machineIds: string[], processMap: Map<string, { serviceItemId: string; name: string }>): Promise<Map<string, ProcessHit>> {
  const out = new Map<string, ProcessHit>();
  if (machineIds.length === 0 || processMap.size === 0) return out;
  const machines = await db.machine.findMany({ where: { id: { in: machineIds } }, select: { id: true, station: { select: { defaultCategoryId: true } } } });
  for (const m of machines) {
    const categoryId = m.station.defaultCategoryId;
    const hit = categoryId ? processMap.get(categoryId) : undefined;
    if (categoryId && hit) out.set(m.id, { categoryId, categoryName: hit.name, serviceItemId: hit.serviceItemId });
  }
  return out;
}

/** Tezgahı bilinmeyen dokuma topu: eşlenmiş dokuma istasyonu türü TEKSE o; değilse null (belirsiz → iş girmez). */
async function soleWeavingProcess(db: Db, processMap: Map<string, { serviceItemId: string; name: string }>): Promise<ProcessHit | null> {
  const stations = await db.station.findMany({ where: { kind: StationKind.WEAVING, defaultCategoryId: { not: null } }, select: { defaultCategoryId: true } });
  const mapped = [...new Set(stations.map((s) => s.defaultCategoryId!).filter((c) => processMap.has(c)))];
  if (mapped.length !== 1) return null;
  const hit = processMap.get(mapped[0]!)!;
  return { categoryId: mapped[0]!, categoryName: hit.name, serviceItemId: hit.serviceItemId };
}

/** Verilen toplardan (ata zinciri çağırandan) dokumadan doğanların hizmet işleri. */
export async function listWeavingServiceWorks(rollIds: string[], opts: { db?: Db } = {}): Promise<WeavingWorkList> {
  const db = opts.db ?? prisma;
  const none: WeavingWorkList = { works: [], unmappedCount: 0, zeroMeterCount: 0 };
  if (rollIds.length === 0) return none;
  const born = await weavingOrdersOfRolls(db, rollIds);
  if (born.size === 0) return none;
  const processMap = await loadProcessMap(db);
  const byMachine = await processOfMachines(db, [...new Set([...born.values()].map((b) => b.machineId).filter((v): v is string => v !== null))], processMap);
  const needsSole = [...born.values()].some((b) => b.machineId === null);
  const sole = needsSole && processMap.size > 0 ? await soleWeavingProcess(db, processMap) : null;
  const rolls = await db.roll.findMany({ where: { id: { in: [...born.keys()] } }, select: { id: true, initialQty: true, createdAt: true }, orderBy: { id: "asc" } });
  const out: WeavingWorkList = { works: [], unmappedCount: 0, zeroMeterCount: 0 };
  for (const r of rolls) {
    const b = born.get(r.id)!;
    const proc = b.machineId ? byMachine.get(b.machineId) ?? null : sole;
    if (!proc) { out.unmappedCount++; continue; }
    if (r.initialQty.lte(0)) { out.zeroMeterCount++; continue; }
    out.works.push({ rollId: r.id, serviceItemId: proc.serviceItemId, categoryName: proc.categoryName, meters: r.initialQty, serviceAt: r.createdAt });
  }
  return out;
}

/** F4 uyarı metinleri — bekçi aynı cümleyi arar. */
export function weavingUnmappedWarning(count: number): string {
  return `${count} dokuma işinin süreç türü hizmet kartına eşlenmemiş (ya da tezgahsız topta belirsiz) — faturaya alınmadı.`;
}
export function weavingZeroMeterWarning(count: number): string {
  return `${count} dokuma işinin doğuş metresi 0 — faturaya alınmadı, topu kontrol edin.`;
}

/** Çözücü girdisi (adımsız, WOVEN); aynı top × kart başka kaynaktan iş verdiyse (bağ anahtarı `keyOf`) dokuma işi yazılmaz. */
export async function loadWeavingRollWorks(
  rollIds: string[],
  ctx: { keyOf: (w: ServiceRollWork) => string; claimed: ServiceRollWork[]; db: Db; warnings: string[] },
): Promise<ServiceRollWork[]> {
  const list = await listWeavingServiceWorks(rollIds, { db: ctx.db });
  if (list.unmappedCount > 0) ctx.warnings.push(weavingUnmappedWarning(list.unmappedCount));
  if (list.zeroMeterCount > 0) ctx.warnings.push(weavingZeroMeterWarning(list.zeroMeterCount));
  const taken = new Set(ctx.claimed.map(ctx.keyOf));
  return list.works
    .map((w): ServiceRollWork => ({
      rollId: w.rollId, workOrderStepId: null, source: "WEAVING", valueId: null, valueName: w.categoryName, gramajFrom: "NONE",
      serviceItemId: w.serviceItemId, meters: w.meters, meterBasis: "WOVEN", readingId: null, serviceAt: w.serviceAt, unitPrice: null,
      qtyUnit: "METER", quantity: w.meters,
    }))
    .filter((w) => !taken.has(ctx.keyOf(w)));
}
