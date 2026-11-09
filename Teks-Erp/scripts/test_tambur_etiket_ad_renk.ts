// =============================================================================
// Bekçi: TAMBUR ETİKET KUMAŞ ADI / RENK — topa kesimde yazılan müşteri etiket adı (Gülkesim 2026-11-09)
// Çalıştır: npx tsx scripts/test_tambur_etiket_ad_renk.ts   (DB'li, _test DB)
// =============================================================================
//   §1 Zod: beş kesim/bitirme şeması iki alanı TAŞIR (strip tuzağı) + 80 üstü red
//   §2 normalleştirici: boş/boşluk → null · trim + TR büyük harf · 80 üstü 400 LABEL_TEXT_INVALID
//   §3 yazma: beş yol değeri çocuğa yazar; cari ayarı (tamburLabelBatchEnabled) KAPALIYKEN de (bayraksız)
//   §4 MİRAS YOK: değersiz kesim null; ebeveyndeki değer segmentli finalize çocuklarına geçmez
//   §5 etiket: tekil + toplu yol topun değerini basar (source ROLL), İE düzeltmesini ezer; null → bayt-aynı
//   §6 öneri ucu: müşteri kümesi (sahip), tekil + en son önce, 180 gün sınırı, başka müşteri yok, `last`
//   §7 audit: CREATE satırı değeri taşır; değersiz kesimde alan YOK (bugünkü yük)
// Negatif sonda (ölçüldü 2026-11-09): label.service'teki applyRollLabelTexts çağrısı kapatılınca §5
// kırmızı; warehouse-cut.ts'te `labelItemName: labelTexts.labelItemName` satırı silinince §3 kırmızı.
// =============================================================================
import { RollStatus, StationKind, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { LabelService } from "../src/services/label.service";
import { LabelOverrideService } from "../src/services/label-override.service";
import { applyRollLabelTexts } from "../src/config/label-overrides";
import { normalizeRollLabelText } from "../src/services/helpers/label-batch-no.helper";
import { getTamburLabelSuggestions } from "../src/services/tambur/label-suggestions";
import { cutOpenFabricSchema, cutWarehouseRollSchema, finalizeOpenFabricSchema, finalizeSchema, finalizeWarehouseCutSchema } from "../src/controllers/tambur.controller";
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
function errCode(fn: () => unknown): string {
  try { fn(); return "OK"; } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string } };
    return `${x.statusCode ?? "?"}:${x.details?.code ?? ""}`;
  }
}
const stripVolatile = (p: LabelPayload) => ({ ...p, printedAt: "" });

const tambur = new TamburService();
const labels = new LabelService();
const overrides = new LabelOverrideService();
const ts = Date.now().toString().slice(-6);
const customerIds: string[] = [];
const parentIds: string[] = [];
const woIds: string[] = [];
const batchIds: string[] = [];
let seq = 0;

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  const item = await prisma.item.findUnique({ where: { code: "PATOS" }, select: { id: true, name: true } });
  const color = await prisma.color.findUnique({ where: { code: "MAVI" }, select: { id: true, name: true } });
  const station = await prisma.station.findFirst({ where: { kind: StationKind.TAMBUR }, select: { id: true } });
  if (!item || !color || !station) throw new Error("fixture: PATOS ürünü/MAVI renk/TAMBUR istasyonu yok");
  const grade = await roleGrade("FIRST");
  const actor = { id: await testActorId() };

  const mk = async (tag: string) => {
    const c = await prisma.customer.create({ data: { code: `TEST-EAR-${tag}-${ts}`, name: `TEST Etiket Ad ${tag} ${ts}` }, select: { id: true } });
    customerIds.push(c.id);
    return c.id;
  };
  const owner = await mk("O");
  const other = await mk("X");

  const warehouseRoll = async (ownerCustomerId: string, extra: { batchId?: string } = {}) => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TST-EAR-${seq++}-${ts}`, itemId: item.id, colorId: color.id, status: RollStatus.WAREHOUSE,
        currentQty: 100, initialQty: 100, width: 150, qualityGrade: grade.code, qualityGradeId: grade.id, ownerCustomerId, ...extra,
      },
      select: { id: true },
    });
    parentIds.push(r.id);
    return r.id;
  };
  const openFabric = async (ownerCustomerId: string) => {
    const wo = await prisma.workOrder.create({
      data: {
        workOrderNumber: `TST-EAR-WO-${seq++}-${ts}`, type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS,
        width: 150, targetItemId: item.id, targetColorId: color.id,
        steps: { create: [{ stationId: station.id, stepSequence: 1, status: "ACTIVE" as const }] },
      },
      include: { steps: true },
    });
    woIds.push(wo.id);
    const batch = await prisma.batch.create({ data: { batchNumber: `TST-EAR-P${seq++}-${ts}`, workOrderId: wo.id }, select: { id: true } });
    batchIds.push(batch.id);
    const r = await prisma.roll.create({
      data: {
        barcode: null, itemId: item.id, colorId: color.id, status: RollStatus.IN_PRODUCTION, currentQty: 100, initialQty: 100,
        width: 150, qualityGrade: grade.code, qualityGradeId: grade.id, currentStepId: wo.steps[0]!.id,
        entrySource: "SUBCONTRACTOR_RETURN", ownerCustomerId, batchId: batch.id,
      },
      select: { id: true },
    });
    parentIds.push(r.id);
    return { rollId: r.id, workOrderId: wo.id, batchId: batch.id };
  };
  const ofRoll = async (id: string) =>
    prisma.roll.findUnique({ where: { id }, select: { labelItemName: true, labelColorName: true } });

  console.log("\n[§1] Zod şemaları");
  const L = { labelItemName: "Sultan", labelColorName: "Ekru" };
  const carries = (o: { labelItemName?: string | null; labelColorName?: string | null }) => o.labelItemName === "Sultan" && o.labelColorName === "Ekru";
  check("§1 cutWarehouseRollSchema taşır", carries(cutWarehouseRollSchema.parse({ cutLength: 5, ...L })));
  check("§1 cutOpenFabricSchema taşır", carries(cutOpenFabricSchema.parse({ lengthMeters: 5, status: "WAREHOUSE", ...L })));
  check("§1 finalizeWarehouseCutSchema taşır", carries(finalizeWarehouseCutSchema.parse({ remainingAction: "keep_1kalite", ...L })));
  check("§1 finalizeOpenFabricSchema taşır", carries(finalizeOpenFabricSchema.parse({ remainingAction: "keep_1kalite", ...L })));
  check("§1 finalizeSchema taşır", carries(finalizeSchema.parse({ rollId: "00000000-0000-4000-8000-000000000000", ...L })));
  check("§1 80 üstü reddedilir", !cutWarehouseRollSchema.safeParse({ cutLength: 5, labelColorName: "x".repeat(81) }).success);

  console.log("\n[§2] normalleştirici");
  check("§2 boşluk → null", normalizeRollLabelText("   ", "Etiket kumaş adı") === null);
  check("§2 undefined/null → null", normalizeRollLabelText(undefined, "Etiket rengi") === null && normalizeRollLabelText(null, "Etiket rengi") === null);
  check("§2 trim + tek boşluk + TR büyük harf", normalizeRollLabelText("  sultan   ipek ", "Etiket kumaş adı") === "SULTAN İPEK");
  check("§2 80 üstü 400", errCode(() => normalizeRollLabelText("y".repeat(81), "Etiket rengi")) === "400:LABEL_TEXT_INVALID");

  console.log("\n[§3] yazma — beş yol, ayar kapalıyken");
  const cs = await prisma.customer.findUnique({ where: { id: owner }, select: { tamburLabelBatchEnabled: true } });
  check("§3 cari parti ayarı KAPALI (bayraksız olduğunu sınar)", cs?.tamburLabelBatchEnabled === false);
  const w1 = await warehouseRoll(owner);
  const r1 = await tambur.cutWarehouseRoll(w1, { cutLength: 10, labelItemName: " sultan ", labelColorName: "ekru" }, actor.id);
  let v = await ofRoll(r1.data!.childRoll.id);
  check("§3 depo topu kesimi → SULTAN / EKRU", v?.labelItemName === "SULTAN" && v.labelColorName === "EKRU", JSON.stringify(v));
  const f1 = await tambur.finalizeWarehouseCut(w1, { remainingAction: "keep_1kalite", labelItemName: "Lale" }, actor.id);
  v = f1.data?.remainingChild ? await ofRoll(f1.data.remainingChild.id) : null;
  check("§3 depo topu 'Bitir' kalanı → LALE, renk null", v?.labelItemName === "LALE" && v.labelColorName === null, JSON.stringify(v));
  const o1 = await openFabric(owner);
  const r3 = await tambur.cutOpenFabric(o1.rollId, { lengthMeters: 10, status: "WAREHOUSE", labelItemName: "Sultan", labelColorName: "Krem", confirmMismatch: true }, actor.id);
  v = await ofRoll(r3.data!.childRoll.id);
  check("§3 açık kumaş kesimi → SULTAN / KREM", v?.labelItemName === "SULTAN" && v.labelColorName === "KREM", JSON.stringify(v));

  console.log("\n[§4] miras yok");
  const r4 = await tambur.cutOpenFabric(o1.rollId, { lengthMeters: 10, status: "WAREHOUSE", confirmMismatch: true }, actor.id);
  v = await ofRoll(r4.data!.childRoll.id);
  check("§4 değersiz ikinci kesim null", v?.labelItemName === null && v.labelColorName === null, JSON.stringify(v));
  const f2 = await tambur.finalizeOpenFabric(o1.rollId, { remainingAction: "keep_1kalite", confirmMismatch: true, labelColorName: "Beyaz" }, actor.id);
  v = f2.data?.remainingChildId ? await ofRoll(f2.data.remainingChildId) : null;
  check("§3 açık kumaş 'Bitir' kalanı → renk BEYAZ", v?.labelColorName === "BEYAZ" && v.labelItemName === null, JSON.stringify(v));
  const o2 = await openFabric(owner);
  await prisma.roll.update({ where: { id: o2.rollId }, data: { labelItemName: "EBEVEYN", labelColorName: "EBEVEYN" } });
  const cut = { length: 10, qualityGrade: grade.code, relatedErrorIds: [] as string[] };
  const f3 = await tambur.finalize({ rollId: o2.rollId, decisions: [], cuts: [cut], confirmMismatch: true }, actor.id);
  const kids = await Promise.all((f3.data?.splitRolls ?? []).map((r) => ofRoll(r.id)));
  check("§4 ebeveyndeki değer finalize çocuklarına geçmez", kids.length === 2 && kids.every((k) => k?.labelItemName === null && k.labelColorName === null), JSON.stringify(kids));
  const o3 = await openFabric(owner);
  const f4 = await tambur.finalize({ rollId: o3.rollId, decisions: [], cuts: [cut], labelItemName: "Papatya", labelColorName: "Gri", confirmMismatch: true }, actor.id);
  const kids2 = await Promise.all((f4.data?.splitRolls ?? []).map((r) => ofRoll(r.id)));
  check("§3 segmentli finalize her parçaya PAPATYA / GRİ", kids2.length === 2 && kids2.every((k) => k?.labelItemName === "PAPATYA" && k.labelColorName === "GRİ"), JSON.stringify(kids2));

  console.log("\n[§5] etiket çözümlemesi");
  const child = r1.data!.childRoll.id;
  const p1 = (await labels.getRollLabel(child)).data!;
  check("§5 tekil: kumaş adı topun değeri, kaynak ROLL", p1.itemName === "SULTAN" && p1.itemNameSource === "ROLL" && p1.itemNameDefault === item.name, `${p1.itemName}/${p1.itemNameSource}`);
  check("§5 tekil: renk topun değeri, kaynak ROLL", p1.colorName === "EKRU" && p1.colorNameSource === "ROLL" && p1.colorNameDefault === color.name);
  const bulk = (await labels.getBulkRollLabelsHtml([child])).data!.html;
  check("§5 toplu: basılan HTML topun adını taşır", bulk.includes("SULTAN") && bulk.includes("EKRU"));
  // İE düzeltmesi (eski veri) okunmaya devam eder ama topun değeri önde.
  const wc = await prisma.roll.findUnique({ where: { id: r3.data!.childRoll.id }, select: { id: true } });
  const g0 = (await overrides.get(o1.workOrderId)).data!;
  await overrides.update(o1.workOrderId, { overrides: { itemName: "IE-ADI", widthCm: "160" }, updatedAt: g0.updatedAt }, actor.id);
  const p2 = (await labels.getRollLabel(wc!.id)).data!;
  check("§5 topun değeri İE düzeltmesini ezer, diğer İE anahtarı (en) kalır", p2.itemName === "SULTAN" && p2.widthCm === 160, `${p2.itemName}/${p2.widthCm}`);
  const p3 = (await labels.getRollLabel(r4.data!.childRoll.id)).data!;
  check("§5 değersiz topta İE düzeltmesi geçerli (zincir değişmedi)", p3.itemName === "IE-ADI" && p3.itemNameSource !== "ROLL");
  // Null → bayt-aynı: aynı topu değer koyup kaldırınca payload ilkine eşit.
  const plain = r4.data!.childRoll.id;
  await overrides.update(o1.workOrderId, { overrides: { itemName: null, widthCm: null } }, actor.id);
  const before = JSON.stringify(stripVolatile((await labels.getRollLabel(plain)).data!));
  await prisma.roll.update({ where: { id: plain }, data: { labelItemName: "GEÇİCİ" } });
  const mid = (await labels.getRollLabel(plain)).data!;
  await prisma.roll.update({ where: { id: plain }, data: { labelItemName: null } });
  const after = JSON.stringify(stripVolatile((await labels.getRollLabel(plain)).data!));
  check("§5 değer konunca değişir", mid.itemName === "GEÇİCİ");
  check("§5 null'da payload bayt-aynı", before === after);
  const mp = { ...mockPayload("ROLL_FINISHED" as never) } as LabelPayload;
  const mpJson = JSON.stringify(mp);
  applyRollLabelTexts(mp, { labelItemName: null, labelColorName: "  " });
  check("§5 saf: null/boşluk → dokunulmaz", JSON.stringify(mp) === mpJson);
  const nd0 = { ...mockPayload("ROLL_FINISHED" as never) } as LabelPayload;
  delete nd0.deliveryNoteItemText;
  applyRollLabelTexts(nd0, { labelItemName: "X1" });
  check("§5 saf: belge adı olmayan payload'a alan EKLENMEZ", !("deliveryNoteItemText" in nd0));
  const md = { ...mockPayload("ROLL_FINISHED" as never), deliveryNoteItemText: "BELGE", deliveryNoteColorText: "BELGE" } as LabelPayload;
  applyRollLabelTexts(md, { labelItemName: "X1", labelColorName: "Y1" });
  check("§5 saf: belge adı varsa o da aynı ada çekilir", md.deliveryNoteItemText === "X1" && md.deliveryNoteColorText === "Y1");

  console.log("\n[§6] öneri ucu");
  // Başka müşterinin topu ve 200 günlük eski top listeye girmez.
  const wx = await warehouseRoll(other);
  await tambur.cutWarehouseRoll(wx, { cutLength: 10, labelItemName: "YABANCI" }, actor.id);
  const old = await warehouseRoll(owner);
  await prisma.roll.update({ where: { id: old }, data: { labelItemName: "ESKİ", createdAt: new Date(Date.now() - 200 * 86_400_000) } });
  const s1 = await getTamburLabelSuggestions({ workOrderId: o1.workOrderId });
  check("§6 müşteri kümesi = sahip", s1.customerIds.length === 1 && s1.customerIds[0] === owner, JSON.stringify(s1.customerIds));
  check("§6 kumaş adları tekil, en son önce", s1.itemNames[0] === "PAPATYA" && s1.itemNames.filter((x) => x === "SULTAN").length === 1, JSON.stringify(s1.itemNames));
  check("§6 başka müşteri / 180 gün öncesi yok", !s1.itemNames.includes("YABANCI") && !s1.itemNames.includes("ESKİ"));
  check("§6 renkler", ["GRİ", "BEYAZ", "KREM", "EKRU"].every((c) => s1.colorNames.includes(c)) && s1.colorNames[0] === "GRİ", JSON.stringify(s1.colorNames));
  check("§6 last = bu İE'de değer taşıyan en son top (Bitir kalanı)", s1.last?.colorName === "BEYAZ" && s1.last.itemName === null, JSON.stringify(s1.last));
  const s2 = await getTamburLabelSuggestions({ rollId: wx });
  check("§6 rollId yolu: o topun müşterisi", s2.itemNames.length === 1 && s2.itemNames[0] === "YABANCI" && s2.last === null, JSON.stringify(s2));

  console.log("\n[§7] audit");
  const a1 = await prisma.systemLog.findFirst({ where: { tableName: "ROLL", recordId: child, action: "CREATE" }, select: { newData: true } });
  const nd = a1?.newData as Record<string, unknown> | undefined;
  check("§7 CREATE audit değeri taşır", nd?.labelItemName === "SULTAN" && nd?.labelColorName === "EKRU", JSON.stringify(nd));
  const a2 = await prisma.systemLog.findFirst({ where: { tableName: "ROLL", recordId: r4.data!.childRoll.id, action: "CREATE" }, select: { newData: true } });
  check("§7 değersiz kesimde audit yükü bugünkü gibi (alan yok)", !!a2 && !("labelItemName" in (a2.newData as Record<string, unknown>)));
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
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  await cleanupTestCustomers(customerIds);
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
