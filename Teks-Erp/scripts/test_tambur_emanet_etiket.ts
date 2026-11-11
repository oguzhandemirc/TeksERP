// =============================================================================
// Bekçi: tambur EMANET etiketi — sahip kilidi, ayar sahibi, alıcı, kg kaynağı, en mirası (2026-11-10)
// Çalıştır: npx tsx scripts/test_tambur_emanet_etiket.ts   (DB'li, _test DB)
// =============================================================================
//   a) emanet topta Kime?=başka müşteri → 409 LABEL_TARGET_NOT_OWNER (depo kesimi + açık kumaş)
//   b) başka müşterinin sipariş kalemi → 409; sahibin kalemi geçer
//   c) boş hedef (Stok) → çocuğun niyeti/aynası SAHİP
//   d) sahipsiz top → bugünkü gibi stok
//   e) kalan kuyruğu yazan üç yol (depo Bitir · açık kumaş Bitir · segmentli finalize) sahibi yazar
//   h) Kime?=başka müşteri gönderilse bile ayar sahipten (tartım zorunlu sahip → 400 TAMBUR_WEIGHT_REQUIRED)
//   i) alıcı: doğru sahip yazılır · başka sahibin alıcısı 400 · pasif 409 · mezar taşı → hedef · torun miras almaz
//   j) kg kaynağı: SCALE yazılır · SIMULATED + bayrak kapalı 400 (çocuk doğmaz) · oturum kantarı simüle 400 ·
//      kaynaksız kg MANUAL · kg'sız kaynak 400 · manuel üretim yolu da aynı boğazdan
//   k) label-texts PATCH alıcıyı değiştirir (labelDirty + audit) · null sahibe döner · sevkli top 409
//   l) label-suggestions consigneeId süzer; `last` alıcıyı taşır
//   m) K7 en: atada en yoksa gelen belge TOP satırı eni · ARABA (beyan) eni de çocuğa geçer, kök topa yazılmaz;
//      önizleme ipucu (sourceWidthCm) aynı miras eni gösterir · ölçülen en mirası
//      ezer (audit izinde widthBefore) · sınır dışı en 400
//   z) Zod: beş kesim şeması yeni alanları TAŞIR (strip tuzağı) · AST: simüle bayrağını okuyan yazım yolu tek boğaz
// Negatif sonda (2026-11-10): `resolveLabelIntent` sahip denetimi yorumlanınca a/b/c kırmızı; `owner ?? target`
// geri çevrilince h kırmızı; tambur simüle kapısı (`resolveWeightSource` çağrısı) MANUAL'e sabitlenince j kırmızı.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { OrderStatus, RollStatus, StationKind, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { InventoryService } from "../src/services/inventory.service";
import { getTamburLabelSuggestions } from "../src/services/tambur/label-suggestions";
import { getTamburLabelPreview } from "../src/services/tambur/label-preview";
import { ensureConsignee, deactivateConsignee } from "../src/services/customer-consignee.service";
import { mergeConsignee } from "../src/services/customer-consignee-merge.service";
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

const FLAG = "shipping.simulatedWeightEnabled";
const tambur = new TamburService();
const inventory = new InventoryService();
const ts = Date.now().toString().slice(-6);
const customerIds: string[] = [];
const parentIds: string[] = [];
const woIds: string[] = [];
const orderIds: string[] = [];
const noteIds: string[] = [];
const machineIds: string[] = [];
const deviceIds: string[] = [];
let prevFlag: unknown;
let seq = 0;

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  const item = await prisma.item.findUnique({ where: { code: "PATOS" }, select: { id: true } });
  const color = await prisma.color.findUnique({ where: { code: "MAVI" }, select: { id: true } });
  const station = await prisma.station.findFirst({ where: { kind: StationKind.TAMBUR }, select: { id: true } });
  if (!item || !color || !station) throw new Error("fixture: PATOS ürünü/MAVI renk/TAMBUR istasyonu yok");
  const grade = await roleGrade("FIRST");
  const actor = await testActorId();
  prevFlag = (await prisma.systemSetting.findUnique({ where: { key: FLAG }, select: { value: true } }))?.value;
  await prisma.systemSetting.upsert({ where: { key: FLAG }, create: { key: FLAG, value: false }, update: { value: false } });

  const mk = async (tag: string, weigh = false) => {
    const c = await prisma.customer.create({ data: { code: `TEST-TEE-${tag}-${ts}`, name: `TEST Emanet Etiket ${tag} ${ts}`, tamburWeighRequired: weigh }, select: { id: true } });
    customerIds.push(c.id);
    return c.id;
  };
  const owner = await mk("O");
  const other = await mk("K");
  const weighOwner = await mk("W", true);

  const warehouseRoll = async (ownerCustomerId: string | null, width: number | null = 150) => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TST-TEE-${seq++}-${ts}`, itemId: item.id, colorId: color.id, status: RollStatus.WAREHOUSE,
        currentQty: 100, initialQty: 100, width, qualityGrade: grade.code, qualityGradeId: grade.id, ownerCustomerId,
      },
      select: { id: true },
    });
    parentIds.push(r.id);
    return r.id;
  };
  const openFabric = async (ownerCustomerId: string | null) => {
    const wo = await prisma.workOrder.create({
      data: {
        workOrderNumber: `TST-TEE-WO-${seq++}-${ts}`, type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS,
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
  const rollOf = (id: string) => prisma.roll.findUnique({
    where: { id },
    select: { labelCustomerId: true, lastLabelSnapshot: true, labelConsigneeId: true, weightSource: true, weightKg: true, width: true, labelDirty: true },
  });
  const snapCustomer = (s: unknown) => (s as { customerId?: string } | null)?.customerId ?? null;
  const snapStock = (s: unknown) => (s as { stock?: boolean } | null)?.stock === true;

  console.log("\n[a] sahip kilidi — başka müşteri");
  const wa = await warehouseRoll(owner);
  check("a depo kesimi Kime?=başka → 409 LABEL_TARGET_NOT_OWNER", (await errCode(tambur.cutWarehouseRoll(wa, { cutLength: 5, targetCustomerId: other }, actor))) === "409:LABEL_TARGET_NOT_OWNER");
  const oa = await openFabric(owner);
  check("a açık kumaş Kime?=başka → 409", (await errCode(tambur.cutOpenFabric(oa, { lengthMeters: 5, status: "WAREHOUSE", targetCustomerId: other, confirmMismatch: true }, actor))) === "409:LABEL_TARGET_NOT_OWNER");
  check("a ret sonrası top düşülmedi", Number((await prisma.roll.findUnique({ where: { id: wa }, select: { currentQty: true } }))?.currentQty) === 100);

  console.log("\n[b] sipariş kalemi");
  const mkLine = async (customerId: string) => {
    const o = await prisma.order.create({
      data: { orderNumber: `TST-TEE-SIP-${seq++}-${ts}`, customerId, status: OrderStatus.APPROVED, lines: { create: [{ itemId: item.id, quantity: 100 }] } },
      select: { id: true, lines: { select: { id: true } } },
    });
    orderIds.push(o.id);
    return o.lines[0]!.id;
  };
  check("b başka müşterinin kalemi → 409", (await errCode(tambur.cutWarehouseRoll(wa, { cutLength: 5, targetOrderLineId: await mkLine(other) }, actor))) === "409:LABEL_TARGET_NOT_OWNER");
  const rb = await tambur.cutWarehouseRoll(wa, { cutLength: 5, targetOrderLineId: await mkLine(owner) }, actor);
  check("b sahibin kalemi geçer, ayna sahip", (await rollOf(rb.data!.childRoll.id))?.labelCustomerId === owner);

  console.log("\n[c] boş hedef → sahip");
  const rc = await tambur.cutWarehouseRoll(wa, { cutLength: 5 }, actor);
  const cc = await rollOf(rc.data!.childRoll.id);
  check("c depo kesimi Stok → snapshot + ayna sahip", snapCustomer(cc?.lastLabelSnapshot) === owner && cc?.labelCustomerId === owner, JSON.stringify(cc?.lastLabelSnapshot));
  const rc2 = await tambur.cutOpenFabric(oa, { lengthMeters: 5, status: "WAREHOUSE", confirmMismatch: true }, actor);
  check("c açık kumaş Stok → sahip", (await rollOf(rc2.data!.childRoll.id))?.labelCustomerId === owner);

  console.log("\n[d] sahipsiz top bugünkü gibi");
  const wd = await warehouseRoll(null);
  const rd = await tambur.cutWarehouseRoll(wd, { cutLength: 5 }, actor);
  const cd = await rollOf(rd.data!.childRoll.id);
  check("d sahipsiz Stok → stok etiketi, ayna null", snapStock(cd?.lastLabelSnapshot) && cd?.labelCustomerId === null);
  const rd2 = await tambur.cutWarehouseRoll(wd, { cutLength: 5, targetCustomerId: other }, actor);
  check("d sahipsiz Kime?=müşteri serbest", (await rollOf(rd2.data!.childRoll.id))?.labelCustomerId === other);

  console.log("\n[e] kalan kuyruğu sahibi yazar");
  const fe1 = await tambur.finalizeWarehouseCut(wa, { remainingAction: "keep_1kalite" }, actor);
  const te1 = await rollOf(fe1.data!.remainingChild!.id);
  check("e depo 'Bitir' kalan top sahip", snapCustomer(te1?.lastLabelSnapshot) === owner && te1?.labelCustomerId === owner);
  const fe2 = await tambur.finalizeOpenFabric(oa, { remainingAction: "keep_1kalite", confirmMismatch: true }, actor);
  const te2 = await rollOf(fe2.data!.remainingChildId!);
  check("e açık kumaş 'Bitir' kalan top sahip", snapCustomer(te2?.lastLabelSnapshot) === owner && te2?.labelCustomerId === owner);
  const oe = await openFabric(owner);
  const fe3 = await tambur.finalize({ rollId: oe, decisions: [], cuts: [{ length: 10, qualityGrade: grade.code, relatedErrorIds: [] }], confirmMismatch: true }, actor);
  const segs = await Promise.all((fe3.data?.splitRolls ?? []).map((r) => rollOf(r.id)));
  check("e segmentli finalize tüm parçalar sahip", segs.length === 2 && segs.every((x) => x?.labelCustomerId === owner && snapCustomer(x?.lastLabelSnapshot) === owner));
  const od = await openFabric(null);
  const fe4 = await tambur.finalizeOpenFabric(od, { remainingAction: "keep_1kalite", confirmMismatch: true }, actor);
  check("e sahipsiz kalan top stok (bugünkü)", snapStock((await rollOf(fe4.data!.remainingChildId!))?.lastLabelSnapshot));

  console.log("\n[h] ayar sahipten");
  const wh = await warehouseRoll(weighOwner);
  check("h Kime?=tartımsız başka müşteri, kg'sız → 400 TAMBUR_WEIGHT_REQUIRED", (await errCode(tambur.cutWarehouseRoll(wh, { cutLength: 5, targetCustomerId: other }, actor))) === "400:TAMBUR_WEIGHT_REQUIRED");

  console.log("\n[i] alıcı");
  const cA = (await ensureConsignee(owner, `TEST Alıcı A ${ts}`, actor)).consignee.id;
  const cX = (await ensureConsignee(other, `TEST Alıcı X ${ts}`, actor)).consignee.id;
  const cP = (await ensureConsignee(owner, `TEST Alıcı P ${ts}`, actor)).consignee.id;
  await deactivateConsignee(cP, actor);
  const cT = (await ensureConsignee(owner, `TEST Alıcı T ${ts}`, actor)).consignee.id;
  await mergeConsignee(cT, cA, actor);
  const wi = await warehouseRoll(owner);
  const ri = await tambur.cutWarehouseRoll(wi, { cutLength: 5, labelConsigneeId: cA }, actor);
  check("i doğru sahibin alıcısı çocuğa yazılır", (await rollOf(ri.data!.childRoll.id))?.labelConsigneeId === cA);
  check("i başka sahibin alıcısı → 400 CONSIGNEE_OWNER_MISMATCH", (await errCode(tambur.cutWarehouseRoll(wi, { cutLength: 5, labelConsigneeId: cX }, actor))) === "400:CONSIGNEE_OWNER_MISMATCH");
  check("i pasif alıcı → 409 CONSIGNEE_INACTIVE", (await errCode(tambur.cutWarehouseRoll(wi, { cutLength: 5, labelConsigneeId: cP }, actor))) === "409:CONSIGNEE_INACTIVE");
  const ri2 = await tambur.cutWarehouseRoll(wi, { cutLength: 5, labelConsigneeId: cT }, actor);
  check("i mezar taşı alıcı → hedef yazılır", (await rollOf(ri2.data!.childRoll.id))?.labelConsigneeId === cA);
  const grand = await tambur.cutWarehouseRoll(ri.data!.childRoll.id, { cutLength: 1 }, actor);
  check("i torun alıcıyı miras almaz", (await rollOf(grand.data!.childRoll.id))?.labelConsigneeId === null);
  const fi = await tambur.finalizeWarehouseCut(wi, { remainingAction: "keep_1kalite", labelConsigneeId: cA }, actor);
  check("i 'Bitir' kalan topa alıcı yazılır", (await rollOf(fi.data!.remainingChild!.id))?.labelConsigneeId === cA);

  console.log("\n[j] kg kaynağı");
  const wj = await warehouseRoll(owner);
  const rj = await tambur.cutWarehouseRoll(wj, { cutLength: 5, weightKg: 3, weightSource: "SCALE" }, actor);
  check("j SCALE yazılır", (await rollOf(rj.data!.childRoll.id))?.weightSource === "SCALE");
  const before = await prisma.roll.count({ where: { parentRollId: wj } });
  check("j SIMULATED + bayrak kapalı → 400", (await errCode(tambur.cutWarehouseRoll(wj, { cutLength: 5, weightKg: 3, weightSource: "SIMULATED" }, actor))) === "400:SIMULATED_WEIGHT_DISABLED");
  check("j ret sonrası çocuk doğmadı", (await prisma.roll.count({ where: { parentRollId: wj } })) === before);
  const m = await prisma.machine.create({ data: { stationId: station.id, code: `TEST-TEE-M-${ts}`, name: `TEST TEE Makine ${ts}` }, select: { id: true } });
  machineIds.push(m.id);
  const dev = await prisma.peripheralDevice.create({
    data: { code: `TEST-TEE-SCALE-${ts}`, name: `TEST TEE Simüle Kantar ${ts}`, kind: "SCALE", connectionType: "BLUETOOTH_SPP", address: "00:11:22:33:44:66", role: "PRIMARY", simulate: true, machineId: m.id },
    select: { id: true },
  });
  deviceIds.push(dev.id);
  check("j oturum kantarı simüle + SCALE beyanı → 400", (await errCode(tambur.cutWarehouseRoll(wj, { cutLength: 5, weightKg: 3, weightSource: "SCALE" }, actor, null, m.id))) === "400:SIMULATED_WEIGHT_DISABLED");
  const rjm = await tambur.cutWarehouseRoll(wj, { cutLength: 5, weightKg: 3, weightSource: "MANUAL" }, actor, null, m.id);
  check("j MANUAL simüle kantarda da geçer", (await rollOf(rjm.data!.childRoll.id))?.weightSource === "MANUAL");
  const rj2 = await tambur.cutWarehouseRoll(wj, { cutLength: 5, weightKg: 3 }, actor);
  check("j kaynaksız kg → MANUAL (eski APK)", (await rollOf(rj2.data!.childRoll.id))?.weightSource === "MANUAL");
  const rj3 = await tambur.cutWarehouseRoll(wj, { cutLength: 5 }, actor);
  check("j kg'sız kesimde kaynak null", (await rollOf(rj3.data!.childRoll.id))?.weightSource === null);
  check("j kg'sız kaynak → 400 WEIGHT_SOURCE_WITHOUT_KG", (await errCode(tambur.cutWarehouseRoll(wj, { cutLength: 5, weightSource: "SCALE" }, actor))) === "400:WEIGHT_SOURCE_WITHOUT_KG");
  const oj = await openFabric(owner);
  check("j segmentli finalize SIMULATED kesim → 400", (await errCode(tambur.finalize({ rollId: oj, decisions: [], cuts: [{ length: 10, qualityGrade: grade.code, relatedErrorIds: [], weightKg: 2, weightSource: "SIMULATED" }], confirmMismatch: true }, actor))) === "400:SIMULATED_WEIGHT_DISABLED");
  const fj = await tambur.finalize({ rollId: oj, decisions: [], cuts: [{ length: 10, qualityGrade: grade.code, relatedErrorIds: [], weightKg: 2, weightSource: "SCALE" }], remainingWeightKg: 4, confirmMismatch: true }, actor);
  const srcs = await Promise.all((fj.data?.splitRolls ?? []).map(async (r) => (await rollOf(r.id))?.weightSource));
  check("j segmentli finalize kaynaklar (SCALE · MANUAL)", JSON.stringify(srcs) === '["SCALE","MANUAL"]', JSON.stringify(srcs));

  console.log("\n[k] label-texts alıcı düzeltmesi");
  const kRoll = ri2.data!.childRoll.id;
  await prisma.roll.update({ where: { id: kRoll }, data: { labelPrintedAt: new Date(), labelDirty: false } });
  const cB = (await ensureConsignee(owner, `TEST Alıcı B ${ts}`, actor)).consignee.id;
  const k1 = await inventory.fixLabelTexts(kRoll, { labelConsigneeId: cB, reason: "alıcı yanlış" }, actor);
  const kr = await rollOf(kRoll);
  check("k alıcı değişti + labelDirty", k1.data?.changed === true && kr?.labelConsigneeId === cB && kr?.labelDirty === true);
  const kLog = await prisma.systemLog.findFirst({ where: { tableName: "ROLL", recordId: kRoll, action: "UPDATE" }, orderBy: { createdAt: "desc" }, select: { oldData: true, newData: true } });
  check("k audit eski/yeni alıcıyı taşır", (kLog?.oldData as { labelConsigneeId?: string })?.labelConsigneeId === cA && (kLog?.newData as { labelConsigneeId?: string })?.labelConsigneeId === cB);
  check("k başka sahibin alıcısı → 400", (await errCode(inventory.fixLabelTexts(kRoll, { labelConsigneeId: cX, reason: "deneme" }, actor))) === "400:CONSIGNEE_OWNER_MISMATCH");
  await inventory.fixLabelTexts(kRoll, { labelConsigneeId: null, reason: "sahibe dön" }, actor);
  check("k null → sahibe döner (alıcı null)", (await rollOf(kRoll))?.labelConsigneeId === null);
  await prisma.roll.update({ where: { id: kRoll }, data: { status: RollStatus.SHIPPED } });
  check("k sevkli top → 409 ROLL_SHIPPED", (await errCode(inventory.fixLabelTexts(kRoll, { labelConsigneeId: cB, reason: "geç" }, actor))) === "409:ROLL_SHIPPED");

  console.log("\n[l] öneriler alıcıya göre");
  await prisma.roll.update({ where: { id: ri.data!.childRoll.id }, data: { labelItemName: `TEST-AD-A-${ts}` } });
  await prisma.roll.update({ where: { id: rb.data!.childRoll.id }, data: { labelItemName: `TEST-AD-Z-${ts}` } });
  const sug = await getTamburLabelSuggestions({ rollId: wi, consigneeId: cA });
  check("l consigneeId süzer (yalnız A'nın adı)", sug.itemNames.includes(`TEST-AD-A-${ts}`) && !sug.itemNames.includes(`TEST-AD-Z-${ts}`), JSON.stringify(sug.itemNames));
  const sugAll = await getTamburLabelSuggestions({ rollId: wi });
  check("l süzgeçsiz sahip kapsamı ikisini de görür", sugAll.itemNames.includes(`TEST-AD-A-${ts}`) && sugAll.itemNames.includes(`TEST-AD-Z-${ts}`));
  const sugWo = await getTamburLabelSuggestions({ workOrderId: woIds[woIds.length - 1]! });
  check("l last alıcı alanlarını taşır (anahtar var)", sugWo.last === null || ("consigneeId" in sugWo.last && "consigneeName" in sugWo.last));

  console.log("\n[m] K7 en");
  const mkNote = async (rollId: string, lineKind: "TOP" | "ARABA", widthCm: number | null) => {
    const n = await prisma.customerDeliveryNote.create({
      data: { noteNo: `TST-TEE-GB-${seq++}-${ts}`, sourceKind: "MANUAL", ownerCustomerId: owner, lines: { create: [{ lineNo: 1, lineKind, meters: 100, widthCm, rollId }] } },
      select: { id: true },
    });
    noteIds.push(n.id);
  };
  const wm = await warehouseRoll(owner, null);
  await mkNote(wm, "TOP", 182);
  const rm = await tambur.cutWarehouseRoll(wm, { cutLength: 5 }, actor);
  check("m atada en yok → gelen belge TOP eni (182)", Number((await rollOf(rm.data!.childRoll.id))?.width) === 182);
  const grandM = await tambur.cutWarehouseRoll(rm.data!.childRoll.id, { cutLength: 1 }, actor);
  check("m torun atanın enini miras alır", Number((await rollOf(grandM.data!.childRoll.id))?.width) === 182);
  const wm2 = await warehouseRoll(owner, null);
  await mkNote(wm2, "ARABA", 175);
  const rm2 = await tambur.cutWarehouseRoll(wm2, { cutLength: 5 }, actor);
  // 2026-11-11 (GK demo): ARABA beyan eni de miras; kök top ölçülmedikçe en'siz kalır (beyan ≠ ölçülen).
  check("m ARABA beyan eni kök topa yazılmaz (null)", (await rollOf(wm2))?.width === null);
  check("m ARABA beyan eni çocuğa geçer (175)", Number((await rollOf(rm2.data!.childRoll.id))?.width) === 175);
  const wm2b = await warehouseRoll(owner, null);
  await mkNote(wm2b, "ARABA", 325);
  const pv = await getTamburLabelPreview({ rollId: wm2b, draft: {} });
  check("m önizleme ipucu ARABA beyan eni (325)", pv.sourceWidthCm === 325, String(pv.sourceWidthCm));
  // Belgede en YOK (şablonda en alanı yok / belgesiz): hiçbir kapı yok, en boş kalır, operatör isterse girer.
  const wm2n = await warehouseRoll(owner, null);
  await mkNote(wm2n, "ARABA", null);
  const pvN = await getTamburLabelPreview({ rollId: wm2n, draft: {} });
  check("m en'siz belge → önizleme ipucu boş (null)", pvN.sourceWidthCm === null, String(pvN.sourceWidthCm));
  const rm2n = await tambur.cutWarehouseRoll(wm2n, { cutLength: 5 }, actor);
  check("m en'siz belge → kesim sorunsuz, çocuk eni null", (await rollOf(rm2n.data!.childRoll.id))?.width === null);
  const rm2m = await tambur.cutWarehouseRoll(wm2n, { cutLength: 5, widthCm: 410 }, actor);
  check("m en'siz belge → elle girilen en sınırsız kabul (410)", Number((await rollOf(rm2m.data!.childRoll.id))?.width) === 410);
  const wm2s = await warehouseRoll(owner, null);
  const pvS = await getTamburLabelPreview({ rollId: wm2s, draft: {} });
  const rm2s = await tambur.cutWarehouseRoll(wm2s, { cutLength: 5 }, actor);
  check("m belgesiz top → ipucu null + kesim sorunsuz, en null", pvS.sourceWidthCm === null && (await rollOf(rm2s.data!.childRoll.id))?.width === null);
  const wm3 = await warehouseRoll(owner, 150);
  const rm3 = await tambur.cutWarehouseRoll(wm3, { cutLength: 5, widthCm: 148.5 }, actor);
  check("m ölçülen en mirası ezer (148,5)", Number((await rollOf(rm3.data!.childRoll.id))?.width) === 148.5);
  const mLog = await prisma.systemLog.findFirst({ where: { tableName: "ROLL", recordId: rm3.data!.childRoll.id, action: "CREATE" }, select: { newData: true } });
  const trace = (mLog?.newData as { measuredWidth?: { widthBefore: number; widthAfter: number } })?.measuredWidth;
  check("m iz widthBefore korur (150 → 148,5)", trace?.widthBefore === 150 && trace?.widthAfter === 148.5, JSON.stringify(trace));
  check("m sınır dışı en → 400 WIDTH_OUT_OF_RANGE", (await errCode(tambur.cutWarehouseRoll(wm3, { cutLength: 5, widthCm: 900 }, actor))) === "400:WIDTH_OUT_OF_RANGE");
  const om = await openFabric(owner);
  const fm = await tambur.finalize({ rollId: om, decisions: [], cuts: [{ length: 10, qualityGrade: grade.code, relatedErrorIds: [] }], widthCm: 149, confirmMismatch: true }, actor);
  const fws = await Promise.all((fm.data?.splitRolls ?? []).map(async (r) => Number((await rollOf(r.id))?.width)));
  check("m segmentli finalize ölçülen en tüm parçalara", JSON.stringify(fws) === "[149,149]", JSON.stringify(fws));
  const omN = await openFabric(owner);
  await prisma.roll.update({ where: { id: omN }, data: { width: null } });
  const omStep = await prisma.roll.findUniqueOrThrow({ where: { id: omN }, select: { currentStep: { select: { workOrderId: true } } } });
  await prisma.workOrder.update({ where: { id: omStep.currentStep!.workOrderId }, data: { width: null } });
  await mkNote(omN, "ARABA", null);
  const fmN = await tambur.finalize({ rollId: omN, decisions: [], cuts: [{ length: 10, qualityGrade: grade.code, relatedErrorIds: [] }], confirmMismatch: true }, actor);
  const fwsN = await Promise.all((fmN.data?.splitRolls ?? []).map(async (r) => (await rollOf(r.id))?.width ?? null));
  check("m en'siz top + en'siz belge → finalize sorunsuz, parçalar en'siz", fwsN.length > 0 && fwsN.every((w) => w === null), JSON.stringify(fwsN));

  console.log("\n[z] Zod + AST");
  const U = "00000000-0000-4000-8000-000000000001";
  check("z cutWarehouseRollSchema taşır", (() => { const p = cutWarehouseRollSchema.parse({ cutLength: 5, labelConsigneeId: U, weightKg: 2, weightSource: "SCALE", widthCm: 150 }); return p.labelConsigneeId === U && p.weightSource === "SCALE" && p.widthCm === 150; })());
  check("z cutOpenFabricSchema taşır", (() => { const p = cutOpenFabricSchema.parse({ lengthMeters: 5, status: "WAREHOUSE", labelConsigneeId: U, weightSource: "MANUAL", widthCm: 150 }); return p.labelConsigneeId === U && p.weightSource === "MANUAL" && p.widthCm === 150; })());
  check("z finalizeWarehouseCutSchema taşır", (() => { const p = finalizeWarehouseCutSchema.parse({ remainingAction: "keep_1kalite", labelConsigneeId: U, weightSource: "SCALE", widthCm: 150 }); return p.labelConsigneeId === U && p.weightSource === "SCALE" && p.widthCm === 150; })());
  check("z finalizeOpenFabricSchema taşır", (() => { const p = finalizeOpenFabricSchema.parse({ remainingAction: "keep_1kalite", labelConsigneeId: U, weightSource: "SCALE", widthCm: 150 }); return p.labelConsigneeId === U && p.weightSource === "SCALE" && p.widthCm === 150; })());
  check("z finalizeSchema kesim/kalan kaynağı + alıcı + en taşır", (() => { const p = finalizeSchema.parse({ rollId: U, cuts: [{ length: 5, qualityGrade: "A", weightKg: 1, weightSource: "SCALE" }], remainingWeightSource: "MANUAL", labelConsigneeId: U, widthCm: 150 }); return p.cuts[0]?.weightSource === "SCALE" && p.remainingWeightSource === "MANUAL" && p.labelConsigneeId === U && p.widthCm === 150; })());
  check("z bilinmeyen kaynak reddedilir", !cutWarehouseRollSchema.safeParse({ cutLength: 5, weightKg: 1, weightSource: "TAHMIN" }).success);
  // AST (metin düzeyi): simüle bayrağını okuyan yazım yolu yalnız kapı helper'ı; çuval ve tambur ondan geçer.
  const srcDir = path.join(__dirname, "../src/services");
  const readers: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && /readSimulatedWeightEnabled\s*\(/.test(fs.readFileSync(p, "utf8"))) readers.push(path.relative(srcDir, p));
    }
  };
  walk(srcDir);
  const allowed = new Set(["helpers/weight-source-gate.helper.ts", "system-setting.service.ts", path.join("system-setting", "shipping.ts")]);
  const stray = readers.filter((r) => !allowed.has(r) && !r.startsWith("system-setting"));
  check("z simüle bayrağını okuyan yazım yolu tek boğaz", stray.length === 0, stray.join(", "));
  const gateUsers = ["shipping/sack-weigh.ts", "helpers/tambur-customer-settings.helper.ts"].every((f) => /resolveWeightSource\(/.test(fs.readFileSync(path.join(srcDir, f), "utf8")));
  check("z çuval + tambur kapıdan geçer", gateUsers);
}

async function cleanup(): Promise<void> {
  const lvl1 = (await prisma.roll.findMany({ where: { parentRollId: { in: parentIds } }, select: { id: true } })).map((r) => r.id);
  const lvl2 = (await prisma.roll.findMany({ where: { parentRollId: { in: lvl1 } }, select: { id: true } })).map((r) => r.id);
  const ids = [...lvl2, ...lvl1, ...parentIds];
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: noteIds } } });
  for (const m of ["rollVariance", "rollOperation", "rollMovement", "rollProperty", "warehouseMovement", "rollCustomerCode", "rollMeterReading"] as const) {
    await (prisma[m] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { rollId: { in: ids } } }).catch(() => undefined);
  }
  await prisma.roll.updateMany({ where: { id: { in: ids } }, data: { parentRollId: null } });
  await prisma.roll.deleteMany({ where: { id: { in: ids } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.peripheralDevice.deleteMany({ where: { id: { in: deviceIds } } });
  await prisma.machine.deleteMany({ where: { id: { in: machineIds } } });
  // Alıcılar: önce mezar taşları (partial unique), sonra canlılar; toplar zaten silindi.
  await prisma.customerConsignee.deleteMany({ where: { customerId: { in: customerIds }, mergedIntoId: { not: null } } });
  await prisma.customerConsignee.deleteMany({ where: { customerId: { in: customerIds } } });
  await cleanupTestCustomers(customerIds);
  if (prevFlag === undefined) await prisma.systemSetting.deleteMany({ where: { key: FLAG } });
  else await prisma.systemSetting.update({ where: { key: FLAG }, data: { value: prevFlag as never } });
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
