// =============================================================================
// Bekçi: TAMBUR ETİKET PARTİ NO — müşterinin etikete istediği parti (Gülkesim 2026-11-06)
// Çalıştır: npx tsx scripts/test_tambur_etiket_parti_no.ts   (DB'li, _test DB)
// =============================================================================
//   §1 cari ayarı `tamburLabelBatchEnabled`: varsayılan KAPALI, boolean dışı 400
//   §2 ayar KAPALI: değersiz kesim geçer (bugünkü) · değerli kesim 400 LABEL_BATCH_NOT_ENABLED, top düşmez
//   §3 ayar AÇIK: dört kesim yolu + segmentli finalize değeri (kırpılmış) çocuğa yazar; boş → null
//   §4 MİRAS YOK: değersiz ikinci kesim önceki değeri devralmaz (yapışkanlık istemcide)
//   §5 Kime? müşterisi sahibi ezer (ayar o müşteriden)
//   §6 düzeltme PATCH /rolls/:id/label motoru: değiştir · null temizle · undefined dokunma; labelDirty + audit
//   §7 Zod şemaları alanı TAŞIR (strip tuzağı) + 64 üstü red
//   §8 etiket: katalog ROLL_RAW+ROLL_FINISHED, fieldDisplayValue boşta present:false, varsayılan native
//      düzen "Parti: J1" basar ve bizim partiyi bastırır; label-settings görünümü labelBatchEnabled taşır
// Negatif sonda (ölçüldü 2026-11-06): cutWarehouseRollInner'da `labelBatchNo: cutLabelBatchNo` satırı
// silinince §3 depo topu kırmızı; resolveTamburLabelBatchNo'daki ayar kontrolü kaldırılınca §2 kırmızı.
// =============================================================================
import { RollStatus, StationKind, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { CustomerService } from "../src/services/customer.service";
import { TamburService } from "../src/services/tambur.service";
import { getTamburLabelSettings } from "../src/services/helpers/tambur-customer-settings.helper";
import { cutOpenFabricSchema, cutWarehouseRollSchema, finalizeOpenFabricSchema, finalizeSchema, finalizeWarehouseCutSchema } from "../src/controllers/tambur.controller";
import { InventoryService } from "../src/services/inventory.service";
import { fieldDisplayValue } from "../src/services/helpers/label-field-values";
import { rollTextLines } from "../src/services/helpers/native-label.shared";
import { FIELD_CATALOG } from "../src/config/label-fields";
import { mockPayload } from "../src/services/helpers/label-rawcode";
import type { LabelPayload } from "../src/types/label.types";
import { roleGrade } from "./fixture-quality-grade";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
async function errCode(p: Promise<unknown>): Promise<string> {
  try { await p; return "OK"; } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string } };
    return `${x.statusCode ?? "?"}:${x.details?.code ?? ""}`;
  }
}

const tambur = new TamburService();
const inventory = new InventoryService();
const customers = new CustomerService({
  modelName: "customer",
  tableName: "CUSTOMER",
  searchFields: ["name"],
  codeSearchFields: ["code", "taxNumber", "exportCode"],
  defaultInclude: undefined,
  uniqueField: "code",
  nestedCreateFields: ["branches"],
});
const ts = Date.now().toString().slice(-6);
const customerIds: string[] = [];
const parentIds: string[] = [];
const woIds: string[] = [];
let seq = 0;

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  const item = await prisma.item.findUnique({ where: { code: "PATOS" }, select: { id: true } });
  const color = await prisma.color.findUnique({ where: { code: "MAVI" }, select: { id: true } });
  const station = await prisma.station.findFirst({ where: { kind: StationKind.TAMBUR }, select: { id: true } });
  if (!item || !color || !station) throw new Error("fixture: PATOS ürünü/MAVI renk/TAMBUR istasyonu yok");
  const grade = await roleGrade("FIRST");
  const actor = { id: await testActorId() };

  const mk = async (tag: string) => {
    const c = await prisma.customer.create({ data: { code: `TEST-ETP-${tag}-${ts}`, name: `TEST Etiket Parti ${tag} ${ts}` }, select: { id: true } });
    customerIds.push(c.id);
    return c.id;
  };
  const owner = await mk("O");
  const target = await mk("K");

  const warehouseRoll = async (ownerCustomerId: string) => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TST-ETP-${seq++}-${ts}`, itemId: item.id, colorId: color.id, status: RollStatus.WAREHOUSE,
        currentQty: 100, initialQty: 100, width: 150, qualityGrade: grade.code, qualityGradeId: grade.id, ownerCustomerId,
      },
      select: { id: true },
    });
    parentIds.push(r.id);
    return r.id;
  };
  const openFabric = async (ownerCustomerId: string) => {
    const wo = await prisma.workOrder.create({
      data: {
        workOrderNumber: `TST-ETP-WO-${seq++}-${ts}`, type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS,
        width: 150, targetItemId: item.id, targetColorId: color.id,
        steps: { create: [{ stationId: station.id, stepSequence: 1, status: "ACTIVE" as const }] },
      },
      include: { steps: true },
    });
    woIds.push(wo.id);
    const r = await prisma.roll.create({
      data: {
        barcode: null, itemId: item.id, colorId: color.id, status: RollStatus.IN_PRODUCTION, currentQty: 100, initialQty: 100,
        width: 150, qualityGrade: grade.code, qualityGradeId: grade.id, currentStepId: wo.steps[0]!.id,
        entrySource: "SUBCONTRACTOR_RETURN", ownerCustomerId,
      },
      select: { id: true },
    });
    parentIds.push(r.id);
    return r.id;
  };
  const lbOf = async (id: string) => (await prisma.roll.findUnique({ where: { id }, select: { labelBatchNo: true } }))?.labelBatchNo ?? null;

  console.log("\n[§1] cari ayarı");
  let c = await prisma.customer.findUnique({ where: { id: owner }, select: { tamburLabelBatchEnabled: true } });
  check("§1 varsayılan KAPALI", c?.tamburLabelBatchEnabled === false);
  check("§1 metin → 400", (await errCode(customers.update(owner, { tamburLabelBatchEnabled: "evet" }, actor.id))).startsWith("400"));

  console.log("\n[§2] ayar kapalı (bugünkü)");
  const w1 = await warehouseRoll(owner);
  const r1 = await tambur.cutWarehouseRoll(w1, { cutLength: 10 }, actor.id);
  check("§2 değersiz kesim geçer, çocuk null", (await lbOf(r1.data!.childRoll.id)) === null);
  check("§2 değerli kesim → 400 LABEL_BATCH_NOT_ENABLED", (await errCode(tambur.cutWarehouseRoll(w1, { cutLength: 10, labelBatchNo: "J1" }, actor.id))) === "400:LABEL_BATCH_NOT_ENABLED");
  check("§2 ret sonrası top düşülmedi", Number((await prisma.roll.findUnique({ where: { id: w1 }, select: { currentQty: true } }))?.currentQty) === 90);
  check("§2 yalnız boşluk = değer yok → geçer", (await errCode(tambur.cutWarehouseRoll(w1, { cutLength: 10, labelBatchNo: "   " }, actor.id))) === "OK");

  console.log("\n[§3] ayar açık — beş yol");
  await customers.update(owner, { tamburLabelBatchEnabled: true }, actor.id);
  c = await prisma.customer.findUnique({ where: { id: owner }, select: { tamburLabelBatchEnabled: true } });
  check("§3 ayar yazıldı", c?.tamburLabelBatchEnabled === true);
  const w2 = await warehouseRoll(owner);
  const r2 = await tambur.cutWarehouseRoll(w2, { cutLength: 10, labelBatchNo: "  J1 " }, actor.id);
  check("§3 depo topu kesimi → 'J1' (kırpılmış)", (await lbOf(r2.data!.childRoll.id)) === "J1");
  const f1 = await tambur.finalizeWarehouseCut(w2, { remainingAction: "keep_1kalite", labelBatchNo: "K30" }, actor.id);
  check("§3 depo topu 'Bitir' kalanı → 'K30'", f1.data?.remainingChild != null && (await lbOf(f1.data.remainingChild.id)) === "K30");
  const o1 = await openFabric(owner);
  const r3 = await tambur.cutOpenFabric(o1, { lengthMeters: 10, status: "WAREHOUSE", labelBatchNo: "J1", confirmMismatch: true }, actor.id);
  check("§3 açık kumaş kesimi → 'J1'", (await lbOf(r3.data!.childRoll.id)) === "J1");

  console.log("\n[§4] miras yok");
  const r4 = await tambur.cutOpenFabric(o1, { lengthMeters: 10, status: "WAREHOUSE", confirmMismatch: true }, actor.id);
  check("§4 değersiz ikinci kesim null (önceki çocuktan/ebeveynden devralmaz)", (await lbOf(r4.data!.childRoll.id)) === null);
  const f2 = await tambur.finalizeOpenFabric(o1, { remainingAction: "keep_1kalite", confirmMismatch: true, labelBatchNo: "K30" }, actor.id);
  check("§3 açık kumaş 'Bitir' kalanı → 'K30'", f2.data?.remainingChildId != null && (await lbOf(f2.data.remainingChildId)) === "K30");
  const o2 = await openFabric(owner);
  const cut = { length: 10, qualityGrade: grade.code, relatedErrorIds: [] as string[] };
  const f3 = await tambur.finalize({ rollId: o2, decisions: [], cuts: [cut], labelBatchNo: "J2", confirmMismatch: true }, actor.id);
  const lbs = await Promise.all((f3.data?.splitRolls ?? []).map((r) => lbOf(r.id)));
  check("§3 segmentli finalize her parçaya 'J2'", lbs.length === 2 && lbs.every((x) => x === "J2"), JSON.stringify(lbs));

  console.log("\n[§5] Kime? müşterisi sahibi ezer");
  const w3 = await warehouseRoll(owner);
  check("§5 Kime?=ayarsız müşteri → değerli kesim 400", (await errCode(tambur.cutWarehouseRoll(w3, { cutLength: 10, targetCustomerId: target, labelBatchNo: "J1" }, actor.id))) === "400:LABEL_BATCH_NOT_ENABLED");
  const v = await getTamburLabelSettings({ rollId: w3 });
  check("§8 label-settings sahibin labelBatchEnabled=true", v.labelBatchEnabled === true);
  const v2 = await getTamburLabelSettings({ rollId: w3, customerId: target });
  check("§8 label-settings Kime? ayarsız → false", v2.labelBatchEnabled === false);

  console.log("\n[§6] düzeltme (PATCH /rolls/:id/label motoru)");
  const child = r2.data!.childRoll.id;
  await prisma.roll.update({ where: { id: child }, data: { labelDirty: false } });
  await inventory.applyManualProperties(child, { colorId: color.id, labelBatchNo: " J9 " }, actor.id);
  let cr = await prisma.roll.findUnique({ where: { id: child }, select: { labelBatchNo: true, labelDirty: true } });
  check("§6 değer değişti + labelDirty", cr?.labelBatchNo === "J9" && cr.labelDirty === true);
  const audit = await prisma.systemLog.findFirst({ where: { tableName: "ROLL_MANUAL_OVERRIDE", recordId: child }, orderBy: { createdAt: "desc" }, select: { oldData: true, newData: true } });
  const ad = audit as { oldData: { labelBatchNo?: string }; newData: { labelBatchNo?: string } } | null;
  check("§6 audit eski/yeni değer", ad?.oldData?.labelBatchNo === "J1" && ad?.newData?.labelBatchNo === "J9", JSON.stringify(ad));
  await prisma.roll.update({ where: { id: child }, data: { labelDirty: false } });
  await inventory.applyManualProperties(child, { colorId: color.id }, actor.id);
  cr = await prisma.roll.findUnique({ where: { id: child }, select: { labelBatchNo: true, labelDirty: true } });
  check("§6 alan yoksa dokunulmaz, etiket bayatlamaz", cr?.labelBatchNo === "J9" && cr.labelDirty === false);
  await inventory.applyManualProperties(child, { colorId: color.id, labelBatchNo: null }, actor.id);
  cr = await prisma.roll.findUnique({ where: { id: child }, select: { labelBatchNo: true, labelDirty: true } });
  check("§6 null temizler", cr?.labelBatchNo === null && cr.labelDirty === true);

  console.log("\n[§7] Zod şemaları");
  check("§7 cutWarehouseRollSchema taşır", cutWarehouseRollSchema.parse({ cutLength: 5, labelBatchNo: "J1" }).labelBatchNo === "J1");
  check("§7 cutOpenFabricSchema taşır", cutOpenFabricSchema.parse({ lengthMeters: 5, status: "WAREHOUSE", labelBatchNo: "J1" }).labelBatchNo === "J1");
  check("§7 finalizeWarehouseCutSchema taşır", finalizeWarehouseCutSchema.parse({ remainingAction: "keep_1kalite", labelBatchNo: "J1" }).labelBatchNo === "J1");
  check("§7 finalizeOpenFabricSchema taşır", finalizeOpenFabricSchema.parse({ remainingAction: "keep_1kalite", labelBatchNo: "J1" }).labelBatchNo === "J1");
  check("§7 finalizeSchema taşır", finalizeSchema.parse({ rollId: "00000000-0000-4000-8000-000000000000", labelBatchNo: "J1" }).labelBatchNo === "J1");
  check("§7 64 üstü reddedilir", !cutWarehouseRollSchema.safeParse({ cutLength: 5, labelBatchNo: "x".repeat(65) }).success);

  console.log("\n[§8] etiket");
  check("§8 katalog ROLL_RAW + ROLL_FINISHED", ["ROLL_RAW", "ROLL_FINISHED"].every((k) => (FIELD_CATALOG as Record<string, readonly { key: string }[]>)[k]?.some((f) => f.key === "labelBatchNo")));
  const p = { ...mockPayload("ROLL_FINISHED" as never), labelBatchNo: "J1", batchNumber: "P99" } as LabelPayload;
  const dv = fieldDisplayValue(p, "labelBatchNo");
  check("§8 değer basılır", dv.present && dv.value === "J1");
  check("§8 boşta present:false", !fieldDisplayValue({ ...p, labelBatchNo: null }, "labelBatchNo").present);
  const lines = rollTextLines(p).map((l) => l.text);
  check("§8 varsayılan native düzen 'Parti: J1', bizim parti bastırılır", lines.includes("Parti: J1") && !lines.includes("Parti: P99"), JSON.stringify(lines));
  check("§8 müşteri partisi yoksa bizim parti basılır (bugünkü)", rollTextLines({ ...p, labelBatchNo: null }).some((l) => l.text === "Parti: P99"));
}

async function cleanup(): Promise<void> {
  await prisma.rollVariance.deleteMany({ where: { roll: { parentRollId: { in: parentIds } } } }).catch(() => undefined);
  await prisma.rollVariance.deleteMany({ where: { rollId: { in: parentIds } } }).catch(() => undefined);
  await prisma.rollOperation.deleteMany({ where: { roll: { parentRollId: { in: parentIds } } } }).catch(() => undefined);
  await prisma.rollMovement.deleteMany({ where: { roll: { parentRollId: { in: parentIds } } } }).catch(() => undefined);
  await prisma.roll.deleteMany({ where: { parentRollId: { in: parentIds } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: parentIds } } }).catch(() => undefined);
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: parentIds } } }).catch(() => undefined);
  await prisma.roll.deleteMany({ where: { id: { in: parentIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  await cleanupTestCustomers(customerIds); // hesap → şube → kart (test_kart_teardown_hesap §0b)
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    await cleanup().catch((e) => console.error("temizlik:", e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
