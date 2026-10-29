// =============================================================================
// BEKÇİ — HİZMET FİYATI (Gülkesim dalga 2 · H6, karar belgesi §5, §8 H6)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_hizmet_fiyati.ts
//
// NEDEN: Hizmet veren fabrika müşteriye işi (kurşun gramaj kademesi) metreyle
// keser. Kademe = gramaj değeri → hizmet kalemi eşlemesi; fiyat `ItemPrice`
// (müşteri istisnası, as-of). `FinishingRate` BİZİM maliyet tarifemizdir —
// gelirle karışırsa fatura sessizce maliyet fiyatından kesilir.
//
// ÖLÇÜLENLER:
//   §1 Eşleme: SERVICE olmayan kaleme eşleme 400 SERVICE_ITEM_INVALID; SERVICE kabul
//   §1b ⭐ Pasif hizmet kalemine YENİ eşleme 409 ITEM_INACTIVE (K1); taşınan eski eşleme düzenlemeyi kilitlemez
//   §2 2×K2 + 1×K1 ⇒ 2 kalem, miktar ±0,001; istisna genelden önce
//   §3 Damga sonrası: eski iş eski fiyat, yeni iş yeni fiyat
//   §4 Kâğıt: gramajlı kâğıt top doğru kalem; gramajsız → İE hedefi + uyarı
//   §5 Metre: aktif OUT okuması (SIMULATED hariç) DECLARED'dan önce
//   §6 Eşlemesiz gramaj: satır yok + uyarı (sessiz düşmez)
//   §7 SERVICE stoğa sızmaz: top doğumu 400 + 0 top; KUMAŞ↔SERVICE birleştirme bloklu; mal kabul ön kontrolü red
//   §8 AST: çözücü tek; `serviceItemId` okuyan dosya kümesi beyanlı (iki yönlü);
//      beyanlı dosyalarda `finishingRate` okuması ve finishing-rate importu YOK
// Negatif sonda (2026-10-29): çözücüye `prisma.finishingRate.findMany` eklenince §8 kırmızı;
// değer eşlemesi okunmayınca (özellik önce) §2 kırmızı — PR #253 gövdesinde.
// =============================================================================
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { ItemType, KursunBypassCompletionSource, MachineDataSource, MeterApprovalMode, MeterPhase, MeterVarianceBasis, PriceKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { fabricPropertyService } from "../src/routes/fabric-property.routes";
import { itemPriceService } from "../src/services/item-price.service";
import { InventoryService } from "../src/services/inventory.service";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";
import { collectReceiptLineIssues } from "../src/services/helpers/goods-receipt-preflight.helper";
import { resolveServiceItemsForRolls } from "../src/services/helpers/service-pricing.helper";
import { replaceWorkOrderTargetValues } from "../src/services/workorder-target-value.service";
import { applyKursunOperationTx } from "../src/services/helpers/kursun-operation.helper";
import { KURSUN_PROPERTY_CODE } from "../src/services/helpers/quality-station.helper";
import { KURSUN_BYPASS_MARKER_PREFIX } from "../src/services/helpers/kursun-bypass-guard.helper";
import { testActorId } from "./fixture-test-user";
import { walkTs } from "./lib/ts-tarama";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function errOf(fn: () => Promise<unknown>): Promise<{ status: number; code: string | null }> {
  try { await fn(); return { status: 200, code: null }; } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string } };
    return { status: x.statusCode ?? 500, code: x.details?.code ?? null };
  }
}

const STAMP = randomUUID().slice(0, 8);
const P = `TEST-HZF-${STAMP}`;
const fx = { itemIds: [] as string[], propIds: [] as string[], valueIds: [] as string[], woIds: [] as string[], rollIds: [] as string[], stationIds: [] as string[], machineIds: [] as string[], customerIds: [] as string[], kursunCreated: null as string | null };

async function mkItem(suffix: string, itemType: ItemType): Promise<string> {
  const it = await prisma.item.create({ data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST HZF ${suffix} ${STAMP}`, itemType, unit: "MT" }, select: { id: true } });
  fx.itemIds.push(it.id);
  return it.id;
}

let rollSeq = 0;
async function mkRoll(itemId: string, stepId: string, out: number, notes?: string): Promise<string> {
  rollSeq++;
  const roll = await prisma.roll.create({
    data: { itemId, barcode: `${P}-R${rollSeq}`, initialQty: Math.max(100, out), currentQty: out, status: "IN_PRODUCTION", currentStepId: stepId },
    select: { id: true },
  });
  fx.rollIds.push(roll.id);
  await prisma.rollMovement.create({ data: { rollId: roll.id, workOrderStepId: stepId, qtyIn: Math.max(100, out), qtyOut: out, exitedAt: new Date(), notes: notes ?? null } });
  return roll.id;
}

async function main(): Promise<void> {
  console.log("=== Hizmet fiyatı — eşleme · kademe · istisna · as-of · kâğıt · metre · AST (H6) ===");
  const actor = await testActorId();

  // Gramaj çeşidi (KURŞUN ana bayrağı + çeşit özelliği + K1/K2/K3 değerleri)
  let kursun = await prisma.fabricProperty.findUnique({ where: { code: KURSUN_PROPERTY_CODE }, select: { id: true } });
  if (!kursun) {
    kursun = await prisma.fabricProperty.create({ data: { code: KURSUN_PROPERTY_CODE, name: `TEST Kurşunlu ${STAMP}`, valueType: "FLAG" }, select: { id: true } });
    fx.kursunCreated = kursun.id;
  }
  let variant = await prisma.fabricProperty.findFirst({ where: { variantOfPropertyId: kursun.id }, select: { id: true, serviceItemId: true } });
  if (!variant) {
    variant = await prisma.fabricProperty.create({
      data: { code: `${P}-GR`.slice(0, 32), name: `TEST HZF gramaj ${STAMP}`, valueType: "CHOICE", variantOfPropertyId: kursun.id },
      select: { id: true, serviceItemId: true },
    });
    fx.propIds.push(variant.id);
  }
  const mkVal = async (n: string, sort: number) => {
    const v = await prisma.fabricPropertyValue.create({ data: { propertyId: variant!.id, code: `HZ${n}-${STAMP}`.slice(0, 32).toUpperCase(), name: `${n} gr`, sortOrder: sort }, select: { id: true } });
    fx.valueIds.push(v.id);
    return v.id;
  };
  const V = { k1: await mkVal("20", 10), k2: await mkVal("45", 20), k3: await mkVal("90", 30) };

  const fabric = await mkItem("KUM", ItemType.FABRIC);
  const K1 = await mkItem("K1", ItemType.SERVICE);
  const K2 = await mkItem("K2", ItemType.SERVICE);
  const cust = await prisma.customer.create({ data: { code: `${P}-C`.slice(0, 32), name: `TEST HZF müşteri ${STAMP}` }, select: { id: true } });
  fx.customerIds.push(cust.id);

  // ── §1 Eşleme ────────────────────────────────────────────────────────────
  section("§1 eşleme yalnız SERVICE kalemine");
  const bad = await errOf(() => fabricPropertyService.update(variant!.id, { serviceItemId: fabric }, actor));
  check("özellik → KUMAŞ kalemi eşlemesi 400 SERVICE_ITEM_INVALID", bad.status === 400 && bad.code === "SERVICE_ITEM_INVALID", JSON.stringify(bad));
  const v1 = await prisma.fabricPropertyValue.findUniqueOrThrow({ where: { id: V.k1 }, select: { code: true, name: true } });
  const badVal = await errOf(() => fabricPropertyService.update(variant!.id, { values: [{ code: v1.code, name: v1.name, serviceItemId: fabric }] }, actor));
  check("değer → KUMAŞ kalemi eşlemesi 400 SERVICE_ITEM_INVALID", badVal.status === 400 && badVal.code === "SERVICE_ITEM_INVALID", JSON.stringify(badVal));
  const okProp = await errOf(() => fabricPropertyService.update(variant!.id, { serviceItemId: K1 }, actor));
  const propK1 = await prisma.fabricProperty.findUniqueOrThrow({ where: { id: variant.id }, select: { serviceItemId: true } });
  check("özellik → SERVICE kalemi eşlemesi 200 + kalıcı", okProp.status === 200 && propK1.serviceItemId === K1, JSON.stringify(okProp));
  const clrProp = await errOf(() => fabricPropertyService.update(variant!.id, { serviceItemId: null }, actor));
  const propNull = await prisma.fabricProperty.findUniqueOrThrow({ where: { id: variant.id }, select: { serviceItemId: true } });
  check("özellik eşlemesi null ile kaldırılır", clrProp.status === 200 && propNull.serviceItemId === null, JSON.stringify(clrProp));
  // Değer eşlemesi doğrudan: özellik güncellemesi `values` replace'i ister (tüm liste); bekçi diğer değerlere dokunmaz.
  await prisma.fabricPropertyValue.update({ where: { id: V.k1 }, data: { serviceItemId: K1 } });
  await prisma.fabricPropertyValue.update({ where: { id: V.k2 }, data: { serviceItemId: K2 } });
  const allVals = await prisma.fabricPropertyValue.findMany({ where: { propertyId: variant.id }, select: { code: true, name: true, sortOrder: true, isActive: true } });
  const okVal = await errOf(() => fabricPropertyService.update(variant!.id, { values: allVals }, actor));
  const k1After = await prisma.fabricPropertyValue.findUniqueOrThrow({ where: { id: V.k1 }, select: { serviceItemId: true } });
  check("serviceItemId'siz values replace'i eşlemeyi KORUR", okVal.status === 200 && k1After.serviceItemId === K1, JSON.stringify(okVal));

  // §1b (K1): pasif (ARCHIVED) hizmet kalemine YENİ eşleme yazılamaz (item-usage DEFINITION → 409 ITEM_INACTIVE);
  // kaydın zaten taşıdığı eşleme (kalem sonradan pasife alınmış) başka alanı düzenlemeyi kilitlemez.
  const pas = await mkItem("PAS", ItemType.SERVICE);
  await prisma.item.update({ where: { id: pas }, data: { lifecycleStatus: "ARCHIVED", isActive: false } });
  const pasProp = await errOf(() => fabricPropertyService.update(variant!.id, { serviceItemId: pas }, actor));
  check("⭐ §1b özellik → PASİF hizmet kalemi eşlemesi 409 ITEM_INACTIVE", pasProp.status === 409 && pasProp.code === "ITEM_INACTIVE", JSON.stringify(pasProp));
  const v3row = await prisma.fabricPropertyValue.findUniqueOrThrow({ where: { id: V.k3 }, select: { code: true, name: true } });
  const pasVal = await errOf(() => fabricPropertyService.update(variant!.id, { values: [...allVals.filter((v) => v.code !== v3row.code), { ...v3row, serviceItemId: pas }] }, actor));
  check("⭐ §1b değer → PASİF hizmet kalemi eşlemesi 409 ITEM_INACTIVE", pasVal.status === 409 && pasVal.code === "ITEM_INACTIVE", JSON.stringify(pasVal));
  // Muafiyet KAYIT BAŞINA: kardeş değerin taşıdığı pasif kalem özelliğe ya da başka değere YENİ eşleme olamaz.
  await prisma.fabricPropertyValue.update({ where: { id: V.k3 }, data: { serviceItemId: pas } });
  const sibProp = await errOf(() => fabricPropertyService.update(variant!.id, { serviceItemId: pas }, actor));
  check("⭐ §1b kardeş değerin pasif kalemi ÖZELLİĞE yeni eşleme olamaz (409)", sibProp.status === 409 && sibProp.code === "ITEM_INACTIVE", JSON.stringify(sibProp));
  const v1row = await prisma.fabricPropertyValue.findUniqueOrThrow({ where: { id: V.k1 }, select: { code: true, name: true } });
  const sibVal = await errOf(() => fabricPropertyService.update(variant!.id, { values: [...allVals.filter((v) => v.code !== v1row.code && v.code !== v3row.code), { ...v3row, serviceItemId: pas }, { ...v1row, serviceItemId: pas }] }, actor));
  check("⭐ §1b kardeş değerin pasif kalemi BAŞKA DEĞERE yeni eşleme olamaz (409)", sibVal.status === 409 && sibVal.code === "ITEM_INACTIVE", JSON.stringify(sibVal));
  const ownVal = await errOf(() => fabricPropertyService.update(variant!.id, { values: [...allVals.filter((v) => v.code !== v3row.code), { ...v3row, serviceItemId: pas }] }, actor));
  check("§1b değerin KENDİ taşıdığı pasif eşlemeyle values replace'i 200", ownVal.status === 200, JSON.stringify(ownVal));
  await prisma.fabricPropertyValue.update({ where: { id: V.k3 }, data: { serviceItemId: null } });
  await prisma.fabricProperty.update({ where: { id: variant.id }, data: { serviceItemId: pas } });
  const keepOk = await errOf(() => fabricPropertyService.update(variant!.id, { serviceItemId: pas }, actor));
  check("§1b kaydın ZATEN taşıdığı (sonradan pasifleşen) eşlemeyle düzenleme 200", keepOk.status === 200, JSON.stringify(keepOk));
  await prisma.fabricProperty.update({ where: { id: variant.id }, data: { serviceItemId: null } });

  // Fiyatlar: genel K1=5, K2=8; müşteri istisnası K2=7.
  await itemPriceService.upsert({ itemId: K1, kind: PriceKind.SALE, currency: "TRY", price: 5 });
  await itemPriceService.upsert({ itemId: K2, kind: PriceKind.SALE, currency: "TRY", price: 8 });
  await itemPriceService.upsert({ itemId: K2, customerId: cust.id, kind: PriceKind.SALE, currency: "TRY", price: 7 });
  await sleep(60);

  const st = await prisma.station.create({ data: { code: `${P}-K`.slice(0, 32), name: `TEST HZF kurşun ${STAMP}`, type: "INTERNAL", kind: "PROCESS_QC", appliesProperty: true }, select: { id: true } });
  fx.stationIds.push(st.id);
  const m = await prisma.machine.create({ data: { stationId: st.id, code: `${P}-M`.slice(0, 32), name: `TEST HZF makine ${STAMP}` }, select: { id: true } });
  fx.machineIds.push(m.id);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${P}-WO`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: fabric,
      steps: { create: [1, 2, 3].map((n) => ({ stationId: st.id, stepSequence: n, status: "ACTIVE" as const })) },
    },
    select: { id: true, steps: { orderBy: { stepSequence: "asc" }, select: { id: true } } },
  });
  fx.woIds.push(wo.id);
  const [S1, S2, S3] = wo.steps.map((s) => s.id) as [string, string, string];
  const press = (rollId: string, valueId: string) => prisma.$transaction((tx) => applyKursunOperationTx(tx, { rollId, stepId: S1, valueId, userId: actor, machineId: m.id }));

  // ── §2 Kademe + istisna ─────────────────────────────────────────────────
  section("§2 2×K2 + 1×K1 ⇒ 2 kalem; istisna genelden önce");
  const rA = await mkRoll(fabric, S1, 98.25); await press(rA, V.k2);
  const rB = await mkRoll(fabric, S1, 101.5); await press(rB, V.k2);
  const rC = await mkRoll(fabric, S1, 97.125); await press(rC, V.k1);
  const gen = await resolveServiceItemsForRolls({ rollIds: [rA, rB, rC], customerId: null, currency: "TRY" });
  const lineOf = (r: typeof gen, id: string) => r.lines.filter((l) => l.serviceItemId === id);
  check("2 kalem", gen.lines.length === 2, JSON.stringify(gen.lines.map((l) => [l.code, l.quantity, l.unitPrice])));
  check("K2 miktar 199.750 ±0,001, 2 top, genel fiyat 8", Math.abs(Number(lineOf(gen, K2)[0]?.quantity) - 199.75) <= 0.001 && lineOf(gen, K2)[0]?.rollCount === 2 && Number(lineOf(gen, K2)[0]?.unitPrice) === 8);
  check("K1 miktar 97.125 ±0,001, fiyat 5", Math.abs(Number(lineOf(gen, K1)[0]?.quantity) - 97.125) <= 0.001 && Number(lineOf(gen, K1)[0]?.unitPrice) === 5);
  check("metre tabanı DECLARED (okuma yok)", gen.works.every((w) => w.meterBasis === "DECLARED"));
  const forCust = await resolveServiceItemsForRolls({ rollIds: [rA, rB, rC], customerId: cust.id, currency: "TRY" });
  check("müşteri: K2 istisnası 7, K1 genel 5", Number(lineOf(forCust, K2)[0]?.unitPrice) === 7 && Number(lineOf(forCust, K1)[0]?.unitPrice) === 5);

  // ── §3 As-of ────────────────────────────────────────────────────────────
  section("§3 damga sonrası eski hizmet eski fiyat");
  await itemPriceService.upsert({ itemId: K2, kind: PriceKind.SALE, currency: "TRY", price: 9 });
  await sleep(60);
  const rD = await mkRoll(fabric, S1, 50); await press(rD, V.k2);
  const asof = await resolveServiceItemsForRolls({ rollIds: [rA, rB, rD], customerId: null, currency: "TRY" });
  const k2s = lineOf(asof, K2).map((l) => `${Number(l.unitPrice)}:${Number(l.quantity)}`).sort();
  check("eski iş 8 (2 top 199.75), yeni iş 9 (50)", JSON.stringify(k2s) === JSON.stringify(["8:199.75", "9:50"]), JSON.stringify(k2s));

  // ── §4 Kâğıt ────────────────────────────────────────────────────────────
  section("§4 kâğıt gramajlı top doğru kalem; gramajsız → İE hedefi");
  const marker = `${KURSUN_BYPASS_MARKER_PREFIX}:${randomUUID()}`;
  const rK = await mkRoll(fabric, S2, 80, marker);
  await prisma.kursunBypassAssignment.create({
    data: { workOrderId: wo.id, workOrderStepId: S2, machineId: m.id, propertyValueId: V.k1, assignedById: actor, completedAt: new Date(), completedById: actor, completedVia: KursunBypassCompletionSource.DISTRIBUTION_LAST_STEP },
  });
  const kg = await resolveServiceItemsForRolls({ rollIds: [rK], customerId: null, currency: "TRY" });
  check("kâğıt K1 top → K1 kalemi 80 m", kg.works.length === 1 && kg.works[0]!.source === "KAGIT" && kg.works[0]!.serviceItemId === K1 && Number(kg.lines[0]?.quantity) === 80, JSON.stringify(kg.works.map((w) => [w.source, w.serviceItemId === K1])));
  await replaceWorkOrderTargetValues(wo.id, [{ propertyId: variant.id, valueId: V.k2 }], actor);
  const marker2 = `${KURSUN_BYPASS_MARKER_PREFIX}:${randomUUID()}`;
  const rU = await mkRoll(fabric, S3, 60, marker2);
  await prisma.kursunBypassAssignment.create({
    data: { workOrderId: wo.id, workOrderStepId: S3, machineId: m.id, assignedById: actor, completedAt: new Date(), completedById: actor, completedVia: KursunBypassCompletionSource.DISTRIBUTION_LAST_STEP },
  });
  const un = await resolveServiceItemsForRolls({ rollIds: [rU], customerId: null, currency: "TRY" });
  check("gramajsız kâğıt → İE hedefi K2 + uyarı", un.works[0]?.gramajFrom === "WO_TARGET" && un.works[0]?.serviceItemId === K2 && un.warnings.some((w) => w.includes("hedefinden (")), JSON.stringify(un.warnings));

  // ── §5 Metre tabanı ─────────────────────────────────────────────────────
  section("§5 aktif OUT okuması DECLARED'dan önce; SIMULATED sayılmaz");
  const reading = (rollId: string, meters: number, source: MachineDataSource) => prisma.rollMeterReading.create({
    data: { rollId, workOrderStepId: S1, phase: MeterPhase.OUT, meters, source, basis: MeterVarianceBasis.DECLARED_IN, approvalMode: MeterApprovalMode.NONE, clientToken: randomUUID(), createdById: actor },
    select: { id: true },
  });
  const rd = await reading(rC, 96.5, MachineDataSource.OPERATOR);
  const rSim = await mkRoll(fabric, S1, 70); await press(rSim, V.k1);
  await reading(rSim, 1.234, MachineDataSource.SIMULATED);
  const mt = await resolveServiceItemsForRolls({ rollIds: [rC, rSim], customerId: null, currency: "TRY" });
  const wC = mt.works.find((w) => w.rollId === rC);
  const wS = mt.works.find((w) => w.rollId === rSim);
  check("OUT okuması 96.5, taban OUT, readingId dolu", wC?.meterBasis === "OUT" && Number(wC.meters) === 96.5 && wC.readingId === rd.id);
  check("SIMULATED okuma yok sayılır → DECLARED 70", wS?.meterBasis === "DECLARED" && Number(wS.meters) === 70);

  // ── §6 Eşlemesiz ────────────────────────────────────────────────────────
  section("§6 eşlemesiz gramaj sessiz düşmez");
  let rN: string | null = null;
  if (variant.serviceItemId === null) {
    rN = await mkRoll(fabric, S1, 40); await press(rN, V.k3);
    const nm = await resolveServiceItemsForRolls({ rollIds: [rN], customerId: null, currency: "TRY" });
    check("eşlemesiz K3: satır 0 + uyarı", nm.lines.length === 0 && nm.works[0]?.serviceItemId === null && nm.warnings.some((w) => w.includes("eşlenmemiş")), JSON.stringify(nm.warnings));
  } else {
    console.log("   ⏭ çeşit özelliği ortamda eşlenmiş — §6 atlandı (beyan)");
  }

  // ── §7 Stoğa sızma ──────────────────────────────────────────────────────
  section("§7 SERVICE top/stok seçicisine sızmaz");
  const before = await prisma.roll.count({ where: { itemId: K1 } });
  const birth = await errOf(() => new InventoryService().createInitialEntry({ itemId: K1, initialQty: 10 }, actor));
  check("SERVICE kalemiyle top doğumu 400 + 0 top", birth.status === 400 && (await prisma.roll.count({ where: { itemId: K1 } })) === before, JSON.stringify(birth));
  const issues = await collectReceiptLineIssues([{ itemId: K1, initialQty: 10 }]);
  const mpv = await MasterDataMergeService.preview("item", K1, [fabric]);
  check("SERVICE ← KUMAŞ birleştirme önizlemesi IDENTITY_ITEMTYPE ile bloklu", !mpv.canMerge && mpv.blockers.some((b) => b.key === "IDENTITY_ITEMTYPE"), mpv.blockers.map((b) => b.key).join(","));
  const mpv2 = await MasterDataMergeService.preview("item", fabric, [K1]);
  check("KUMAŞ ← SERVICE birleştirme önizlemesi IDENTITY_ITEMTYPE ile bloklu", !mpv2.canMerge && mpv2.blockers.some((b) => b.key === "IDENTITY_ITEMTYPE"), mpv2.blockers.map((b) => b.key).join(","));
  check("mal kabul ön kontrolü SERVICE → ITEM_TYPE_NOT_ALLOWED", issues.some((i) => i.code === "ITEM_TYPE_NOT_ALLOWED"), JSON.stringify(issues.map((i) => i.code)));

  astChecks();
}

// ── §8 AST ────────────────────────────────────────────────────────────────
const SRC = join(__dirname, "..", "src");
/** `serviceItemId` okuyan/yazan dosyalar — yeni yüzey buraya beyanla eklenir (H7 fatura taslağı). */
const SERVICE_ITEM_ID_FILES = new Set([
  "services/helpers/service-pricing.helper.ts",
  "services/helpers/service-item-mapping.helper.ts",
  "services/fabric-property.service.ts",
  "routes/fabric-property.routes.ts",
  // H7: fatura bağı tek yazarı (çözücünün çıktısını bağa çevirir; ikinci çözücü değil).
  "services/helpers/service-billing.helper.ts",
  // H10: kurşun dışı bayrak işleri (Tambur/etek/brode) — çözücünün parçası, kalem `property.serviceItemId`ten.
  "services/helpers/service-flag-work.helper.ts",
  // H10: bayrak geri alma kapısı — eşlenmiş kalemi yalnız faturalı bağ aramak için okur (çözücü değil).
  "services/helpers/service-billing-gate.helper.ts",
  // F1: önizleme kapısı — taze bağların kalemini fatura satırıyla karşılaştırır (çözücü değil; toplayıcıyı çağırır).
  "services/helpers/service-preview-gate.helper.ts",
  // K2a: ürün kartı canlı referans kataloğu — eşlenmiş kalemi pasife alma kapısı için sayar (çözücü değil).
  "services/helpers/item-lifecycle.helper.ts",
]);
function astChecks(): void {
  section("§8 AST: çözücü tek, eşleme okuyucuları beyanlı, FinishingRate okunmaz");
  const files = walkTs(SRC);
  check("körlük zemini: src altında ≥ 300 .ts dosyası", files.length >= 300, String(files.length));
  const readers = new Set<string>();
  const resolverDefs: string[] = [];
  const finishingHits: string[] = [];
  for (const f of files) {
    const rel = relative(SRC, f).split("\\").join("/");
    const text = readFileSync(f, "utf8");
    if (!text.includes("serviceItemId") && !text.includes("resolveServiceItemsForRolls")) continue;
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && n.text === "serviceItemId") readers.add(rel);
      if (ts.isFunctionDeclaration(n) && n.name?.text === "resolveServiceItemsForRolls") resolverDefs.push(rel);
      if ((ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "resolveServiceItemsForRolls")) resolverDefs.push(rel);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  for (const rel of SERVICE_ITEM_ID_FILES) {
    if (!existsSync(join(SRC, rel))) continue; // bayat girdi aşağıda iki yönlü kontrolde kırmızı
    const text = readFileSync(join(SRC, rel), "utf8");
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      if (ts.isPropertyAccessExpression(n) && /^finishingRate/i.test(n.name.text)) finishingHits.push(`${rel}: .${n.name.text}`);
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text.includes("finishing-rate")) finishingHits.push(`${rel}: import ${n.moduleSpecifier.text}`);
      if (ts.isIdentifier(n) && n.text === "FinishingRate") finishingHits.push(`${rel}: FinishingRate`);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  check("resolveServiceItemsForRolls TEK tanım (service-pricing.helper)", resolverDefs.length === 1 && resolverDefs[0] === "services/helpers/service-pricing.helper.ts", JSON.stringify(resolverDefs));
  const undeclared = [...readers].filter((r) => !SERVICE_ITEM_ID_FILES.has(r));
  check("serviceItemId okuyan beyansız dosya yok (ikinci kopya)", undeclared.length === 0, JSON.stringify(undeclared));
  const stale = [...SERVICE_ITEM_ID_FILES].filter((r) => !readers.has(r));
  check("beyan listesinde bayat girdi yok (iki yönlü)", stale.length === 0, JSON.stringify(stale));
  check("eşleme/çözücü dosyalarında FinishingRate okuması yok (maliyet ≠ gelir)", finishingHits.length === 0, JSON.stringify(finishingHits));
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  const ids = fx.rollIds;
  await del("meterReading", () => prisma.rollMeterReading.deleteMany({ where: { rollId: { in: ids } } }));
  await del("assignment", () => prisma.kursunBypassAssignment.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("rollOperation", () => prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: ids } } }));
  await del("targetValue", () => prisma.workOrderTargetValue.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("machine", () => prisma.machine.deleteMany({ where: { id: { in: fx.machineIds } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("value", () => prisma.fabricPropertyValue.deleteMany({ where: { OR: [{ id: { in: fx.valueIds } }, { propertyId: { in: fx.propIds } }] } }));
  await del("variant bağı", () => prisma.fabricProperty.updateMany({ where: { id: { in: fx.propIds } }, data: { variantOfPropertyId: null } }));
  await del("property", () => prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } }));
  if (fx.kursunCreated) { const k = fx.kursunCreated; await del("KURSUN", () => prisma.fabricProperty.deleteMany({ where: { id: k } })); }
  await del("itemPrice", () => prisma.itemPrice.deleteMany({ where: { itemId: { in: fx.itemIds } } }));
  await del("item", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  await del("customer", () => prisma.customer.deleteMany({ where: { id: { in: fx.customerIds } } }));
  const left = await prisma.roll.count({ where: { barcode: { startsWith: P } } });
  check("temizlik: TEST-HZF top kalıntısı yok", left === 0, String(left));
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    await cleanup().catch((e) => { fail++; console.error(e); });
    if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
