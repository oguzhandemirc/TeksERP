// =============================================================================
// İPLİK AYIRMA — TÜRETİLMİŞ (Seyitoğlu 3. bölüm I1, 2026-11-12; ayar `dokuma.yarnReservationEnabled`)
// =============================================================================
// "Açık dokuma işleri bitene kadar hangi iplikten kaç kg daha tüketecek?" Tablo YOK, defter YOK: her okumada
// açık (PLANNED/IN_PROGRESS) KENDİ tezgâh işlerinin kalan HAM metresi (`weavingRemainingM` — liste/genel bakışla
// aynı seçim) × kg/m (maliyet motorunun `yarnUsagePerM`i; iplik firesi dahil). Hazır levent havuzu ÖNCE işlere
// düşülür (aynı `yarnKgByYarn` çekirdeği); kalan havuz talebe kalır. ENGELLEMEZ, stok/defter yazmaz.
// Fason iş girmez (iplik sevkle stoktan çıkar). Yapısı eksik iş kg'a katılmaz, sayısı beyan edilir (0 uydurulmaz).
// Bu dosya yalnız `maliyet-bridge.helper` üzerinden DİNAMİK yüklenir (ayar kapalıyken dokuma tablosuna sorgu yok).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { buildCostInput, loadCostSourcesTx } from "./cost-assembler.helper";
import { yarnUsagePerM } from "./fabric-cost.helper";
import { rollMetersByWeavingOrder } from "./weaving-order-of-roll.helper";
import { weavingProducedM, weavingRemainingM } from "./weaving-order-list-progress.helper";
import { readyWarpSpecIds, yarnKgByYarn, type ReadyItem } from "../reports/yarn-need.report.service";
import type { YarnWasteSource } from "./yarn-waste.helper";

type Dec = Prisma.Decimal;
type Beams = Map<string, { remainingM: Dec; beamCount: number }>;

export interface YarnReservation {
  /** İplik → ayrılan kg (çözgü + atkı; hazır levent önce işlere düşülmüş). */
  reservedKg: Map<string, { kg: Dec; wasteSource: YarnWasteSource }>;
  /** Ürün → açık işlerin kalan ham metresi (yapısı tam işler). Talep bu kadar netlenir (çift sayım olmasın). */
  openRawMByItem: Map<string, Dec>;
  /** İşlere düşüldükten sonra kalan hazır levent havuzu; verilen havuz null ise null. */
  beamsAfter: Beams | null;
  /** Ayırmaya giren iş sayısı (kalanı > 0, yapısı tam). */
  orderCount: number;
  /** Yapısı eksik (kg/m hesaplanamayan) açık işler — kg'a katılmadı. */
  unmeasured: Array<{ weavingOrderId: string; weavingOrderNumber: string; missing: string[] }>;
}

/** `beamsFor`: işlerin çözgü kartları için hazır levent okuyucusu (devere kapalı → null döner). */
export async function computeYarnReservation(beamsFor: (warpSpecIds: string[]) => Promise<Beams | null>): Promise<YarnReservation> {
  const orders = await prisma.weavingOrder.findMany({
    where: { status: { in: ["PLANNED", "IN_PROGRESS"] }, executionKind: "IN_HOUSE", plannedM: { not: null } },
    select: { id: true, weavingOrderNumber: true, itemId: true, recipeId: true, plannedM: true, executionKind: true },
    orderBy: [{ weavingOrderNumber: "asc" }],
  });
  const empty: YarnReservation = { reservedKg: new Map(), openRawMByItem: new Map(), beamsAfter: null, orderCount: 0, unmeasured: [] };
  if (orders.length === 0) return { ...empty, beamsAfter: await beamsFor([]) };
  const produced = await rollMetersByWeavingOrder(prisma, orders.map((o) => o.id));
  const src = await loadCostSourcesTx(prisma as unknown as Prisma.TransactionClient, [...new Set(orders.map((o) => o.itemId))].sort(), [],
    [...new Set(orders.map((o) => o.recipeId).filter((x): x is string => !!x))]);
  const ready: ReadyItem[] = [];
  const unmeasured: YarnReservation["unmeasured"] = [];
  const openRawMByItem = new Map<string, Dec>();
  for (const o of orders) {
    const m = produced.get(o.id);
    const remaining = weavingRemainingM(Number(o.plannedM), weavingProducedM(o.executionKind, null, m ? Number(m) : null));
    if (remaining === null || remaining <= 0) continue;
    const item = src.items.get(o.itemId);
    if (!item || item.itemType !== "FABRIC") continue;
    const input = buildCostInput(src, o.recipeId ? { itemId: o.itemId, recipeId: o.recipeId } : { itemId: o.itemId });
    const usage = yarnUsagePerM(input);
    if (usage.missing.length > 0 || !usage.warp) {
      unmeasured.push({ weavingOrderId: o.id, weavingOrderNumber: o.weavingOrderNumber, missing: usage.missing });
      continue;
    }
    const rawM = new Prisma.Decimal(remaining);
    openRawMByItem.set(o.itemId, (openRawMByItem.get(o.itemId) ?? new Prisma.Decimal(0)).plus(rawM));
    ready.push({ d: { itemId: o.itemId, lineCount: 0, meters: rawM }, code: o.weavingOrderNumber, input, usage, rawM });
  }
  const beams = await beamsFor(readyWarpSpecIds(ready));
  const { perYarn, poolAfter } = yarnKgByYarn(ready, beams);
  const reservedKg = new Map([...perYarn].map(([id, a]) => [id, { kg: a.warp.plus(a.weft), wasteSource: a.wasteSource }]));
  const beamsAfter = beams ? new Map([...beams].map(([id, b]) => [id, { remainingM: poolAfter.get(id) ?? b.remainingM, beamCount: b.beamCount }])) : null;
  return { reservedKg, openRawMByItem, beamsAfter, orderCount: ready.length, unmeasured };
}
