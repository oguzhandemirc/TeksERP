// =============================================================================
// Bekçi: müşteri TAMBUR ayarları — tartım zorunlu, bölme önerisi, en kaynağı (Gülkesim S5)
// Çalıştır: npx tsx scripts/test_tambur_musteri_ayarlari.ts   (DB'li, _test DB)
// =============================================================================
//   §1 customer.update doğrulaması: en kaynağı INCOMING|MEASURED|"" (→null), bölme > 0, tartım boolean
//   §2 tartım KAPALI (varsayılan) → kg'sız kesim geçer (bugünkü), kg verilirse çocuğa yazılır
//   §3 tartım AÇIK → kg'sız kesim 400 TAMBUR_WEIGHT_REQUIRED (depo topu + açık kumaş), kg ile geçer
//   §4 ayar sahibi müşteri: Kime? (targetCustomerId) sahibi EZER
//   §5 GET label-settings görünümü: ayarlar + printTiming (varsayılan EACH) + ownerCustomer (sahip); yok top 404
//   §6 kesim şeması weightKg'ı TAŞIR (Zod strip tuzağı)
//   §7 'Bitir' yolları (s5 inceleme): kalan top doğuran finalizeWarehouseCut / finalizeOpenFabric /
//      segmentli finalize de AYNI kapıdan geçer; discard (top doğmaz) ve ayar kapalı → kg'sız geçer
// Negatif sonda (ölçüldü 2026-11-03): cutWarehouseRollInner'daki resolveTamburCutWeight
// çağrısı `weightKg: 1` sabitine çevrilince §3 depo topu kırmızı. §7: finalizeOpenFabric'teki
// kapı çağrısı kaldırılınca §7 açık kumaş 'kg'sız → 400' kırmızı.
// =============================================================================
import { RollStatus, StationKind, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { CustomerService } from "../src/services/customer.service";
import { TamburService } from "../src/services/tambur.service";
import { getTamburLabelSettings } from "../src/services/helpers/tambur-customer-settings.helper";
import { cutOpenFabricSchema, cutWarehouseRollSchema, finalizeOpenFabricSchema, finalizeSchema, finalizeWarehouseCutSchema } from "../src/controllers/tambur.controller";
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
    const c = await prisma.customer.create({ data: { code: `TEST-S5T-${tag}-${ts}`, name: `TEST S5 Tambur ${tag} ${ts}` }, select: { id: true } });
    customerIds.push(c.id);
    return c.id;
  };
  const owner = await mk("O");
  const target = await mk("K");

  const warehouseRoll = async (ownerCustomerId: string) => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TST-S5T-${seq++}-${ts}`, itemId: item.id, colorId: color.id, status: RollStatus.WAREHOUSE,
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
        workOrderNumber: `TST-S5T-WO-${seq++}-${ts}`, type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS,
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
  const kgOf = async (id: string) => {
    const r = await prisma.roll.findUnique({ where: { id }, select: { weightKg: true } });
    return r?.weightKg == null ? null : Number(r.weightKg);
  };

  console.log("\n[§1] müşteri kartı doğrulaması");
  check("§1 bilinmeyen en kaynağı 400", (await errCode(customers.update(owner, { labelWidthSource: "GELEN" }, actor?.id))).startsWith("400"));
  check("§1 bölme 0 → 400", (await errCode(customers.update(owner, { tamburSplitLengthM: 0 }, actor?.id))).startsWith("400"));
  check("§1 tartım metin → 400", (await errCode(customers.update(owner, { tamburWeighRequired: "evet" }, actor?.id))).startsWith("400"));
  await customers.update(owner, { labelWidthSource: "INCOMING", tamburSplitLengthM: "50,5" }, actor?.id);
  let c = await prisma.customer.findUnique({ where: { id: owner }, select: { labelWidthSource: true, tamburSplitLengthM: true, tamburWeighRequired: true } });
  check("§1 INCOMING + 50,5 m yazıldı, tartım varsayılan kapalı", c?.labelWidthSource === "INCOMING" && Number(c?.tamburSplitLengthM) === 50.5 && c?.tamburWeighRequired === false);
  await customers.update(owner, { labelWidthSource: "", tamburSplitLengthM: null }, actor?.id);
  c = await prisma.customer.findUnique({ where: { id: owner }, select: { labelWidthSource: true, tamburSplitLengthM: true, tamburWeighRequired: true } });
  check("§1 '' / null → temizlenir", c?.labelWidthSource === null && c?.tamburSplitLengthM === null);

  console.log("\n[§2] tartım kapalı (bugünkü)");
  const w1 = await warehouseRoll(owner);
  const r1 = await tambur.cutWarehouseRoll(w1, { cutLength: 10 }, actor?.id);
  check("§2 kg'sız kesim geçer, çocuk kg null", (await kgOf(r1.data!.childRoll.id)) === null);
  const r2 = await tambur.cutWarehouseRoll(w1, { cutLength: 10, weightKg: 12.345 }, actor?.id);
  check("§2 kg verilirse çocuğa yazılır (12,345)", (await kgOf(r2.data!.childRoll.id)) === 12.345);
  const f0 = await tambur.finalizeWarehouseCut(w1, { remainingAction: "keep_1kalite" }, actor?.id);
  check("§2 'Bitir' kg'sız geçer (bugünkü), kalan top kg null", f0.data?.remainingChild != null && (await kgOf(f0.data.remainingChild.id)) === null);

  console.log("\n[§3] tartım açık");
  await customers.update(owner, { tamburWeighRequired: true, tamburSplitLengthM: 50 }, actor?.id);
  const w2 = await warehouseRoll(owner);
  check("§3 depo topu kg'sız → 400 TAMBUR_WEIGHT_REQUIRED", (await errCode(tambur.cutWarehouseRoll(w2, { cutLength: 10 }, actor?.id))) === "400:TAMBUR_WEIGHT_REQUIRED");
  check("§3 ret sonrası top düşülmedi", Number((await prisma.roll.findUnique({ where: { id: w2 }, select: { currentQty: true } }))?.currentQty) === 100);
  const r3 = await tambur.cutWarehouseRoll(w2, { cutLength: 10, weightKg: 8 }, actor?.id);
  check("§3 depo topu kg ile geçer", (await kgOf(r3.data!.childRoll.id)) === 8);
  const o1 = await openFabric(owner);
  check("§3 açık kumaş kg'sız → 400 TAMBUR_WEIGHT_REQUIRED", (await errCode(tambur.cutOpenFabric(o1, { lengthMeters: 10, status: "WAREHOUSE" }, actor?.id))) === "400:TAMBUR_WEIGHT_REQUIRED");
  const r4 = await tambur.cutOpenFabric(o1, { lengthMeters: 10, status: "WAREHOUSE", weightKg: 9.5, confirmMismatch: true }, actor?.id);
  check("§3 açık kumaş kg ile geçer", (await kgOf(r4.data!.childRoll.id)) === 9.5);

  console.log("\n[§7] 'Bitir' yolları — tartım açık");
  const w4 = await warehouseRoll(owner);
  await tambur.cutWarehouseRoll(w4, { cutLength: 10, weightKg: 5 }, actor?.id);
  check("§7 depo topu 'Bitir' (kalan top) kg'sız → 400 TAMBUR_WEIGHT_REQUIRED", (await errCode(tambur.finalizeWarehouseCut(w4, { remainingAction: "keep_1kalite" }, actor?.id))) === "400:TAMBUR_WEIGHT_REQUIRED");
  check("§7 ret sonrası top tüketilmedi", (await prisma.roll.findUnique({ where: { id: w4 }, select: { status: true } }))?.status === RollStatus.WAREHOUSE);
  const f1 = await tambur.finalizeWarehouseCut(w4, { remainingAction: "keep_1kalite", weightKg: 7 }, actor?.id);
  check("§7 depo topu 'Bitir' kg ile → kalan top 7 kg", f1.data?.remainingChild != null && (await kgOf(f1.data.remainingChild.id)) === 7);
  const w5 = await warehouseRoll(owner);
  check("§7 depo topu discard (top doğmaz) kg'sız geçer", (await errCode(tambur.finalizeWarehouseCut(w5, { remainingAction: "discard" }, actor?.id))) === "OK");
  const o2 = await openFabric(owner);
  await tambur.cutOpenFabric(o2, { lengthMeters: 10, status: "WAREHOUSE", weightKg: 4, confirmMismatch: true }, actor?.id);
  check("§7 açık kumaş 'Bitir' kg'sız → 400 TAMBUR_WEIGHT_REQUIRED", (await errCode(tambur.finalizeOpenFabric(o2, { remainingAction: "keep_1kalite", confirmMismatch: true }, actor?.id))) === "400:TAMBUR_WEIGHT_REQUIRED");
  check("§7 ret sonrası açık kumaş tüketilmedi", (await prisma.roll.findUnique({ where: { id: o2 }, select: { status: true } }))?.status === RollStatus.IN_PRODUCTION);
  const f2 = await tambur.finalizeOpenFabric(o2, { remainingAction: "keep_1kalite", confirmMismatch: true, weightKg: 6.5 }, actor?.id);
  check("§7 açık kumaş 'Bitir' kg ile → kalan top 6,5 kg", f2.data?.remainingChildId != null && (await kgOf(f2.data.remainingChildId)) === 6.5);
  const o3 = await openFabric(owner);
  check("§7 açık kumaş discard kg'sız geçer", (await errCode(tambur.finalizeOpenFabric(o3, { remainingAction: "discard", varianceReasonCode: null }, actor?.id))) === "OK");
  const o4 = await openFabric(owner);
  const cut4 = { length: 10, qualityGrade: grade.code, relatedErrorIds: [] as string[] };
  check("§7 segmentli finalize kalan kuyruk kg'sız → 400", (await errCode(tambur.finalize({ rollId: o4, decisions: [], cuts: [{ ...cut4, weightKg: 4 }], confirmMismatch: true }, actor?.id))) === "400:TAMBUR_WEIGHT_REQUIRED");
  check("§7 segmentli finalize kesim kg'sız → 400", (await errCode(tambur.finalize({ rollId: o4, decisions: [], cuts: [cut4], remainingWeightKg: 3, confirmMismatch: true }, actor?.id))) === "400:TAMBUR_WEIGHT_REQUIRED");
  const f4 = await tambur.finalize({ rollId: o4, decisions: [], cuts: [{ ...cut4, weightKg: 4 }], remainingWeightKg: 3, confirmMismatch: true }, actor?.id);
  const kgs4 = await Promise.all((f4.data?.splitRolls ?? []).map((r) => kgOf(r.id)));
  check("§7 segmentli finalize kg'lar parçalara (4 · 3)", JSON.stringify(kgs4) === "[4,3]", JSON.stringify(kgs4));

  console.log("\n[§4] Kime? müşterisi sahibi ezer");
  const w3 = await warehouseRoll(owner);
  check("§4 Kime?=tartımsız müşteri → kg'sız geçer", (await errCode(tambur.cutWarehouseRoll(w3, { cutLength: 10, targetCustomerId: target }, actor?.id))) === "OK");

  console.log("\n[§5] label-settings görünümü");
  const v = await getTamburLabelSettings({ rollId: w3 });
  check("§5 sahibin ayarları + EACH", v.customerId === owner && v.weighRequired && v.splitLengthM === 50 && v.printTiming === "EACH", JSON.stringify(v));
  const v2 = await getTamburLabelSettings({ rollId: w3, customerId: target });
  check("§5 Kime? verilince onun ayarı", v2.customerId === target && !v2.weighRequired && v2.splitLengthM === null);
  // Tablet fason topta Kime? varsayılanını buradan alır: Kime? verilse de sahip DEĞİŞMEZ (prova 2026-11-06).
  check("§5 ownerCustomer = malın sahibi (Kime?'den bağımsız)", v.ownerCustomer?.id === owner && v2.ownerCustomer?.id === owner && !!v2.ownerCustomer?.name, JSON.stringify(v2.ownerCustomer));
  const vNone = await getTamburLabelSettings({});
  check("§5 topsuz okuma → ownerCustomer null", vNone.ownerCustomer === null);
  check("§5 yok top 404", (await errCode(getTamburLabelSettings({ rollId: "00000000-0000-4000-8000-000000000000" }))).startsWith("404"));

  console.log("\n[§6] Zod şeması");
  check("§6 cutWarehouseRollSchema weightKg taşır", cutWarehouseRollSchema.parse({ cutLength: 5, weightKg: 3 }).weightKg === 3);
  check("§6 cutOpenFabricSchema weightKg taşır", cutOpenFabricSchema.parse({ lengthMeters: 5, status: "WAREHOUSE", weightKg: 3 }).weightKg === 3);
  check("§6 finalizeWarehouseCutSchema weightKg taşır", finalizeWarehouseCutSchema.parse({ remainingAction: "keep_1kalite", weightKg: 3 }).weightKg === 3);
  check("§6 finalizeOpenFabricSchema weightKg taşır", finalizeOpenFabricSchema.parse({ remainingAction: "keep_1kalite", weightKg: 3 }).weightKg === 3);
  const fz = finalizeSchema.parse({ rollId: "00000000-0000-4000-8000-000000000000", cuts: [{ length: 5, qualityGrade: grade.code, weightKg: 2 }], remainingWeightKg: 1 });
  check("§6 finalizeSchema kesim + kalan kg taşır", fz.cuts[0]?.weightKg === 2 && fz.remainingWeightKg === 1);
  check("§6 negatif kg reddedilir", !cutWarehouseRollSchema.safeParse({ cutLength: 5, weightKg: -1 }).success);
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
