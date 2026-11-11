// =============================================================================
// DOKUMA İŞİ LİSTESİ — satır başına "şu an hangi tezgahta, ne kadar dokundu" (salt okuma, toplu)
// =============================================================================
// Tablet İş Emirleri › Dokuma listesi bu iki alanı satırda gösterir; genel bakış ucunun (`/:id/overview`)
// AYNI yüklemlerini sayfa kimlikleriyle TOPLU okur (satır başına sorgu yok): açık koşum `OPEN_RUN_WHERE`,
// işin top metresi `rollMetersByWeavingOrder` (`rollsOfWeavingOrderWhere`), fason kabulü `receivedMetersByWeavingOrder`. Üretilen metre
// panelin ilerleme çubuğuyla aynı seçimdir: fasonda dokunan iş kabul metresi, kendi tezgahımızdaki iş top metresi.
// =============================================================================
import type { WeavingExecutionKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { OPEN_RUN_WHERE } from "./weaving-order-input.helper";
import { receivedMetersByWeavingOrder, rollMetersByWeavingOrder } from "./weaving-order-of-roll.helper";

export interface WeavingListMachine { id: string; code: string; name: string }

export interface WeavingOrderListProgress {
  /** Açık koşumların tezgahları (başlangıca göre, tekrarsız); koşum yoksa boş dizi. */
  openRunMachines: WeavingListMachine[];
  /** Üretilen metre — fason: kabul (yoksa 0, genel bakışla aynı); kendi tezgah: doğan top Σ ilk metre, top yoksa null. */
  producedM: number | null;
}

/**
 * ÜRETİLEN metre seçimi (TEK kaynak; liste + genel bakış): fasonda kabul (yoksa 0), kendi tezgahımızda doğan top
 * metresi (top yoksa null). Koşum ve TEZGAHTA (türetilen) metresi hiçbir zaman girmez (dokuma.md).
 */
export function weavingProducedM(kind: WeavingExecutionKind, fasonReceivedM: number | null, rollMeters: number | null): number | null {
  return kind === "SUBCONTRACTED" ? (fasonReceivedM ?? 0) : rollMeters;
}

/** Kalan = plannedM − ÜRETİLEN (top yoksa üretilen 0 sayılır: teslim edilen yok); sıfırın altına inmez; açık uçlu → null. */
export function weavingRemainingM(plannedM: number | null, producedM: number | null): number | null {
  if (plannedM === null) return null;
  return Math.max(0, Math.round((plannedM - (producedM ?? 0)) * 1000) / 1000);
}

/** Sayfadaki işler için ilerleme — iki/üç toplu sorgu; boş sayfada sorgu yok. */
export async function weavingOrderListProgress(
  orders: Array<{ id: string; executionKind: WeavingExecutionKind }>,
): Promise<Map<string, WeavingOrderListProgress>> {
  const out = new Map<string, WeavingOrderListProgress>();
  if (orders.length === 0) return out;
  const ids = orders.map((o) => o.id);
  const fasonIds = orders.filter((o) => o.executionKind === "SUBCONTRACTED").map((o) => o.id);

  const runs = await prisma.machineRun.findMany({
    where: { weavingOrderId: { in: ids }, ...OPEN_RUN_WHERE },
    select: { weavingOrderId: true, machine: { select: { id: true, code: true, name: true } } },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
  });
  const meters = await rollMetersByWeavingOrder(prisma, ids);
  const received = await receivedMetersByWeavingOrder(prisma, fasonIds);

  const machines = new Map<string, WeavingListMachine[]>();
  for (const r of runs) {
    if (!r.weavingOrderId) continue;
    const list = machines.get(r.weavingOrderId) ?? [];
    if (!list.some((m) => m.id === r.machine.id)) list.push(r.machine);
    machines.set(r.weavingOrderId, list);
  }
  for (const o of orders) {
    const m = meters.get(o.id);
    out.set(o.id, {
      openRunMachines: machines.get(o.id) ?? [],
      producedM: weavingProducedM(o.executionKind, received.get(o.id) ?? null, m ? Number(m) : null),
    });
  }
  return out;
}
