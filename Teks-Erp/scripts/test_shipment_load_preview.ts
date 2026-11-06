// =============================================================================
// BEKÇİ — SEVK ÖNCESİ YÜK ÖNİZLEMESİ (9.1) + YÜKE BAĞLI TOPUN "SEVKE HAZIR" SAYISINDAN DÜŞMESİ
// =============================================================================
// Çalıştırma: npx tsx scripts/test_shipment_load_preview.ts
//
// NEDEN: Gülkesim'de sipariş yok; mal boyahane kağıdıyla (gelen belge) gelir, iş emri olur. Sevkten önce sorulan
// "bu yükte hangi İE'nin kaç topu var, geride top kaldı mı, karışık müşteri var mı" — salt-okur, engellemez.
// Aynı fikstürle: çuvala/sevkiyata girmiş hazır top "sevke hazır N top" sayısına GİRMEZ (ikinci kez sevke
// konmasın) ama hazırlık DURUMUNDA bitmiş sayılır (`loadedRollSql` tek yüklem).
//
// ÖLÇÜLENLER:
//   §1 Önizleme (top seçimi): İE grupları N/M, eksik + "hâlâ işlemde", kaynak belge no, İE'siz top, toplam metre
//   §2 ⭐ Karışık müşteri uyarısı · tek sahip ≠ sevkiyat müşterisi uyarısı · tek sahip = müşteri → uyarı yok
//   §3 Önizleme (sevkiyat): sevkiyatın canlı topları; çözülmüş birimin topu yok · sorgu sayısı sabit (N+1 yok)
//   §4 ⭐ Sevke hazır: yüke bağlı top readyCount'tan düşer, loadedCount'a geçer; durum değişmez; hepsi yüklüyse liste dışı
//   §5 Yüklem ikizi: `loadedRollSql` ↔ `isRollLoaded` dört kombinasyonda aynı; ready-works SQL'i yüklemi kullanır
// =============================================================================
import { readFileSync } from "node:fs";
import { Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { shippingService } from "../src/services/shipping.service";
import { InventoryService } from "../src/services/inventory.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { computeReadyWorks } from "../src/services/ready-works.service";
import { buildShipmentLoadPreview } from "../src/services/helpers/shipment-load-preview.helper";
import { isRollLoaded, loadedRollSql } from "../src/services/helpers/ship-readiness.helper";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const inventory = new InventoryService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TAG = `TEST-SLP-${Date.now()}`;
const rollIds: string[] = [];
const shipmentIds: string[] = [];
const customerIds: string[] = [];
const woIds: string[] = [];
const noteIds: string[] = [];
let itemId: string | null = null;
const savedSettings = new Map<string, Prisma.JsonValue | null>();

async function setSetting(key: string, value: boolean): Promise<void> {
  if (!savedSettings.has(key)) {
    const old = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
    savedSettings.set(key, old ? (old.value as Prisma.JsonValue) : null);
  }
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

async function makeRoll(qty: number, opts: { batchId?: string; owner?: string; status?: RollStatus } = {}): Promise<string> {
  const res = await inventory.createInitialEntry({ itemId: itemId!, initialQty: qty }, undefined, undefined, false, { forcedStatus: RollStatus.WAREHOUSE });
  const id = (res.data as { id: string }).id;
  rollIds.push(id);
  await prisma.roll.update({
    where: { id },
    data: { batchId: opts.batchId ?? null, ownerCustomerId: opts.owner ?? null, ...(opts.status ? { status: opts.status } : {}) },
  });
  return id;
}

async function workOrder(no: string): Promise<{ woId: string; batchId: string }> {
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-${no}`, targetItemId: itemId! }, select: { id: true } });
  woIds.push(wo.id);
  const b = await prisma.batch.create({ data: { batchNumber: `${TAG}-${no}-B`, workOrderId: wo.id }, select: { id: true } });
  return { woId: wo.id, batchId: b.id };
}

async function main(): Promise<void> {
  console.log("=== Sevk öncesi yük önizlemesi + yüke bağlı hazır sayımı bekçisi ===\n");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  await ensureDefaultWarehouse();
  const mk = async (s: string) => {
    const c = await prisma.customer.create({ data: { code: `${TAG}-${s}`, name: `${TAG} ${s}` }, select: { id: true } });
    customerIds.push(c.id);
    return c.id;
  };
  const custA = await mk("A");
  const custB = await mk("B");
  itemId = (await prisma.item.create({ data: { code: `${TAG}-ITM`, name: `${TAG} kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  await setSetting(SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED, true);
  await setSetting(SETTING_KEYS.SHIPMENT_LOOSE_LOAD_ENABLED, true);

  // İE-1 (A): 4 top — 2 hazır (yüke girecek), 1 hazır rafta, 1 işlemde. Kaynak gelen belge İE-1'in topları.
  const w1 = await workOrder("IE1");
  const r1 = [await makeRoll(100, { batchId: w1.batchId, owner: custA }), await makeRoll(80, { batchId: w1.batchId, owner: custA })];
  const r1rest = await makeRoll(50, { batchId: w1.batchId, owner: custA });
  const r1proc = await makeRoll(70, { batchId: w1.batchId, owner: custA, status: RollStatus.IN_PRODUCTION });
  const note = await prisma.customerDeliveryNote.create({
    data: {
      noteNo: `${TAG}-GB`.slice(0, 32), status: "APPROVED", sourceKind: "MANUAL", ownerCustomerId: custA, senderDocNo: "BOYA-778",
      lines: { create: [...r1, r1rest, r1proc].map((rollId, i) => ({ lineNo: i + 1, meters: 100, rollId, status: "ENTERED" as const })) },
    },
    select: { id: true, noteNo: true },
  });
  noteIds.push(note.id);
  // İE-2 (B): 2 top, ikisi de yükte (tam).
  const w2 = await workOrder("IE2");
  const r2 = [await makeRoll(40, { batchId: w2.batchId, owner: custB }), await makeRoll(45, { batchId: w2.batchId, owner: custB })];
  const loose = await makeRoll(10, { owner: custA }); // İE'siz top

  // ── §1 ÖNİZLEME (top seçimi) ─────────────────────────────────────────────
  const p1 = await buildShipmentLoadPreview({ rollIds: [...r1, ...r2, loose], customerId: custA });
  const g1 = p1.workOrders.find((w) => w.workOrderId === w1.woId);
  const g2 = p1.workOrders.find((w) => w.workOrderId === w2.woId);
  check("§1a İE-1: bu sevkte 2/4 top", g1?.inLoad === 2 && g1?.total === 4, `${g1?.inLoad}/${g1?.total}`);
  check("§1b İE-1: 2 top eksik, 1'i hâlâ işlemde", g1?.remaining === 2 && g1?.remainingInProcess === 1, `${g1?.remaining} · ${g1?.remainingInProcess}`);
  check("§1c ⭐ Kaynak boyahane belgesi no taşınır", g1?.sourceDocs.some((d) => d.noteNo === note.noteNo && d.senderDocNo === "BOYA-778") === true, JSON.stringify(g1?.sourceDocs));
  check("§1d İE-2 tam (2/2, eksik 0, uyarı yok)", g2?.inLoad === 2 && g2?.remaining === 0 && !p1.warnings.some((w) => w.includes(`${TAG}-IE2`)));
  check("§1e Eksik uyarısı metni: 'IE: bu sevkte 2/4 top — 2 top eksik (1 top hâlâ işlemde)'",
    p1.warnings.includes(`${TAG}-IE1: bu sevkte 2/4 top — 2 top eksik (1 top hâlâ işlemde)`), p1.warnings.join(" | "));
  check("§1f İE'siz top ayrı sayılır", p1.noWorkOrder.rollCount === 1 && p1.noWorkOrder.meters === 10);
  check("§1g Toplam top/metre (brüt)", p1.rollCount === 5 && p1.totalMeters === 275, `${p1.rollCount} · ${p1.totalMeters}`);

  // ── §2 MÜŞTERİ UYARILARI ─────────────────────────────────────────────────
  check("§2a ⭐ Karışık müşteri uyarısı", p1.warnings.some((w) => w.startsWith("Farklı müşterilerin topları karışmış")), p1.warnings.join(" | "));
  const p2 = await buildShipmentLoadPreview({ rollIds: r2, customerId: custA });
  check("§2b ⭐ Tek sahip ≠ sevkiyat müşterisi → uyarı", p2.warnings.some((w) => w.includes("müşterisine ait — sevkiyat")), p2.warnings.join(" | "));
  const p3 = await buildShipmentLoadPreview({ rollIds: r2, customerId: custB });
  check("§2c Tek sahip = müşteri, İE tam → uyarı yok", p3.warnings.length === 0, p3.warnings.join(" | "));

  // ── §3 ÖNİZLEME (sevkiyat) + sorgu sayısı ────────────────────────────────
  const res = await shippingService.createShipmentFromRolls({
    rollIds: r1, customerId: custA, clientToken: crypto.randomUUID(), loadUnits: [{ kind: "BULK", rollIds: r1 }] as never,
  });
  const shipId = (res.data as { id: string }).id;
  shipmentIds.push(shipId);
  const viaApi = await shippingService.previewShipmentLoad({ shipmentId: shipId, customerId: custA });
  const s1 = viaApi.data.workOrders.find((w) => w.workOrderId === w1.woId);
  check("§3a Sevkiyat önizlemesi: İE-1 2/4, uyarı ApiResponse.warnings'te", s1?.inLoad === 2 && (viaApi.warnings?.length ?? 0) > 0);
  await shippingService.removeRollFromLoadUnit(shipId, r1[1]!);
  const afterRm = await buildShipmentLoadPreview({ shipmentId: shipId });
  check("§3b Çıkarılan top önizlemeden düşer (1/4)", afterRm.workOrders.find((w) => w.workOrderId === w1.woId)?.inLoad === 1);
  // Sabit sorgu sayısı: helper'ın sorguları kaynak koddan sayılır (her İE başına sorgu YOK — döngüde await yok).
  const src = readFileSync("src/services/helpers/shipment-load-preview.helper.ts", "utf8");
  const awaits = (src.match(/await prisma\./g) ?? []).length;
  const loopAwait = /for \([^)]*\)\s*\{[^}]*await /s.test(src);
  check("§3c ⭐ Önizleme sabit sorgu (≤3 prisma çağrısı, döngüde await yok — N+1 yok)", awaits <= 3 && !loopAwait, `${awaits} çağrı`);

  // ── §4 SEVKE HAZIR: yüke bağlı top sayıdan düşer ────────────────────────
  // Sevkiyatta: r1[0] (dökme). Rafta hazır: r1[1] (çıkarıldı), r1rest. İşlemde: r1proc.
  const policy = { rule: "ALL_DONE" as const, tolerancePct: 0 };
  const [row1] = await computeReadyWorks("workOrder", policy, [w1.woId]);
  check("§4a ⭐ İE-1 readyCount yalnız serbest hazır toplar (2), loadedCount 1", row1?.readyCount === 2 && row1?.loadedCount === 1, `${row1?.readyCount}/${row1?.loadedCount}`);
  check("§4b Durum değişmedi: işlemde top var → PARTIAL", row1?.state === "PARTIAL");
  await prisma.roll.update({ where: { id: r1proc }, data: { status: RollStatus.WAREHOUSE } });
  const [row1b] = await computeReadyWorks("workOrder", policy, [w1.woId]);
  check("§4c Yüklü top durumda bitmiş sayılır: hepsi bitti → READY (hazır 3, yüklü 1)", row1b?.state === "READY" && row1b.readyCount === 3 && row1b.loadedCount === 1, `${row1b?.state} ${row1b?.readyCount}/${row1b?.loadedCount}`);
  await shippingService.addLooseRollsToShipment(shipId, { kind: "BULK", rollIds: [r1[1]!, r1rest, r1proc] });
  const gone = await computeReadyWorks("workOrder", policy, [w1.woId]);
  check("§4d ⭐ Bütün hazır toplar yükte → iş 'sevke hazır' listesinden düşer", gone.length === 0, JSON.stringify(gone.map((g) => [g.readyCount, g.loadedCount])));
  const sack = (await shippingService.openSack({ customerId: custB })).data as { id: string };
  const bc = (await prisma.roll.findUniqueOrThrow({ where: { id: r2[0]! }, select: { barcode: true } })).barcode!;
  await shippingService.scanIntoSack({ sackId: sack.id, barcode: bc });
  const [row2] = await computeReadyWorks("workOrder", policy, [w2.woId]);
  check("§4e Havuz çuvalındaki top da yüke bağlıdır (hazır 1, yüklü 1)", row2?.readyCount === 1 && row2?.loadedCount === 1, `${row2?.readyCount}/${row2?.loadedCount}`);
  const [cust] = await computeReadyWorks("customer", policy, [custB]);
  check("§4f Müşteri biriminde de aynı ayrım", cust?.readyCount === 1 && cust?.loadedCount === 1);

  // ── §5 YÜKLEM İKİZİ ──────────────────────────────────────────────────────
  const combos = [[null, null], ["x", null], [null, "y"], ["x", "y"]] as const;
  const rows = await prisma.$queryRaw<{ i: number; loaded: boolean }[]>(Prisma.sql`
    SELECT r.i, ${loadedRollSql("r")} AS loaded FROM (VALUES ${Prisma.join(combos.map(([a, b], i) => Prisma.sql`(${i}::int, ${a}::text, ${b}::text)`))}) AS r(i, "sackId", "shipmentId")`);
  const same = rows.every((r) => r.loaded === isRollLoaded({ sackId: combos[r.i]![0], shipmentId: combos[r.i]![1] }));
  check("§5a loadedRollSql ↔ isRollLoaded dört kombinasyonda aynı", rows.length === 4 && same);
  const sqlSrc = readFileSync("src/services/helpers/ready-works-sql.helper.ts", "utf8");
  check("§5b Sevke hazır toplamı tek yüklemi kullanır (elle sackId/shipmentId koşulu yok)", /loadedRollSql\("r"\)/.test(sqlSrc) && !/"sackId" IS (NOT )?NULL/.test(sqlSrc));
}

main()
  .catch((e) => {
    fail++;
    console.error("❌ Beklenmeyen hata:", e);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    for (const [key, value] of savedSettings) {
      if (value === null) await prisma.systemSetting.deleteMany({ where: { key } }).catch(() => {});
      else await prisma.systemSetting.update({ where: { key }, data: { value: value as Prisma.InputJsonValue } }).catch(() => {});
    }
    const sids = [...new Set(shipmentIds)];
    const sackIds = (await prisma.sack.findMany({ where: { OR: [{ customerId: { in: customerIds } }, { shipmentId: { in: sids } }] }, select: { id: true } })).map((s) => s.id);
    await prisma.sackWeighing.deleteMany({ where: { sackId: { in: sackIds } } }).catch(() => {});
    await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } }).catch(() => {}); // fikstür temizliği
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: sids } } }).catch(() => {});
    await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: sids } } }).catch(() => {});
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: sids } } }).catch(() => {});
    await prisma.customerDeliveryNoteLine.deleteMany({ where: { noteId: { in: noteIds } } }).catch(() => {});
    await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: noteIds } } }).catch(() => {});
    if (rollIds.length > 0) {
      await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null, batchId: null } }).catch(() => {});
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch((e) => console.error("temizlik roll:", (e as Error).message));
    }
    await prisma.sack.deleteMany({ where: { id: { in: sackIds } } }).catch((e) => console.error("temizlik sack:", (e as Error).message));
    await prisma.shipment.deleteMany({ where: { id: { in: sids } } }).catch((e) => console.error("temizlik shipment:", (e as Error).message));
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } }).catch((e) => console.error("temizlik batch:", (e as Error).message));
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch((e) => console.error("temizlik wo:", (e as Error).message));
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } }).catch(() => {});
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
