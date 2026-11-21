// =============================================================================
// DEVERE EK-2 r — tablette levent reddi + yeniden sarım adayı + içeride sarımda gövde (GERÇEK DB, sunucusuz)
// =============================================================================
//   §1 statik: ret önizleme/ret/okutma uçları `mobile:devere-ret` kabul eder (liste/iptal/foto ekleme ETMEZ) · okutma
//      ucu `/:id`den önce · katalog satırı + DevereKabul yeteneği · gövde çözümü `mobile:devere` · sarım şeması beamBodyIds
//   §2 okutma çözümü: levent no · gövde QR (üstündeki sarım) · gövde no metni · bulunamadı 404 · devere siparişsiz sarım 409
//   §3 tablet bağlamı: kipi "yeniden sarılsın" aktif ret → reworkCandidates; "iptal" kipi aday değil; yeniden sarım
//      kabul edilince aday düşer · settings.rejectPhotoRequired
//   §4 içeride sarım + gövde: OFF'ta 403 · OPTIONAL'da gövde dolar (FULL_STOCK, üstündeki sarım, gövde no) · dolu gövde
//      409 · adet uyuşmazlığı 400 · fason köken 400 · gövdesiz bayt-aynı · REQUIRED gövdesiz 400 · iptal gövdeyi boşaltır
// NEGATİF SONDA (2026-11-22): `warp-beam-wind.service` updateMany'den `beamBodyId` çıkarılınca §4b kırmızı;
//   ret önizleme rotasında satır içi guard `requirePermission("warping-order:write")` yapılınca §1a kırmızı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { BeamBodyStatus, Prisma, StationType, WarpBeamOrigin, WarpKgSource, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { dispatchWarpingOrder } from "../src/services/warping-order/dispatch";
import { receiveWarpingOrder, type WarpingReceiveBeamInput } from "../src/services/warping-order/receive";
import { createWarpingBeamRejection } from "../src/services/warping-order/beam-rejection";
import { lookupWarpingRejectBeam } from "../src/services/warping-order/beam-rejection-lookup";
import { getWarpingTabletContext } from "../src/services/warping-order/tablet-context";
import { createBeamBody } from "../src/services/beam-body/write";
import { getBeamBody } from "../src/services/beam-body/read";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { cancelWound, windWarpBeam } from "../src/services/warp-beam-wind.service";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import { SCREEN_CATALOG } from "../src/constants/screen-catalog";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-DTR${process.pid}`;
type Err = { status?: number; code?: string; msg: string };
const errOf = async (fn: () => Promise<unknown>): Promise<Err | null> => {
  try {
    await fn();
    return null;
  } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string }; message?: string };
    return { status: x.statusCode, code: x.details?.code, msg: String(x.message ?? e) };
  }
};
const show = (e: Err | null) => (e ? `${e.status} ${e.code ?? ""} ${e.msg.slice(0, 140)}` : "hata yok");
const SETTING_FOTO = [
  SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY,
  SETTING_KEYS.DEVERE_BEAM_BODY_MODE, SETTING_KEYS.DEVERE_REJECT_PHOTO_REQUIRED,
] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
const src = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

function staticChecks(): void {
  console.log("\n=== §1 statik: izin ve uç kapıları ===");
  const r = src("src/routes/warping-beam-rejection.routes.ts");
  const G = 'requireAnyPermission\\("warping-order:write", \\.\\.\\.MOBILE_DEVERE_RET\\)';
  const retW = /const MOBILE_DEVERE_RET = \["mobile:devere-ret"\] as const;/.test(r);
  check("§1a ret önizleme · ret · okutma satır içi guard (warping-order:write | mobile:devere-ret)",
    retW && new RegExp(`router\\.post\\("/preview", ${G},`).test(r) && new RegExp(`router\\.post\\("/", ${G},`).test(r) && new RegExp(`router\\.get\\("/lookup", ${G},`).test(r));
  check("§1b liste · belge · foto ekleme · iptal tablete AÇILMAZ (yalnız web izni)",
    /router\.get\("\/", requirePermission\("warping-order:read"\)/.test(r) && /router\.post\("\/:id\/photos", requirePermission\("warping-order:write"\)/.test(r) && !/\/:id\/cancel"[^\n]*MOBILE_DEVERE_RET/.test(r));
  check("§1c okutma ucu `/:id`den ÖNCE (Express sırası)", r.indexOf('router.get("/lookup"') > 0 && r.indexOf('router.get("/lookup"') < r.indexOf('router.get("/:id"'));
  const p = PERMISSION_CATALOG.find((x) => x.code === "mobile:devere-ret");
  check("§1d katalog satırı mobile:devere-ret · MOBILE/mobile", p?.module === "MOBILE" && p.category === "mobile");
  const scr = SCREEN_CATALOG.find((e) => e.key === "DevereKabul" && e.app === "mobile");
  check("§1e DevereKabul ekranının yeteneği mobile:devere-ret", !!scr?.capabilities.some((c) => c.code === "mobile:devere-ret"));
  const bb = src("src/routes/beam-body.routes.ts");
  check("§1f gövde çözümü Levent Sarım tabletine açık (mobile:devere)", /router\.get\("\/resolve", requireAnyPermission\("beam-body:read", \.\.\.MOBILE_DEVERE_KABUL, \.\.\.MOBILE_DEVERE\)/.test(bb));
  check("§1g sarım şeması beamBodyIds (≤24 uuid)", /beamBodyIds: z\.array\(z\.string\(\)\.uuid\(\)\)\.max\(24\)/.test(src("src/routes/warp-beam.routes.ts")));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== DEVERE EK-2 r: tablette ret + yeniden sarım adayı + içeride sarımda gövde ===");
  staticChecks();
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const W = await fixtureWarehouseId();
  const yarnIds: string[] = [];
  const lotIds: string[] = [];
  const specIds: string[] = [];
  const orderIds: string[] = [];
  const stationIds: string[] = [];
  const machineIds: string[] = [];
  const inHouseBeamIds: string[] = [];
  let n = 0;
  const body = async () => (await createBeamBody({ clientToken: randomUUID(), bodyNo: `${TAG}-${++n}`, owner: { kind: "OURS" }, warehouseId: W }, U)).data;
  try {
    for (const [k, v] of [[SETTING_KEYS.DEVERE_ENABLED, "true"], [SETTING_KEYS.IPLIK_ENABLED, "true"], [SETTING_KEYS.DEVERE_LOT_REQUIRED, "false"], [SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE"],
      [SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OPTIONAL"], [SETTING_KEYS.DEVERE_REJECT_PHOTO_REQUIRED, "true"]] as const) await setSetting(k, v);
    await reconcileReasonPresets();
    const yarn = (await prisma.item.create({ data: { code: `${TAG}-Y`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } })).id;
    yarnIds.push(yarn);
    const lot = (await prisma.yarnLot.create({ data: { itemId: yarn, lotNo: `${TAG}-L` }, select: { id: true } })).id;
    lotIds.push(lot);
    await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: yarn, warehouseId: W, kind: YarnMovementKind.IN, qtyKg: 2000, lotId: lot, reason: `${TAG} giriş` }));
    const spec = (await prisma.warpSpec.create({ data: { code: `${TAG}-S`, name: `${TAG} kart`, yarnItemId: yarn, endsCount: 3000, yarns: { create: [{ yarnItemId: yarn, endsCount: 3000, sortOrder: 0 }] } }, select: { id: true } })).id;
    specIds.push(spec);
    const stDv = await prisma.station.create({ data: { name: `${TAG}-DEVERE`, code: `${TAG}-DV`.slice(0, 32), type: StationType.INTERNAL, producesWarpBeam: true }, select: { id: true } });
    stationIds.push(stDv.id);
    const dv = await prisma.machine.create({ data: { stationId: stDv.id, name: `${TAG}-D1`, code: `${TAG}-D1`.slice(0, 32) }, select: { id: true } });
    machineIds.push(dv.id);

    // ── §2 okutma çözümü ─────────────────────────────────────────────────
    console.log("\n=== §2 okutma çözümü ===");
    const ord = (await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: spec, beamLines: [{ beamCount: 6, beamLengthM: 100 }] }, U)).data.id;
    orderIds.push(ord);
    await dispatchWarpingOrder(ord, { clientToken: randomUUID(), lines: [{ yarnItemId: yarn, warehouseId: W, lotId: lot, qtyKg: 60 }] }, U);
    const receive = (beams: WarpingReceiveBeamInput[]) => receiveWarpingOrder(ord, { clientToken: randomUUID(), deliveryNoteNo: `${TAG}-DV`, beams }, U);
    const G = await body();
    const r1 = await receive([{ lengthM: 100, beamBodyId: G.id }, { lengthM: 100, physicalBeamNo: `${TAG}-SERBEST` }, { lengthM: 100 }]);
    const beams = await prisma.warpBeam.findMany({ where: { warpingReceiptKey: r1.receiptKey }, orderBy: { beamNo: "asc" }, select: { id: true, beamNo: true } });
    const [b1, b2, b3] = beams;
    const byNo = await lookupWarpingRejectBeam(b1!.beamNo.toLowerCase());
    check("§2a levent no (harf duyarsız) → sarım + sipariş + devereci + gövde no + metre", byNo.beam.id === b1!.id && byNo.order.id === ord && byNo.order.subcontractor.id === sub.id && byNo.beam.bodyNo === G.bodyNo && byNo.beam.lengthM === "100.000", JSON.stringify(byNo.beam));
    const byBody = await lookupWarpingRejectBeam(G.bodyNo);
    check("§2b gövde QR → gövdenin üstündeki sarım", byBody.beam.id === b1!.id);
    const byPhys = await lookupWarpingRejectBeam(`${TAG}-serbest`);
    check("§2c gövde no serbest metni → canlı sarım", byPhys.beam.id === b2!.id);
    const e404 = await errOf(() => lookupWarpingRejectBeam(`${TAG}-YOK`));
    check("§2d bulunamadı → 404 WARP_BEAM_NOT_FOUND", e404?.status === 404 && e404.code === "WARP_BEAM_NOT_FOUND", show(e404));

    // ── §3 tablet bağlamı: yeniden sarım adayı ───────────────────────────
    console.log("\n=== §3 yeniden sarım adayı (tablet bağlamı) ===");
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${TAG}-png`)]).toString("base64");
    await createWarpingBeamRejection({ clientToken: randomUUID(), warpingOrderId: ord, beamIds: [b1!.id], reasonCode: "TEL_KOPUK", expectRework: true, photos: [{ fileName: "a.png", contentBase64: PNG }] }, U);
    await createWarpingBeamRejection({ clientToken: randomUUID(), warpingOrderId: ord, beamIds: [b3!.id], reasonCode: "GERGI", expectRework: false, photos: [{ fileName: "b.png", contentBase64: PNG }] }, U);
    const ctx = await getWarpingTabletContext({ subcontractorId: sub.id });
    const o = ctx.orders.find((x) => x.id === ord);
    const cand = o?.reworkCandidates ?? [];
    check("§3a kipi 'yeniden sarılsın' reddedilen sarım aday; 'iptal' kipi aday DEĞİL", cand.length === 1 && cand[0]!.beamId === b1!.id && cand[0]!.bodyNo === G.bodyNo && cand[0]!.lengthM === "100.000" && /^DR-/.test(cand[0]!.rejectionDocNo), JSON.stringify(cand));
    check("§3b aday anahtarları allowlist (beamId, beamNo, bodyNo, lengthM, rejectionDocNo)", cand.every((c) => Object.keys(c).sort().join() === "beamId,beamNo,bodyNo,lengthM,rejectionDocNo"));
    check("§3c settings.rejectPhotoRequired ayarı taşır", ctx.settings.rejectPhotoRequired === true);
    await receive([{ lengthM: 100, reworkOfBeamId: b1!.id }]);
    const ctx2 = await getWarpingTabletContext({ subcontractorId: sub.id });
    check("§3d yeniden sarım kabul edilince aday düşer", (ctx2.orders.find((x) => x.id === ord)?.reworkCandidates.length ?? -1) === 0);

    // ── §4 içeride sarım + gövde ─────────────────────────────────────────
    console.log("\n=== §4 içeride sarım ↔ gövde ===");
    const planned = async (originKind: WarpBeamOrigin = WarpBeamOrigin.IN_HOUSE) => {
      const b = await createWarpBeam({ warpSpecId: spec, plannedLengthM: 100, originKind, ...(originKind === WarpBeamOrigin.SUBCONTRACT ? { subcontractorId: sub.id } : {}) }, U);
      inHouseBeamIds.push(b.data.id);
      return b.data.id;
    };
    const wind = (id: string, extra: Record<string, unknown> = {}) =>
      windWarpBeam(id, { lengthM: 100, kgSource: WarpKgSource.THEORETICAL, machineId: dv.id, yarnIssues: [{ warehouseId: W, qtyKg: 3, lotId: lot }], ...extra }, U);
    const H = await body();
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OFF");
    const p0 = await planned();
    const eOff = await errOf(() => wind(p0, { beamBodyIds: [H.id] }));
    check("§4a OFF + gövde → 403 BEAM_BODY_MODE_OFF", eOff?.status === 403 && eOff.code === "BEAM_BODY_MODE_OFF", show(eOff));
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OPTIONAL");
    await wind(p0, { beamBodyIds: [H.id] });
    const w0 = await prisma.warpBeam.findUniqueOrThrow({ where: { id: p0 }, select: { beamBodyId: true, physicalBeamNo: true } });
    const h1 = await getBeamBody(H.id);
    check("§4b ⭐ OPTIONAL: sarım gövdeye bağlı (gövde no) · gövde FULL_STOCK, üstündeki sarım bu", w0.beamBodyId === H.id && w0.physicalBeamNo === H.bodyNo && h1.status === BeamBodyStatus.FULL_STOCK && h1.currentWarpBeam?.id === p0, `${w0.beamBodyId} ${h1.status}`);
    const ev = await prisma.beamBodyEvent.findFirst({ where: { bodyId: H.id, warpBeamId: p0 }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { kind: true } });
    check("§4c gövde olayı FILLED (kanca applyWarpBeamEventTx'ten)", ev?.kind === "FILLED");
    const p1 = await planned();
    const eBusy = await errOf(() => wind(p1, { beamBodyIds: [H.id] }));
    check("§4d dolu gövde → 409 BEAM_BODY_BUSY", eBusy?.status === 409 && eBusy.code === "BEAM_BODY_BUSY", show(eBusy));
    const spare = await body();
    const eCnt = await errOf(() => wind(p1, { count: 2, beamBodyIds: [spare.id] }));
    check("§4e takım 2 levent + 1 gövde → 400 BEAM_BODY_WIND_COUNT", eCnt?.status === 400 && eCnt.code === "BEAM_BODY_WIND_COUNT", show(eCnt));
    const pS = await planned(WarpBeamOrigin.SUBCONTRACT);
    const eOrig = await errOf(() => windWarpBeam(pS, { lengthM: 100, kgSource: WarpKgSource.THEORETICAL, beamBodyIds: [spare.id] }, U));
    check("§4f fason köken + gövde → 400 BEAM_BODY_WIND_ORIGIN", eOrig?.status === 400 && eOrig.code === "BEAM_BODY_WIND_ORIGIN", show(eOrig));
    await wind(p1);
    const w1 = await prisma.warpBeam.findUniqueOrThrow({ where: { id: p1 }, select: { beamBodyId: true, status: true } });
    check("§4g OPTIONAL gövdesiz sarım bugünkü gibi (beamBodyId NULL, Hazır)", w1.beamBodyId === null && w1.status === "READY");
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "REQUIRED");
    const p2 = await planned();
    const eReq = await errOf(() => wind(p2));
    check("§4h REQUIRED + içeride gövdesiz → 400 BEAM_BODY_REQUIRED", eReq?.status === 400 && eReq.code === "BEAM_BODY_REQUIRED", show(eReq));
    await cancelWound(p0, `${TAG} iptal`, U);
    const h2 = await getBeamBody(H.id);
    check("§4i sarım iptali gövdeyi boşaltır (EMPTY_STOCK, üstünde sarım yok)", h2.status === BeamBodyStatus.EMPTY_STOCK && h2.currentWarpBeam === null, h2.status);
    const eFoto = await errOf(() => createWarpingBeamRejection({ clientToken: randomUUID(), warpingOrderId: ord, beamIds: [b2!.id], reasonCode: "TEL_KOPUK", expectRework: true }, U));
    check("§4j (ret) rejectPhotoRequired açık + fotosuz → 400 WARPING_REJECT_PHOTO_REQUIRED", eFoto?.status === 400 && eFoto.code === "WARPING_REJECT_PHOTO_REQUIRED", show(eFoto));
    const inNo = (await prisma.warpBeam.findUniqueOrThrow({ where: { id: p1 }, select: { beamNo: true } })).beamNo;
    const e409 = await errOf(() => lookupWarpingRejectBeam(inNo));
    check("§2e (okutma) içeride sarılan levent → 409 WARPING_REJECT_NOT_WARPING_BEAM", e409?.status === 409 && e409.code === "WARPING_REJECT_NOT_WARPING_BEAM", show(e409));
  } finally {
    const bodyIds = (await prisma.beamBody.findMany({ where: { bodyNo: { startsWith: TAG } }, select: { id: true } })).map((b) => b.id);
    const beamIds = (await prisma.warpBeam.findMany({ where: { OR: [{ warpingOrderId: { in: orderIds } }, { id: { in: inHouseBeamIds } }, { warpSpecId: { in: specIds } }] }, select: { id: true } })).map((b) => b.id);
    const rejIds = (await prisma.warpingBeamRejection.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } })).map((r) => r.id);
    const dids = (await prisma.subcontractorDispatch.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } })).map((d) => d.id);
    const docIds = (await prisma.warpBeam.findMany({ where: { id: { in: beamIds }, warpingReceiveDocId: { not: null } }, select: { warpingReceiveDocId: true } })).map((d) => d.warpingReceiveDocId!);
    await prisma.warpingBeamRejectionPhoto.deleteMany({ where: { rejectionId: { in: rejIds } } });
    await prisma.warpingBeamRejectionItem.deleteMany({ where: { rejectionId: { in: rejIds } } });
    await prisma.warpingBeamRejection.deleteMany({ where: { id: { in: rejIds } } });
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: bodyIds }, reversesId: { not: null } } });
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: bodyIds } } });
    await prisma.warpBeamYarnAllocation.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds }, reversesEventId: { not: null } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: { in: [...dids, ...beamIds] } } }).catch(() => undefined);
    await prisma.warpBeam.updateMany({ where: { id: { in: beamIds } }, data: { reworkOfBeamId: null, beamBodyId: null } });
    await prisma.beamBodyMachine.deleteMany({ where: { bodyId: { in: bodyIds } } });
    await prisma.beamBody.deleteMany({ where: { id: { in: bodyIds } } });
    await prisma.yarnMovement.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    if (docIds.length) await prisma.warpingReceiveDoc.deleteMany({ where: { id: { in: docIds } } }).catch(() => undefined);
    await prisma.yarnStock.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dids } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dids } } });
    await prisma.warpingOrderToOrder.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderYarn.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderExtraSpec.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...dids, ...beamIds, ...rejIds, ...bodyIds] } } });
    await prisma.machine.deleteMany({ where: { id: { in: machineIds } } });
    await prisma.station.deleteMany({ where: { id: { in: stationIds } } });
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
