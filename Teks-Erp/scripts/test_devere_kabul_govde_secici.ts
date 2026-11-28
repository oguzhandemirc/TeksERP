// =============================================================================
// DEVERE KABULÜ — GÖVDE SEÇİCİSİ + "DEVERECİ ELİNDEKİ GÖVDELERİMİZ" (devere D3, 2026-11-28)
// =============================================================================
//   §0 tek kaynak: seçici ve devereci kırılımı aynı "deverecide" yüklemini (`beamBodyAtWarperWhere`) okur
//   §1 seçici: bu siparişle gidenler önce · önceden deverecide olan sonra · iptal edilmiş gidiş düşer · başka devereci düşer
//      · `sent` kümesi canlı gidişler · başka siparişle giden "bu siparişle" sayılmaz
//   §2 görünüm: devereci × gövde, deverecinin KENDİ gövdesi yok, gidiş belgesi/sipariş no dolu, sayılar sunucuda
//   §3 farklı gövdeyle kabul (OPTIONAL) geçer; giden gövde deverecide kalır, kabul edilen seçiciden düşer
//   §4 gövde takibi OFF → seçici 403 BEAM_BODY_MODE_OFF
// NEGATİF SONDA: `at-warper.ts` `listReceiveBodyOptions` gidiş sorgusundan `reversal: { is: null }` çıkarılınca §1c KIRMIZI (2026-11-28).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BeamBodyOwnerRole, BeamBodyStatus, Prisma, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA, TEST_SANDING } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { dispatchWarpingOrder } from "../src/services/warping-order/dispatch";
import { cancelWarpingDispatch } from "../src/services/warping-order/dispatch-cancel";
import { receiveWarpingOrder } from "../src/services/warping-order/receive";
import { createBeamBody } from "../src/services/beam-body/write";
import { listBodiesAtWarpers, listReceiveBodyOptions } from "../src/services/beam-body/at-warper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-DKGS-${process.pid}`;
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
const show = (e: Err | null) => (e ? `${e.status} ${e.code ?? ""} ${e.msg.slice(0, 160)}` : "hata yok");
const SETTING_FOTO = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY, SETTING_KEYS.DEVERE_BEAM_BODY_MODE] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== DEVERE KABULÜ GÖVDE SEÇİCİSİ (D3) ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const sub2 = await ensureTestSubcontractor(TEST_SANDING);
  const W = await fixtureWarehouseId();
  const customerIds: string[] = [];
  const yarnIds: string[] = [];
  const lotIds: string[] = [];
  const specIds: string[] = [];
  const orderIds: string[] = [];
  const body = async (no: string, place: { subcontractorId?: string } = {}) =>
    (await createBeamBody({
      clientToken: randomUUID(), bodyNo: `${TAG}-${no}`, owner: { kind: "OURS" },
      ...(place.subcontractorId ? { initialStatus: BeamBodyStatus.AT_SUBCONTRACTOR, subcontractorId: place.subcontractorId } : { warehouseId: W }),
    }, U)).data;
  try {
    // ── §0 tek kaynak ─────────────────────────────────────────────────────
    const src = fs.readFileSync(path.join(__dirname, "../src/services/beam-body/at-warper.ts"), "utf8");
    check("§0 seçici ve devereci kırılımı aynı yüklemi okur (iki çağrı)", (src.match(/beamBodyAtWarperWhere\(/g) ?? []).length === 2);

    for (const [k, v] of [[SETTING_KEYS.DEVERE_ENABLED, "true"], [SETTING_KEYS.IPLIK_ENABLED, "true"], [SETTING_KEYS.DEVERE_LOT_REQUIRED, "false"], [SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE"], [SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OPTIONAL"]] as const) await setSetting(k, v);
    const yarn = await prisma.item.create({ data: { code: `${TAG}-Y`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } });
    yarnIds.push(yarn.id);
    const lot = await prisma.yarnLot.create({ data: { itemId: yarn.id, lotNo: `${TAG}-L` }, select: { id: true } });
    lotIds.push(lot.id);
    await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: yarn.id, warehouseId: W, kind: YarnMovementKind.IN, qtyKg: 1000, lotId: lot.id, reason: `${TAG} giriş` }));
    const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-S`, name: `${TAG} kart`, yarnItemId: yarn.id, endsCount: 3000, yarns: { create: [{ yarnItemId: yarn.id, endsCount: 3000, sortOrder: 0 }] } }, select: { id: true } });
    specIds.push(spec.id);
    const newOrder = async () => {
      const r = await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: spec.id, beamLines: [{ beamCount: 2, beamLengthM: 1000 }] }, U);
      orderIds.push(r.data.id);
      return r.data;
    };
    const send = (orderId: string, beamBodyIds: string[]) =>
      dispatchWarpingOrder(orderId, { clientToken: randomUUID(), lines: [{ yarnItemId: yarn.id, warehouseId: W, lotId: lot.id, qtyKg: 100 }], beamBodyIds }, U);

    // Fikstür: A,B S1 ile gider · C S2 ile gidip sevki iptal edilir · Z S2 ile gider (başka sipariş) · G9 önceden deverecide
    // · E başka deverecide · D deverecinin kendi gövdesi (sahip WARPER).
    const A = await body("A");
    const B = await body("B");
    const C = await body("C");
    const Z = await body("Z");
    const G9 = await body("G9", { subcontractorId: sub.id });
    const E = await body("E", { subcontractorId: sub2.id });
    const D = await body("D", { subcontractorId: sub.id });
    const cw = await prisma.customer.create({ data: { code: `${TAG}-CW`, name: `${TAG} DEVERECI CARI` }, select: { id: true } });
    customerIds.push(cw.id);
    await prisma.beamBody.update({ where: { id: D.id }, data: { ownerCustomerId: cw.id, ownerRole: BeamBodyOwnerRole.WARPER } });
    const S1 = await newOrder();
    const S2 = await newOrder();
    await send(S1.id, [A.id, B.id]);
    const dC = await send(S2.id, [C.id]);
    await cancelWarpingDispatch(S2.id, dC.dispatch.id, "yanlış gövde", U);
    await send(S2.id, [Z.id]);

    // ── §1 seçici ─────────────────────────────────────────────────────────
    const o1 = await listReceiveBodyOptions(S1.id);
    const mine = o1.options.filter((o) => o.bodyNo.startsWith(TAG));
    const nos = mine.map((o) => o.bodyNo.slice(TAG.length + 1));
    check("§1a bu siparişle gidenler önce (A,B), sonra deverecideki öteki gövdeler", nos.slice(0, 2).join() === "A,B" && mine.slice(0, 2).every((o) => o.sentWithOrder) && mine.slice(2).every((o) => !o.sentWithOrder), nos.join());
    check("§1b önceden deverecide olan G9 + deverecinin kendi D + başka siparişle giden Z listede (seçilebilir)", ["D", "G9", "Z"].every((x) => nos.includes(x)) && mine.find((o) => o.id === G9.id)?.sentWith === null);
    const oS2 = await listReceiveBodyOptions(S2.id);
    check("§1c sevki iptal edilmiş C ne seçicide ne S2'nin `sent` kümesinde (yalnız Z)", !nos.includes("C") && oS2.sent.map((s) => s.id).join() === Z.id && oS2.options[0]?.id === Z.id, oS2.sent.map((s) => s.bodyNo).join());
    check("§1d başka deverecideki E listede yok", !nos.includes("E"));
    check("§1e `sent` = A,B (deverecide, sevk no dolu) · Z başka siparişin", o1.sent.map((s) => s.id).sort().join() === [A.id, B.id].sort().join() && o1.sent.every((s) => s.atThisWarper && s.dispatchNo.length > 0) && o1.subcontractorId === sub.id);
    const zOpt = mine.find((o) => o.id === Z.id);
    check("§1f Z'nin gidişi S2'ye bağlı görünür (sipariş no + sevk no)", zOpt?.sentWith?.warpingOrderId === S2.id && zOpt.sentWith.orderNo === S2.orderNo && !zOpt.sentWithOrder);

    // ── §2 devereci elindeki gövdelerimiz ────────────────────────────────
    const v = await listBodiesAtWarpers({ subcontractorId: { in: [sub.id, sub2.id] }, search: TAG });
    const g1 = v.data.find((g) => g.subcontractor.id === sub.id);
    const g2 = v.data.find((g) => g.subcontractor.id === sub2.id);
    const g1nos = (g1?.bodies ?? []).map((b) => b.bodyNo.slice(TAG.length + 1)).join();
    check("§2a devereci 1: A,B,G9,Z (gövde no sırası) · deverecinin kendi gövdesi D yok", g1nos === "A,B,G9,Z" && g1?.count === 4, g1nos);
    check("§2b devereci 2: E · özet 5 gövde / 2 devereci (sunucu sayar)", g2?.count === 1 && v.summary.bodyCount === 5 && v.summary.warperCount === 2 && !v.truncated, JSON.stringify(v.summary));
    const aRow = g1?.bodies.find((b) => b.id === A.id);
    check("§2c A'nın gidiş belgesi S1 (sipariş no) · yaş alanı dolu", aRow?.sentWith?.orderNo === S1.orderNo && typeof aRow.statusAgeDays === "number" && Boolean(aRow.statusSince));

    // ── §3 farklı gövdeyle kabul ─────────────────────────────────────────
    const rc = await errOf(() => receiveWarpingOrder(S1.id, { clientToken: randomUUID(), deliveryNoteNo: `${TAG}-IRS`, beams: [{ lengthM: 1000, beamBodyId: G9.id }] }, U));
    check("§3a gönderilmeyen G9 ile kabul (OPTIONAL) geçer", rc === null, show(rc));
    const o2 = await listReceiveBodyOptions(S1.id);
    const after = await prisma.beamBody.findMany({ where: { id: { in: [A.id, G9.id] } }, select: { id: true, status: true, subcontractorId: true } });
    check("§3b G9 doldu, seçiciden düştü · A,B deverecide kalır ve hâlâ önce gelir",
      !o2.options.some((o) => o.id === G9.id) && o2.options.slice(0, 2).map((o) => o.id).sort().join() === [A.id, B.id].sort().join()
      && after.find((x) => x.id === G9.id)?.status === BeamBodyStatus.FULL_STOCK && after.find((x) => x.id === A.id)?.status === BeamBodyStatus.AT_SUBCONTRACTOR,
      after.map((x) => x.status).join());
    const v2 = await listBodiesAtWarpers({ subcontractorId: sub.id, search: TAG });
    check("§3c görünüm: kabul sonrası A,B,Z deverecide kalmış görünür", (v2.data[0]?.bodies ?? []).map((b) => b.bodyNo.slice(TAG.length + 1)).join() === "A,B,Z");

    // ── §4 OFF ────────────────────────────────────────────────────────────
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OFF");
    const off = await errOf(() => listReceiveBodyOptions(S1.id));
    check("§4 gövde takibi OFF → 403 BEAM_BODY_MODE_OFF", off?.status === 403 && off.code === "BEAM_BODY_MODE_OFF", show(off));
    const nf = await errOf(() => listReceiveBodyOptions(randomUUID()));
    check("§4b OFF'ta bile kapı önce gelir (var olmayan sipariş de 403)", nf?.status === 403, show(nf));
  } finally {
    const bodies = await prisma.beamBody.findMany({ where: { bodyNo: { startsWith: TAG } }, select: { id: true } });
    const bodyIds = bodies.map((x) => x.id);
    const beams = await prisma.warpBeam.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } });
    const beamIds = beams.map((b) => b.id);
    const ds = await prisma.subcontractorDispatch.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } });
    const dids = ds.map((d) => d.id);
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: bodyIds }, reversesId: { not: null } } });
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: bodyIds } } });
    await prisma.warpBeamYarnAllocation.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds }, reversesEventId: { not: null } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: { in: [...dids, ...beamIds] } } }).catch(() => undefined);
    await prisma.warpBeam.updateMany({ where: { id: { in: beamIds } }, data: { beamBodyId: null } });
    await prisma.beamBodyMachine.deleteMany({ where: { bodyId: { in: bodyIds } } });
    await prisma.beamBody.deleteMany({ where: { id: { in: bodyIds } } });
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
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...dids, ...beamIds, ...bodyIds] } } });
    await prisma.warpSpec.deleteMany({ where: { id: { in: specIds } } });
    await prisma.yarnLot.deleteMany({ where: { id: { in: lotIds } } });
    await prisma.item.deleteMany({ where: { id: { in: yarnIds } } });
    await cleanupTestCustomers(customerIds);
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
