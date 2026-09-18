// =============================================================================
// BEKÇİ — Z1 ÜRETİM BELGE ZİNCİRİ (2026-09-18): üç opsiyonel bağ · üç bayrak · Y3 türetme · çözgü kartı uyarısı
// =============================================================================
// Tasarım: docs/design/URETIM-BELGE-ZINCIRI.md §3.1 (seçenek A, Y1 = PİVOT) · §4 · §7 (MV-05: şema yalnız ekler,
// her bağ nullable doğar, varsayılan = bugünkü davranış, göç gerekmez).
// §0 üç bayrak varsayılanı FALSE ölçülür (getFeatureFlags + §3.6 resolver'ları; satır yokken kapı koşmaz)
// §1 NULLABLE DOĞUŞ: dokuma işi `orderLines` vermeden (→ []), levent `weavingOrderId` vermeden (→ null), koşum işsiz
// §2 Y1 PİVOT: create/replace/temizle · aynı satır iki kez 400 · yok/iptal 400 (`details.code`) · liste süzgeçleri
// §3 Y2 LEVENT: bağ DTO'da · fasona verilen / kapanmış iş 400 NOT_LINKABLE · çözgü kartı farkı UYARI (red değil) ·
//    sarımda gövde bağı plana yazar · liste süzgeci
// §4 ZORUNLU KİP (bayraklar AÇIK; try içinde upsert, finally'de geri): işsiz sarım 400 BEAM_WEAVING_LINK_REQUIRED ·
//    işsiz koşum 400 RUN_WEAVING_ORDER_REQUIRED · satırsız dokuma işi 400 WEAVING_ORDER_LINE_REQUIRED; bağlıyken geçer
// §5 TABLET BAĞLAMI: takılı leventin işi ÖN-DOLGU (`suggestedFrom: MOUNTED_BEAM`), açık işler yalnız IN_HOUSE açık
// §6 Y3 KOLON YOK: `Roll`/`WorkOrder`da `weavingOrderId` kolonu yok (şema taraması); yeni işte producedRollCount 0
// Negatif sonda (kırmızı görüldü): `assertOrderLineLinkGate` `linkCount > 0` dalı kaldırılınca §4 "bağlıyken geçer"
// ❌; `warpSpecMismatchWarning` `null` dönünce §3 uyarı ❌.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; temizlik yalnız `temizle`de; bayraklar `finally`de geri yüklenir.
// Koşum: npx tsx scripts/test_uretim_belge_zinciri.ts
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ItemType, OrderStatus, Prisma, StationType, WarpBeamOrigin, WarpBeamStatus, WeavingExecutionKind } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS, resolveBeamWeavingLinkRequired, resolveOrderLineLinkRequired, resolveRunWeavingOrderRequired, systemSettingService } from "../src/services/system-setting.service";
import { cancelWeavingOrder, createWeavingOrder, getWeavingOrder, listWeavingOrders, updateWeavingOrder } from "../src/services/weaving-order.service";
import { createWarpBeam, listWarpBeams, updateWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { openMachineRun } from "../src/services/machine-run.service";
import { machineRunTabletContext } from "../src/services/helpers/machine-run-suggest.helper";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✓" : "✗ FAIL:"} ${label}${extra ? ` — ${extra}` : ""}`);
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const status = (e: unknown) => (e instanceof AppError ? e.statusCode : -1);
const code = (e: unknown) => (e instanceof AppError ? (e.details as { code?: string } | undefined)?.code : undefined);
async function hata(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

const T = `TESTZ1${Date.now().toString(36).toUpperCase()}`;
const FLAGS = [SETTING_KEYS.DEVERE_BEAM_WEAVING_LINK_REQUIRED, SETTING_KEYS.DOKUMA_RUN_WEAVING_ORDER_REQUIRED, SETTING_KEYS.DOKUMA_ORDER_LINE_LINK_REQUIRED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.TICARET_ENABLED, SETTING_KEYS.IPLIK_ENABLED];
const ids = { item: "", yarn: "", spec: "", spec2: "", customer: "", order: "", line1: "", line2: "", station: "", machine: "" };
const weavingOrderIds: string[] = [];
const beamIds: string[] = [];
let foto: Array<{ key: string; value: Prisma.JsonValue }> = [];

async function bayrak(key: string, value: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
async function isEmri(extra: Record<string, unknown> = {}, kind: WeavingExecutionKind = WeavingExecutionKind.IN_HOUSE) {
  const r = await createWeavingOrder({ itemId: ids.item, executionKind: kind, warpSpecId: ids.spec, plannedM: 500, ...(kind === WeavingExecutionKind.SUBCONTRACTED ? { subcontractorId: (await prisma.subcontractor.findFirst({ where: { code: `${T}-F` }, select: { id: true } }))!.id } : {}), ...extra });
  weavingOrderIds.push(r.data.id);
  return r.data;
}
async function levent(extra: Record<string, unknown> = {}) {
  const r = await createWarpBeam({ warpSpecId: ids.spec, plannedLengthM: 100, originKind: WarpBeamOrigin.PURCHASED, supplierId: ids.customer, ...extra });
  beamIds.push(r.data.id);
  return r;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU: ${engel}`);
  foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  try {
    console.log("\n§0 bayrak varsayılanları");
    await prisma.systemSetting.deleteMany({ where: { key: { in: FLAGS.slice(0, 3) } } });
    const ff = (await systemSettingService.getFeatureFlags()).data;
    check("⭐ üç bayrak yükte var ve varsayılan FALSE (satır yok)", ff.devereBeamWeavingLinkRequired === false && ff.dokumaRunWeavingOrderRequired === false && ff.dokumaOrderLineLinkRequired === false, JSON.stringify({ a: ff.devereBeamWeavingLinkRequired, b: ff.dokumaRunWeavingOrderRequired, c: ff.dokumaOrderLineLinkRequired }));
    check("§3.6 resolver'lar satır yokken false (kapı koşmaz)", !(await resolveBeamWeavingLinkRequired()) && !(await resolveRunWeavingOrderRequired()) && !(await resolveOrderLineLinkRequired()));
    // Kapıların ölçülebilmesi için modüller açık (bayrak upsert'leri TRY içinde; finally geri yükler).
    await bayrak(SETTING_KEYS.PRODUCTION_ENABLED, true);
    await bayrak(SETTING_KEYS.DOKUMA_ENABLED, true);
    // Devere ETKİN değeri ticaret+iplik+devere (`requireDevereEnabled` zinciri) — resolver aynı zinciri okur.
    await bayrak(SETTING_KEYS.TICARET_ENABLED, true);
    await bayrak(SETTING_KEYS.IPLIK_ENABLED, true);
    await bayrak(SETTING_KEYS.DEVERE_ENABLED, true);

    // fikstür
    const yarn = await prisma.item.create({ data: { code: `${T}-IP`, name: `${T} iplik`, itemType: ItemType.YARN, unit: "KG", linearDensityDen: 300 }, select: { id: true } });
    ids.yarn = yarn.id;
    ids.item = (await prisma.item.create({ data: { code: `${T}-K`, name: `${T} kumaş`, itemType: ItemType.FABRIC }, select: { id: true } })).id;
    ids.spec = (await prisma.warpSpec.create({ data: { code: `${T}-CK`, name: `${T} çözgü`, yarnItemId: yarn.id, endsCount: 3000 }, select: { id: true } })).id;
    ids.spec2 = (await prisma.warpSpec.create({ data: { code: `${T}-CK2`, name: `${T} çözgü 2`, yarnItemId: yarn.id, endsCount: 2800 }, select: { id: true } })).id;
    ids.customer = (await prisma.customer.create({ data: { code: `${T}-M`, name: `${T} Müşteri`, isCustomerRole: true, isSupplierRole: true }, select: { id: true } })).id;
    await prisma.subcontractor.create({ data: { code: `${T}-F`, name: `${T} Fason` } });
    const order = await prisma.order.create({ data: { orderNumber: `${T}-SIP`, customerId: ids.customer, status: OrderStatus.APPROVED, lines: { create: [{ itemId: ids.item, quantity: 300 }, { itemId: ids.item, quantity: 200 }] } }, select: { id: true, lines: { select: { id: true }, orderBy: { createdAt: "asc" } } } });
    ids.order = order.id;
    ids.line1 = order.lines[0]!.id;
    ids.line2 = order.lines[1]!.id;
    const st = await prisma.station.create({ data: { name: `${T}-DOKUMA`, code: `${T}-DK`.slice(0, 32), type: StationType.INTERNAL, consumesWarpBeam: true }, select: { id: true } });
    ids.station = st.id;
    // Üç hat: koşumlar bekçi gövdesinde SİLİNMEZ (defter satırı — §10b2), her açılış ayrı hatta; temizlik `temizle`de.
    ids.machine = (await prisma.machine.create({ data: { stationId: st.id, name: `${T}-T1`, code: `${T}-T1`.slice(0, 32), warpBeamSlots: 2, productionLineCount: 3 }, select: { id: true } })).id;

    console.log("\n§1 nullable doğuş (eski istemci alanı göndermez)");
    const wo0 = await isEmri();
    check("⭐ dokuma işi `orderLines` vermeden → boş dizi, orderLineCount 0 (stoka dokuma meşru)", wo0.orderLines.length === 0 && wo0.orderLineCount === 0 && wo0.warpBeamCount === 0);
    const b0 = await levent();
    check("⭐ levent `weavingOrderId` vermeden → null (serbest levent meşru), uyarı yok", b0.data.weavingOrderId === null && b0.data.weavingOrder === null && !b0.warnings);
    const run0 = await openMachineRun({ machineId: ids.machine, productionLineNo: 1 });
    check("⭐ koşum işsiz açılır (bayrak kapalı = bugünkü davranış)", run0.data.weavingOrderId === null);

    console.log("\n§2 Y1 pivot — sipariş satırı bağları");
    const wo1 = await isEmri({ orderLines: [{ orderLineId: ids.line1, allocatedM: 300 }, { orderLineId: ids.line2 }] });
    check("⭐ create ile iki bağ; allocatedM sayı/null; orderLine projeksiyonu (order no · müşteri · kumaş)", wo1.orderLines.length === 2 && wo1.orderLines[0]!.allocatedM === 300 && wo1.orderLines[1]!.allocatedM === null && wo1.orderLines[0]!.orderLine.order.orderNumber === `${T}-SIP` && wo1.orderLines[0]!.orderLine.order.customer.name.toUpperCase().includes(T) && wo1.orderLines[0]!.orderLine.item.id === ids.item, JSON.stringify(wo1.orderLines.map((l) => l.allocatedM)));
    const wo1u = await updateWeavingOrder(wo1.id, { orderLines: [{ orderLineId: ids.line2, allocatedM: "150.5" }] });
    check("⭐ update `orderLines` → küme REPLACE (③b): tek bağ kaldı, metre 150.5", wo1u.data.orderLines.length === 1 && wo1u.data.orderLines[0]!.orderLineId === ids.line2 && wo1u.data.orderLines[0]!.allocatedM === 150.5);
    const wo1n = await updateWeavingOrder(wo1.id, { notes: "not" });
    check("`orderLines` alanı yoksa bağlara DOKUNULMAZ", wo1n.data.orderLines.length === 1);
    const wo1c = await updateWeavingOrder(wo1.id, { orderLines: [] });
    check("`orderLines: []` bağları temizler", wo1c.data.orderLines.length === 0);
    const eDup = await hata(() => isEmri({ orderLines: [{ orderLineId: ids.line1 }, { orderLineId: ids.line1 }] }));
    check("aynı satır iki kez → 400", status(eDup) === 400, msg(eDup));
    const eYok = await hata(() => isEmri({ orderLines: [{ orderLineId: "00000000-0000-0000-0000-000000000000" }] }));
    check("olmayan satır → 400 ORDER_LINE_NOT_FOUND", status(eYok) === 400 && code(eYok) === "ORDER_LINE_NOT_FOUND", msg(eYok));
    await prisma.orderLine.update({ where: { id: ids.line2 }, data: { cancelledAt: new Date() } });
    const eIptal = await hata(() => isEmri({ orderLines: [{ orderLineId: ids.line2 }] }));
    check("iptal edilmiş satır → 400 ORDER_LINE_CANCELLED", status(eIptal) === 400 && code(eIptal) === "ORDER_LINE_CANCELLED", msg(eIptal));
    await prisma.orderLine.update({ where: { id: ids.line2 }, data: { cancelledAt: null } });
    const eNeg = await hata(() => isEmri({ orderLines: [{ orderLineId: ids.line1, allocatedM: -1 }] }));
    check("negatif metre → 400", status(eNeg) === 400, msg(eNeg));
    await updateWeavingOrder(wo1.id, { orderLines: [{ orderLineId: ids.line1 }] });
    const byLine = (await listWeavingOrders({ orderLineId: ids.line1, limit: 100 })).data.map((r) => r.id);
    const byOrder = (await listWeavingOrders({ orderId: ids.order, limit: 100 })).data.map((r) => r.id);
    check("⭐ liste süzgeci orderLineId / orderId → bağlı iş var, bağsız iş yok", byLine.includes(wo1.id) && !byLine.includes(wo0.id) && byOrder.includes(wo1.id) && !byOrder.includes(wo0.id));

    console.log("\n§3 Y2 levent → dokuma işi");
    const b1 = await levent({ weavingOrderId: wo1.id });
    check("⭐ create ile bağ: DTO weavingOrder {id, no}; aynı çözgü kartı → uyarı yok", b1.data.weavingOrderId === wo1.id && b1.data.weavingOrder?.weavingOrderNumber === wo1.weavingOrderNumber && !b1.warnings);
    const b2 = await levent({ weavingOrderId: wo1.id, warpSpecId: ids.spec2 });
    check("⭐ çözgü kartı işinkinden FARKLI → kayıt alındı + warnings [WARP_SPEC_MISMATCH] (red değil)", b2.data.weavingOrderId === wo1.id && (b2.warnings ?? []).some((w) => w.includes("[WARP_SPEC_MISMATCH]")), JSON.stringify(b2.warnings));
    const woSub = await isEmri({}, WeavingExecutionKind.SUBCONTRACTED);
    const eSub = await hata(() => levent({ weavingOrderId: woSub.id }));
    check("fasona verilen işe levent → 400 WEAVING_ORDER_NOT_LINKABLE", status(eSub) === 400 && code(eSub) === "WEAVING_ORDER_NOT_LINKABLE", msg(eSub));
    const woKapali = await isEmri();
    await cancelWeavingOrder(woKapali.id, "bekçi");
    const eKapali = await hata(() => levent({ weavingOrderId: woKapali.id }));
    check("iptal edilmiş işe levent → 400 WEAVING_ORDER_NOT_LINKABLE", status(eKapali) === 400 && code(eKapali) === "WEAVING_ORDER_NOT_LINKABLE", msg(eKapali));
    const detay = await getWeavingOrder(wo1.id);
    check("dokuma işi detayı warpBeamCount 2, producedRollCount 0 (Y3 türetme; kolon yok)", detay.data.warpBeamCount === 2 && detay.data.producedRollCount === 0, `${detay.data.warpBeamCount}/${detay.data.producedRollCount}`);
    const byWo = (await listWarpBeams({ weavingOrderId: wo1.id, limit: 100 })).data.map((r) => r.id);
    check("levent listesi weavingOrderId süzgeci → bağlı 2, serbest levent yok", byWo.includes(b1.data.id) && byWo.includes(b2.data.id) && !byWo.includes(b0.data.id));
    const b0u = await updateWarpBeam(b0.data.id, { weavingOrderId: wo1.id });
    check("PLANNED levent PATCH ile bağlanır", b0u.data.weavingOrderId === wo1.id);
    await updateWarpBeam(b0.data.id, { weavingOrderId: null });
    const b3 = await levent();
    const wind3 = await windWarpBeam(b3.data.id, { lengthM: 100, kgSource: "THEORETICAL", weavingOrderId: wo1.id });
    const b3row = await prisma.warpBeam.findUniqueOrThrow({ where: { id: b3.data.id }, select: { weavingOrderId: true, status: true } });
    check("⭐ sarımda gövde `weavingOrderId` plana yazıldı (READY + bağ)", b3row.weavingOrderId === wo1.id && b3row.status === WarpBeamStatus.READY && wind3.success);

    console.log("\n§4 zorunlu kip (üç bayrak AÇIK)");
    await bayrak(SETTING_KEYS.DEVERE_BEAM_WEAVING_LINK_REQUIRED, true);
    await bayrak(SETTING_KEYS.DOKUMA_RUN_WEAVING_ORDER_REQUIRED, true);
    await bayrak(SETTING_KEYS.DOKUMA_ORDER_LINE_LINK_REQUIRED, true);
    const b4 = await levent();
    const eBeam = await hata(() => windWarpBeam(b4.data.id, { lengthM: 50, kgSource: "THEORETICAL" }));
    check("⭐ işsiz SARIM → 400 BEAM_WEAVING_LINK_REQUIRED (plan serbest, defter anı kapılı)", status(eBeam) === 400 && code(eBeam) === "BEAM_WEAVING_LINK_REQUIRED", msg(eBeam));
    const okBeam = await windWarpBeam(b4.data.id, { lengthM: 50, kgSource: "THEORETICAL", weavingOrderId: wo1.id });
    check("bağlıyken sarım geçer", okBeam.success);
    const eRun = await hata(() => openMachineRun({ machineId: ids.machine, productionLineNo: 2 }));
    check("⭐ işsiz KOŞUM → 400 RUN_WEAVING_ORDER_REQUIRED", status(eRun) === 400 && code(eRun) === "RUN_WEAVING_ORDER_REQUIRED", msg(eRun));
    const okRun = await openMachineRun({ machineId: ids.machine, productionLineNo: 2, weavingOrderId: wo1.id });
    check("bağlıyken koşum açılır (iş IN_PROGRESS'e geçer)", okRun.data.weavingOrderId === wo1.id);
    const eLine = await hata(() => isEmri());
    check("⭐ satırsız DOKUMA İŞİ → 400 WEAVING_ORDER_LINE_REQUIRED", status(eLine) === 400 && code(eLine) === "WEAVING_ORDER_LINE_REQUIRED", msg(eLine));
    const okLine = await isEmri({ orderLines: [{ orderLineId: ids.line1 }] });
    check("bağlıyken dokuma işi açılır; `orderLines: []` ile temizlemek de 400", okLine.orderLines.length === 1 && status(await hata(() => updateWeavingOrder(okLine.id, { orderLines: [] }))) === 400);
    await bayrak(SETTING_KEYS.DOKUMA_ENABLED, false);
    await bayrak(SETTING_KEYS.DEVERE_ENABLED, false);
    check("modül KAPALIYKEN kapı koşmaz (§3.6 etkin değer): üç resolver false (dokuma/devere kapalı, bayraklar açık)", !(await resolveOrderLineLinkRequired()) && !(await resolveRunWeavingOrderRequired()) && !(await resolveBeamWeavingLinkRequired()));
    await bayrak(SETTING_KEYS.DOKUMA_ENABLED, true);
    await bayrak(SETTING_KEYS.DEVERE_ENABLED, true);
    await bayrak(SETTING_KEYS.DEVERE_BEAM_WEAVING_LINK_REQUIRED, false);
    await bayrak(SETTING_KEYS.DOKUMA_RUN_WEAVING_ORDER_REQUIRED, false);
    await bayrak(SETTING_KEYS.DOKUMA_ORDER_LINE_LINK_REQUIRED, false);

    console.log("\n§5 tablet bağlamı — takılı leventin işi ön-dolgu");
    const bosBaglam = await machineRunTabletContext(ids.machine);
    check("takılı levent yokken öneri null, açık işler listesi IN_HOUSE açıkları taşır (fason/iptal yok)", bosBaglam.suggestedWeavingOrderId === null && bosBaglam.mountedBeam === null && bosBaglam.weavingOrders.some((w) => w.id === wo1.id) && !bosBaglam.weavingOrders.some((w) => w.id === woSub.id || w.id === woKapali.id));
    await prisma.warpBeam.update({ where: { id: b3.data.id }, data: { status: WarpBeamStatus.MOUNTED, currentMachineId: ids.machine, currentPosition: 1 } });
    const baglam = await machineRunTabletContext(ids.machine);
    check("⭐ takılı levent işe bağlı → suggestedWeavingOrderId = o iş, suggestedFrom MOUNTED_BEAM, mountedBeam no", baglam.suggestedWeavingOrderId === wo1.id && baglam.suggestedFrom === "MOUNTED_BEAM" && baglam.mountedBeam?.id === b3.data.id, JSON.stringify(baglam.mountedBeam));
    await prisma.warpBeam.update({ where: { id: b3.data.id }, data: { status: WarpBeamStatus.READY, currentMachineId: null, currentPosition: null } });
    const e5 = await hata(() => machineRunTabletContext("00000000-0000-0000-0000-000000000000"));
    check("olmayan makine → 404", status(e5) === 404);

    console.log("\n§6 Y3 kolon yok (şema taraması)");
    const schema = readFileSync(join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
    const modelBody = (name: string) => schema.slice(schema.indexOf(`model ${name} {`), schema.indexOf("\n}", schema.indexOf(`model ${name} {`)));
    check("⭐ `Roll` ve `WorkOrder`da `weavingOrderId` kolonu YOK — top→iş `weavingOrderOfRoll` ile türetilir", !/^\s*weavingOrderId\s/m.test(modelBody("Roll")) && !/^\s*weavingOrderId\s/m.test(modelBody("WorkOrder")));
    check("pivot + levent bağı şemada (yalnız ekleme)", /model WeavingOrderToOrderLine \{/.test(schema) && /^\s*weavingOrderId String\?\s+@db\.Uuid/m.test(modelBody("WarpBeam")));
  } catch (e) {
    fail++;
    console.log(`  ✗ FAIL: beklenmeyen hata — ${msg(e).slice(0, 300)}`);
  } finally {
    await temizle();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
}

async function temizle(): Promise<void> {
  if (ids.station) await prisma.machineRun.deleteMany({ where: { machine: { stationId: ids.station } } });
  if (beamIds.length > 0) {
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
  }
  if (weavingOrderIds.length > 0) {
    await prisma.weavingOrderToOrderLine.deleteMany({ where: { weavingOrderId: { in: weavingOrderIds } } });
    await prisma.weavingOrder.deleteMany({ where: { id: { in: weavingOrderIds } } });
  }
  if (ids.order) {
    await prisma.orderLine.deleteMany({ where: { orderId: ids.order } });
    await prisma.order.deleteMany({ where: { id: ids.order } });
  }
  if (ids.station) {
    await prisma.machine.deleteMany({ where: { stationId: ids.station } });
    await prisma.station.deleteMany({ where: { id: ids.station } });
  }
  await prisma.warpSpec.deleteMany({ where: { code: { startsWith: T } } });
  await prisma.item.deleteMany({ where: { code: { startsWith: T } } });
  await prisma.subcontractor.deleteMany({ where: { code: { startsWith: T } } });
  await prisma.customer.deleteMany({ where: { code: { startsWith: T } } });
  for (const key of FLAGS) {
    const eski = foto.find((f) => f.key === key);
    if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
