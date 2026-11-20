// =============================================================================
// FASON DEVERE H1 — kapanış varsayılanı ayarı (`devere.settleDefault`) · iplik sevk/iade koli-bobin bilgi alanları
// =============================================================================
// Fikstür: kart x/y/z (3000×150, 2400×150, 1800×300 den), sabit fire 50 m → 1 × 1000 m'de brüt−net 2,5 / 2 / 3 kg.
//   Ayar yok → A1-a bayt-aynı (fire = brüt − net, kalanı kalır), `defaultMode` WASTE_UP_TO_PLAN, özet "A1-a"
//   KEEP hepsi kalır · RETURN hepsi iade (sebep gövdeden; gövdesiz sebepsiz kapanış 400) · WASTE_ALL hepsi fire
//   Gövdesiz kapanış önizlemeyle aynı kipi yazar · satırlı önizleme ayardan etkilenmez · çöp ayar → varsayılan
//   Koli/bobin: sevk kalemi + iade hareketi bilgi kolonu; liste/yanıt döner; kg/tutma aynı; replay imzası; Zod + DB CHECK
// NEGATİF SONDA: bkz. arşiv notu "Devere H1".
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { SETTING_KEYS, readDevereSettleDefault } from "../src/services/system-setting.service";
import { getFeatureFlags } from "../src/services/system-setting/feature-flags-read";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { dispatchWarpingOrder, type WarpingDispatchLineInput } from "../src/services/warping-order/dispatch";
import { listWarpingDispatches } from "../src/services/warping-order/dispatches-read";
import { listWarpingYarnReturns } from "../src/services/warping-order/returns-read";
import { returnRequestHash, returnWarpingYarn } from "../src/services/warping-order/yarn-return-waste";
import { receiveWarpingOrder } from "../src/services/warping-order/receive";
import { previewSettleWarpingOrder, settleWarpingOrder } from "../src/services/warping-order/settle";
import { settleRequestHash } from "../src/services/helpers/warping-settle-plan.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-FDA-${process.pid}`;
type Err = { status?: number; code?: string; msg: string };
const errOf = async (fn: () => Promise<unknown>): Promise<Err | null> => {
  try {
    await fn();
    return null;
  } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string }; message?: string; code?: string };
    return { status: x.statusCode, code: x.details?.code ?? x.code, msg: String(x.message ?? e) };
  }
};
const show = (e: Err | null) => (e ? `${e.status} ${e.code ?? ""} ${e.msg.slice(0, 120)}` : "hata yok");
const SETTING_FOTO = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY, SETTING_KEYS.DEVERE_SETTLE_DEFAULT] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
const R = "KALAN_IPLIK";

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== FASON DEVERE AYAR (H1) ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const whId = await fixtureWarehouseId();
  const yarnIds: string[] = [];
  const lotIds: string[] = [];
  const orderIds: string[] = [];
  const specIds: string[] = [];
  try {
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "true");
    await setSetting(SETTING_KEYS.DEVERE_LOT_REQUIRED, "false");
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE");
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.DEVERE_SETTLE_DEFAULT } });
    await reconcileReasonPresets();

    const mkYarn = async (k: string, den: number) => {
      const y = await prisma.item.create({ data: { code: `${TAG}-${k}`, name: `${TAG} iplik ${k}`, itemType: "YARN", unit: "KG", linearDensityDen: den }, select: { id: true } });
      yarnIds.push(y.id);
      const l = await prisma.yarnLot.create({ data: { itemId: y.id, lotNo: `${TAG}-${k}L` }, select: { id: true } });
      lotIds.push(l.id);
      await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: y.id, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg: 1000, lotId: l.id, reason: `${TAG} giriş` }));
      return { id: y.id, lot: l.id };
    };
    const X = await mkYarn("X", 150);
    const Y = await mkYarn("Y", 150);
    const Z = await mkYarn("Z", 300);
    const spec = await prisma.warpSpec.create({
      data: { code: `${TAG}-XYZ`, name: `${TAG} XYZ`, yarnItemId: X.id, endsCount: 7200, yarns: { create: [[X.id, 3000], [Y.id, 2400], [Z.id, 1800]].map(([yarnItemId, endsCount], sortOrder) => ({ yarnItemId: yarnItemId as string, endsCount: endsCount as number, sortOrder })) } },
      select: { id: true },
    });
    specIds.push(spec.id);
    const newOrder = async () => {
      const r = await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 50, wasteTolerancePct: 5, clientToken: randomUUID(), warpSpecId: spec.id, beamLines: [{ beamCount: 1, beamLengthM: 1000 }] }, U);
      orderIds.push(r.data.id);
      return r.data.id;
    };
    type L = [{ id: string; lot: string }, number, number?, number?];
    const lineOf = ([y, qtyKg, packageCount, bobbinCount]: L): WarpingDispatchLineInput => ({ yarnItemId: y.id, warehouseId: whId, lotId: y.lot, qtyKg, ...(packageCount !== undefined ? { packageCount } : {}), ...(bobbinCount !== undefined ? { bobbinCount } : {}) });
    const send = (orderId: string, lines: L[], clientToken: string = randomUUID()) => dispatchWarpingOrder(orderId, { clientToken, lines: lines.map(lineOf) }, U);
    const receive = (orderId: string) => receiveWarpingOrder(orderId, { clientToken: randomUUID(), deliveryNoteNo: "IRS-H1", beams: [{ lengthM: 1000 }] }, U);
    // Sipariş: X 60, Y 50, Z 70 → 1000 m döner → tutma X 10 · Y 10 · Z 10 (nominal 50/40/60).
    const ready = async () => {
      const id = await newOrder();
      await send(id, [[X, 60], [Y, 50], [Z, 70]]);
      await receive(id);
      return id;
    };
    const yarnRow = (pv: Awaited<ReturnType<typeof previewSettleWarpingOrder>>, y: { id: string }) => pv.plan.yarns.find((v) => v.yarnItemId === y.id)!;
    const triple = (pv: Awaited<ReturnType<typeof previewSettleWarpingOrder>>) => [X, Y, Z].map((y) => { const r = yarnRow(pv, y); return `${r.returnKg}/${r.wasteKg}/${r.keepKg}`; }).join(" ");

    // ── 1. Ayar yok → A1-a bayt-aynı ─────────────────────────────────────────
    const A = await ready();
    const pvA = await previewSettleWarpingOrder(A);
    const flags = await getFeatureFlags();
    check("Varsayılan (kayıt yok): okuyucu + bayrak yükü WASTE_UP_TO_PLAN", (await readDevereSettleDefault()) === "WASTE_UP_TO_PLAN" && flags.data?.devereSettleDefault === "WASTE_UP_TO_PLAN", String(flags.data?.devereSettleDefault));
    check("Varsayılan önizleme A1-a: iade/fire/kalır X 0/2,5/7,5 · Y 0/2/8 · Z 0/3/7; defaultMode WASTE_UP_TO_PLAN", pvA.plan.isDefault && pvA.plan.defaultMode === "WASTE_UP_TO_PLAN" && triple(pvA) === "0.000/2.500/7.500 0.000/2.000/8.000 0.000/3.000/7.000", `${pvA.plan.defaultMode} ${triple(pvA)}`);
    check("Gövdesiz özet A1-a H1 öncesiyle bayt-aynı (kip parametresiz = WASTE_UP_TO_PLAN)", settleRequestHash({}) === settleRequestHash({}, "WASTE_UP_TO_PLAN") && settleRequestHash({}) !== settleRequestHash({}, "KEEP"));

    // ── 2. KEEP ───────────────────────────────────────────────────────────────
    await setSetting(SETTING_KEYS.DEVERE_SETTLE_DEFAULT, "KEEP");
    const pvK = await previewSettleWarpingOrder(A);
    check("KEEP: önizleme hepsi kalır (iade 0, fire 0); defaultMode KEEP", pvK.plan.defaultMode === "KEEP" && triple(pvK) === "0.000/0.000/10.000 0.000/0.000/10.000 0.000/0.000/10.000", triple(pvK));
    const pvKx = await previewSettleWarpingOrder(A, { lines: [] });
    check("Satırlı (boş liste) önizleme ayardan etkilenmez: defaultMode null, isDefault false", !pvKx.plan.isDefault && pvKx.plan.defaultMode === null, String(pvKx.plan.defaultMode));
    const sK = await settleWarpingOrder(A, { clientToken: randomUUID() }, U);
    const wastesA = await prisma.warpingYarnWaste.count({ where: { warpingOrderId: A } });
    const setA = await prisma.warpingOrderSettlement.findFirstOrThrow({ where: { warpingOrderId: A }, select: { requestHash: true } });
    check("KEEP gövdesiz kapanış: fire satırı yok, iade yok, özet DEFAULT:KEEP", wastesA === 0 && sK.totalReturnKg === "0.000" && sK.totalWasteKg === "0.000" && setA.requestHash === settleRequestHash({}, "KEEP"), `${wastesA} ${sK.totalReturnKg} ${sK.totalWasteKg}`);

    // ── 3. RETURN ─────────────────────────────────────────────────────────────
    await setSetting(SETTING_KEYS.DEVERE_SETTLE_DEFAULT, "RETURN");
    const B = await ready();
    const pvR = await previewSettleWarpingOrder(B);
    check("RETURN: önizleme hepsi iade (fire 0, kalır 0); defaultMode RETURN", pvR.plan.defaultMode === "RETURN" && triple(pvR) === "10.000/0.000/0.000 10.000/0.000/0.000 10.000/0.000/0.000", triple(pvR));
    const eR = await errOf(() => settleWarpingOrder(B, { clientToken: randomUUID() }, U));
    const stB = await prisma.warpingOrder.findUniqueOrThrow({ where: { id: B }, select: { status: true } });
    check("RETURN gövdesiz kapanış sebepsiz 400 WARPING_SETTLE_RETURN_REASON; sipariş açık kalır (tx geri)", eR?.code === "WARPING_SETTLE_RETURN_REASON" && stB.status === "IN_PROGRESS", `${show(eR)} ${stB.status}`);
    const sR = await settleWarpingOrder(B, { clientToken: randomUUID(), returnReasonCode: R }, U);
    check("RETURN gövdesiz kapanış sebeple: 30 kg iade (üç iade hareketi), fire 0", sR.totalReturnKg === "30.000" && sR.totalWasteKg === "0.000" && sR.returns.length === 3, `${sR.totalReturnKg} ${sR.returns.length}`);

    // ── 4. WASTE_ALL ──────────────────────────────────────────────────────────
    await setSetting(SETTING_KEYS.DEVERE_SETTLE_DEFAULT, "WASTE_ALL");
    const C = await ready();
    const pvW = await previewSettleWarpingOrder(C);
    check("WASTE_ALL: önizleme hepsi fire; tolerans (5) aşımı uyarılır", pvW.plan.defaultMode === "WASTE_ALL" && triple(pvW) === "0.000/10.000/0.000 0.000/10.000/0.000 0.000/10.000/0.000" && pvW.plan.overTolerance && pvW.warnings.length > 0, `${triple(pvW)} ${pvW.warnings.length}`);
    const pvWl = await previewSettleWarpingOrder(C, { lines: [{ dispatchItemId: pvW.plan.lines[0]!.dispatchItemId, wasteKg: 1 }] });
    check("Satırlı önizleme kullanıcının bölüşümü (WASTE_ALL'dan etkilenmez)", Number(pvWl.plan.yarns.reduce((s, y) => s + Number(y.wasteKg), 0)) === 1, triple(pvWl));

    // ── 5. Çöp ayar → varsayılan ──────────────────────────────────────────────
    await setSetting(SETTING_KEYS.DEVERE_SETTLE_DEFAULT, "COP");
    const pvG = await previewSettleWarpingOrder(C);
    check("Tanınmayan ayar değeri → WASTE_UP_TO_PLAN (includes sigortası)", (await readDevereSettleDefault()) === "WASTE_UP_TO_PLAN" && pvG.plan.defaultMode === "WASTE_UP_TO_PLAN" && triple(pvG) === triple(pvA), triple(pvG));
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.DEVERE_SETTLE_DEFAULT } });

    // ── 6. Koli / bobin: sevk ─────────────────────────────────────────────────
    const D = await newOrder();
    const tokD = randomUUID();
    const dD = await send(D, [[X, 40, 4, 48], [Y, 50]], tokD);
    const itX = dD.yarnItems.find((i) => i.yarnItemId === X.id)!;
    const itY = dD.yarnItems.find((i) => i.yarnItemId === Y.id)!;
    check("Sevk yanıtı: X koli 4 bobin 48 · Y adetsiz null", itX.packageCount === 4 && itX.bobbinCount === 48 && itY.packageCount === null && itY.bobbinCount === null, JSON.stringify([itX.packageCount, itX.bobbinCount, itY.packageCount]));
    const row = (await listWarpingDispatches(D)).find((d) => d.dispatchId === dD.dispatch.id)!;
    const rX = row.items.find((i) => i.dispatchItemId === itX.dispatchItemId)!;
    check("Sevk listesi: kalem koli/bobin + Σ (girilenler) 4 / 48; kg BRÜT değişmez (40 + 50)", rX.packageCount === 4 && rX.bobbinCount === 48 && row.totalPackageCount === 4 && row.totalBobbinCount === 48 && row.totalOutKg === "90.000", JSON.stringify([row.totalPackageCount, row.totalBobbinCount, row.totalOutKg]));
    const outMv = await prisma.yarnMovement.findFirstOrThrow({ where: { dispatchItemId: itX.dispatchItemId, kind: YarnMovementKind.SUBCONTRACT_OUT }, select: { qtyKg: true } });
    check("İplik defteri: çıkış hareketi kg 40 (koli bilgisi defteri değiştirmez)", Number(outMv.qtyKg) === 40, String(outMv.qtyKg));
    const replay = await send(D, [[X, 40, 4, 48], [Y, 50]], tokD);
    const eCol = await errOf(() => send(D, [[X, 40, 5, 48], [Y, 50]], tokD));
    check("Sevk replay: aynı gövde aynı belge · aynı token farklı koli 409", replay.replayed && replay.dispatch.id === dD.dispatch.id && eCol?.status === 409, show(eCol));
    const noCount = await send(D, [[Z, 10]]);
    const rowZ = (await listWarpingDispatches(D)).find((d) => d.dispatchId === noCount.dispatch.id)!;
    check("Adetsiz sevk: Σ koli/bobin null (0 değil)", rowZ.totalPackageCount === null && rowZ.totalBobbinCount === null, JSON.stringify([rowZ.totalPackageCount, rowZ.totalBobbinCount]));

    // ── 7. Koli / bobin: iade ─────────────────────────────────────────────────
    const tokR = randomUUID();
    const rt = await returnWarpingYarn(D, { dispatchItemId: itX.dispatchItemId, qtyKg: 5, reasonCode: R, packageCount: 1, bobbinCount: 6, clientToken: tokR }, U);
    const retRow = (await listWarpingYarnReturns(D)).find((r) => r.movementId === rt.movementId)!;
    const retMv = await prisma.yarnMovement.findUniqueOrThrow({ where: { id: rt.movementId }, select: { qtyKg: true, packageCount: true, bobbinCount: true } });
    check("İade: hareket + iade listesi koli 1 bobin 6; kg 5; tutma 35", retRow.packageCount === 1 && retRow.bobbinCount === 6 && retMv.packageCount === 1 && retMv.bobbinCount === 6 && Number(retMv.qtyKg) === 5 && rt.holdingKg === "35.000", JSON.stringify([retRow.packageCount, retRow.bobbinCount, rt.holdingKg]));
    const eRc = await errOf(() => returnWarpingYarn(D, { dispatchItemId: itX.dispatchItemId, qtyKg: 5, reasonCode: R, packageCount: 2, bobbinCount: 6, clientToken: tokR }, U));
    check("İade replay: aynı token farklı koli 409", eRc?.status === 409, show(eRc));
    const base = { dispatchItemId: itX.dispatchItemId, qtyKg: 5, reasonCode: R };
    const h0 = returnRequestHash(D, base);
    // H1 öncesi formül (yeniden yazılmış): adetsiz iadenin replay özeti eski panelin kaydıyla aynı kalmalı.
    const legacy = createHash("sha256").update([D, base.dispatchItemId, "5.000", "0.000", R, "", "", ""].join("|")).digest("hex");
    check("İade özeti: adetsiz gövde H1 öncesiyle bayt-aynı · null adet aynı · adetli farklı", h0 === legacy && h0 === returnRequestHash(D, { ...base, packageCount: null, bobbinCount: null }) && h0 !== returnRequestHash(D, { ...base, packageCount: 1 }));

    // ── 8. Zod + DB CHECK ─────────────────────────────────────────────────────
    const routes = fs.readFileSync(path.join(__dirname, "../src/routes/warping-order.routes.ts"), "utf8");
    const yroutes = fs.readFileSync(path.join(__dirname, "../src/routes/warping-order-yarn.routes.ts"), "utf8");
    const zodOk = /const PieceCount = [^\n]*\.int\([^\n]*\.positive\(/.test(routes) && /packageCount: PieceCount\("Koli adedi"\)/.test(routes) && /packageCount: PieceCount\("Koli adedi"\)/.test(yroutes) && /bobbinCount: PieceCount\("Bobin adedi"\)/.test(yroutes);
    check("Zod: sevk ve iade şemalarında koli/bobin tam sayı + pozitif (isteğe bağlı)", zodOk);
    const eDb1 = await errOf(() => prisma.subcontractorDispatchItem.update({ where: { id: itX.dispatchItemId }, data: { packageCount: 0 } }));
    const eDb2 = await errOf(() => prisma.subcontractorDispatchItem.update({ where: { id: itX.dispatchItemId }, data: { bobbinCount: -1 } }));
    const eDb3 = await errOf(() => prisma.$executeRaw`UPDATE "yarn_movements" SET "packageCount" = 0 WHERE "id" = ${rt.movementId}::uuid`);
    check("DB CHECK: sevk kalemi koli 0 · bobin −1 · iade hareketi koli 0 reddedilir", [eDb1, eDb2, eDb3].every((e) => e !== null), [eDb1, eDb2, eDb3].map((e) => (e ? "✗" : "geçti")).join(","));
  } finally {
    const beamIds = (await prisma.warpBeam.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } })).map((b) => b.id);
    const ds = await prisma.subcontractorDispatch.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } });
    const dids = ds.map((d) => d.id);
    await prisma.warpingYarnWaste.deleteMany({ where: { warpingOrderId: { in: orderIds }, reversesId: { not: null } } });
    await prisma.warpingYarnWaste.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderSettlement.deleteMany({ where: { warpingOrderId: { in: orderIds }, reversesId: { not: null } } });
    await prisma.warpingOrderSettlement.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingYarnTransfer.deleteMany({ where: { OR: [{ fromWarpingOrderId: { in: orderIds } }, { toWarpingOrderId: { in: orderIds } }], reversesId: { not: null } } });
    await prisma.warpingYarnTransfer.deleteMany({ where: { OR: [{ fromWarpingOrderId: { in: orderIds } }, { toWarpingOrderId: { in: orderIds } }] } });
    await prisma.warpBeamYarnAllocation.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds }, reversesEventId: { not: null } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: { in: [...dids, ...beamIds] } } }).catch(() => undefined);
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.yarnMovement.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.yarnStock.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dids } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dids } } });
    await prisma.warpingOrderToOrder.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderYarn.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderExtraSpec.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...dids, ...beamIds] } } });
    await prisma.warpSpec.deleteMany({ where: { id: { in: specIds } } });
    await prisma.yarnLot.deleteMany({ where: { id: { in: lotIds } } });
    await prisma.item.deleteMany({ where: { id: { in: yarnIds } } });
    for (const key of SETTING_FOTO) {
      const f = foto.find((s) => s.key === key);
      if (f) await prisma.systemSetting.update({ where: { key }, data: { value: f.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
  await pool.end();
}

main().catch(async (e) => {
  console.error("💥", e);
  process.exitCode = 1;
  await pool.end();
});
