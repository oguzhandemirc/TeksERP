// =============================================================================
// FASON DEVERE — panel okuma uçları (D6-be; GERÇEK DB, servis + HTTP)
// =============================================================================
//   §1 `GET /:id/dispatches`: iptal edilmiş sevk DAHİL (status CANCELLED, iptal edilemez + neden) · BRÜT çıkış · net iade ·
//      net aktarma · iptal edilebilirlik LIFO engeliyle (iade / aktarma) · listenin canCancel'ı gerçek iptalle BİREBİR
//   §2 `GET /:id/yarn-returns`: storno edilmiş iade CANCELLED + storno edilemez · açık iade storno edilebilir · sebep etiketi ·
//      aktarımla gelen kalemden iade hedef siparişte `ownDispatch=false` · listenin canCancel'ı gerçek stornoyla BİREBİR
//   §3 `yarn-at-subcontractor` ad alanları (fasoncu · iplik kodu/adı · lot · sipariş no) kimliklere EK
//   §4 HTTP: 200 (`warping-order:read`) · izinsiz 403 · iplik kapalı 403 MODULE_DISABLED · devere kapalı 403 · 404
// NEGATİF SONDA: bkz. arşiv notu "Fason devere D6-be".
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import * as bcrypt from "bcryptjs";
import { Prisma, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import app from "../src/app";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { ensureTestAdmin, kosumaOzguParola, testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { dispatchWarpingOrder, type WarpingDispatchLineInput } from "../src/services/warping-order/dispatch";
import { cancelWarpingDispatch } from "../src/services/warping-order/dispatch-cancel";
import { warpingYarnAtSubcontractors } from "../src/services/warping-order/yarn-return";
import { cancelWarpingYarnReturn, returnWarpingYarn } from "../src/services/warping-order/yarn-return-waste";
import { transferWarpingYarn } from "../src/services/warping-order/yarn-transfer";
import { listWarpingDispatches } from "../src/services/warping-order/dispatches-read";
import { listWarpingYarnReturns } from "../src/services/warping-order/returns-read";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-FDO-${process.pid}`;
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
const show = (e: Err | null) => (e ? `${e.status} ${e.code ?? ""} ${e.msg.slice(0, 100)}` : "hata yok");
const SETTING_FOTO = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.TICARET_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== FASON DEVERE OKUMA UÇLARI (D6-be) ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const whId = await fixtureWarehouseId();
  const yarnIds: string[] = [];
  const lotIds: string[] = [];
  const orderIds: string[] = [];
  const userIds: string[] = [];
  let specId = "";
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");
    await setSetting(SETTING_KEYS.TICARET_ENABLED, "true");
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "true");
    await setSetting(SETTING_KEYS.EMANET_ENABLED, "true");
    await setSetting(SETTING_KEYS.DEVERE_LOT_REQUIRED, "false");
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE");
    await reconcileReasonPresets();

    // ── Fikstür: kart X (3000 tel) + Y (2400 tel), 1 × 1000 m; iki sipariş aynı devereci ────────────
    const mkYarn = async (k: string) => {
      const y = await prisma.item.create({ data: { code: `${TAG}-${k}`, name: `${TAG} iplik ${k}`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } });
      yarnIds.push(y.id);
      return y.id;
    };
    const X = await mkYarn("X");
    const Y = await mkYarn("Y");
    const xL1 = (await prisma.yarnLot.create({ data: { itemId: X, lotNo: `${TAG}-XL1` }, select: { id: true } })).id;
    lotIds.push(xL1);
    const stockIn = (itemId: string, lotId: string | null, qtyKg: number) =>
      prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg, lotId, reason: `${TAG} giriş` }));
    await stockIn(X, xL1, 100);
    await stockIn(Y, null, 100);
    const spec = await prisma.warpSpec.create({
      data: { code: `${TAG}-XY`, name: `${TAG} kart`, yarnItemId: X, endsCount: 5400, yarns: { create: [{ yarnItemId: X, endsCount: 3000, sortOrder: 0 }, { yarnItemId: Y, endsCount: 2400, sortOrder: 1 }] } },
      select: { id: true },
    });
    specId = spec.id;
    const newOrder = async () => {
      const r = await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: spec.id, beamLines: [{ beamCount: 1, beamLengthM: 1000 }] }, U);
      orderIds.push(r.data.id);
      return r.data;
    };
    const send = (orderId: string, lines: WarpingDispatchLineInput[]) => dispatchWarpingOrder(orderId, { clientToken: randomUUID(), lines }, U);
    const O1 = await newOrder();
    const O2 = await newOrder();
    const d1 = await send(O1.id, [{ yarnItemId: X, warehouseId: whId, lotId: xL1, qtyKg: 20 }]);
    const d2 = await send(O1.id, [{ yarnItemId: Y, warehouseId: whId, lotId: null, qtyKg: 10 }]);
    const d3 = await send(O1.id, [{ yarnItemId: X, warehouseId: whId, lotId: xL1, qtyKg: 5 }]);
    const dO2 = await send(O2.id, [{ yarnItemId: X, warehouseId: whId, lotId: xL1, qtyKg: 1 }]);
    await cancelWarpingDispatch(O1.id, d3.dispatch.id, `${TAG} yanlış sevk`, U);
    const i1 = d1.yarnItems[0]!.dispatchItemId;
    const i2 = d2.yarnItems[0]!.dispatchItemId;
    const rA = await returnWarpingYarn(O1.id, { dispatchItemId: i1, qtyKg: 4, reasonCode: "KALAN_IPLIK" }, U);
    const rB = await returnWarpingYarn(O1.id, { dispatchItemId: i1, qtyKg: 2, reasonCode: "KALAN_IPLIK" }, U);
    await cancelWarpingYarnReturn(O1.id, rB.movementId, `${TAG} storno`, U);
    await transferWarpingYarn(O1.id, { clientToken: randomUUID(), toWarpingOrderId: O2.id, lines: [{ yarnItemId: Y, qtyKg: 3, dispatchItemId: i2 }] }, U);
    const rC = await returnWarpingYarn(O2.id, { dispatchItemId: i2, qtyKg: 1, reasonCode: "KALAN_IPLIK" }, U);

    // ── §1 sevk listesi ─────────────────────────────────────────────────
    const ds = await listWarpingDispatches(O1.id);
    const r1 = ds.find((d) => d.dispatchId === d1.dispatch.id);
    const r2 = ds.find((d) => d.dispatchId === d2.dispatch.id);
    const r3 = ds.find((d) => d.dispatchId === d3.dispatch.id);
    check("§1a üç sevk (iptal edilen DAHİL), sevk sırasıyla", ds.length === 3 && ds[0]?.dispatchId === d1.dispatch.id && ds[2]?.dispatchId === d3.dispatch.id, ds.map((d) => d.dispatchNo).join(","));
    check("§1b iptal edilen sevk: status CANCELLED + cancelledAt + cancelReason · iptal edilemez + neden · tutma 0 · çıkış BRÜT 5",
      r3?.status === "CANCELLED" && !!r3.cancelledAt && r3.cancelReason === `${TAG} yanlış sevk` && !r3.canCancel && !!r3.cancelBlockedReason && r3.totalHoldingKg === "0.000" && r3.totalOutKg === "5.000", JSON.stringify(r3 ?? null).slice(0, 300));
    const it1 = r1?.items[0];
    check("§1c sevk 1: BRÜT çıkış 20 · net iade 4 (4 + 2 − 2 storno) · tutma 16 · iplik kodu/adı · lot no · depo adı",
      r1?.status === "ACTIVE" && it1?.outKg === "20.000" && it1.returnedKg === "4.000" && it1.holdingKg === "16.000" && it1.yarnItemCode === `${TAG}-X` && it1.yarnItemName === `${TAG} iplik X` && it1.lotNo === `${TAG}-XL1` && !!it1.warehouseName,
      JSON.stringify(it1));
    check("§1d sevk 1 iade alınmış → iptal edilemez (LIFO nedeni)", r1?.canCancel === false && /iade/.test(r1.cancelBlockedReason ?? ""), r1?.cancelBlockedReason ?? "");
    check("§1e sevk 2: giden aktarma 3 · iade için geri gelen 1 · iade 1 · tutma 7 (10 − 3 + 1 − 1) · iptal edilemez (LIFO: önce iade engeli)",
      r2?.items[0]?.transferOutKg === "3.000" && r2.items[0].transferInKg === "1.000" && r2.items[0].returnedKg === "1.000" && r2.totalHoldingKg === "7.000" && r2.totalTransferOutKg === "3.000" && r2.totalTransferInKg === "1.000" && r2.canCancel === false && /iade/.test(r2.cancelBlockedReason ?? ""), JSON.stringify(r2?.items[0] ?? null));

    // ── §2 iade listesi ─────────────────────────────────────────────────
    const rs1 = await listWarpingYarnReturns(O1.id);
    const a = rs1.find((r) => r.movementId === rA.movementId);
    const b = rs1.find((r) => r.movementId === rB.movementId);
    const c1 = rs1.find((r) => r.movementId === rC.movementId);
    check("§2a O1 iadeleri: kendi sevk kalemlerinin üç iadesi (en yeni önce)", rs1.length === 3 && rs1[0]?.movementId === rC.movementId, rs1.map((r) => `${r.qtyKg}/${r.status}`).join(","));
    check("§2b açık iade: ACTIVE + storno edilebilir · iplik/lot/kg/sebep etiketi dolu",
      a?.status === "ACTIVE" && a.canCancel && a.qtyKg === "4.000" && a.yarnItemCode === `${TAG}-X` && a.lotNo === `${TAG}-XL1` && a.reasonCode === "KALAN_IPLIK" && !!a.reasonLabel && a.ownDispatch, JSON.stringify(a));
    check("§2c storno edilmiş iade: CANCELLED + storno edilemez + neden", b?.status === "CANCELLED" && !b.canCancel && !!b.cancelBlockedReason, JSON.stringify(b));
    const rs2 = await listWarpingYarnReturns(O2.id);
    check("§2d aktarımla gelen kalemden iade hedef siparişte görünür (ownDispatch=false)", rs2.length === 1 && rs2[0]?.movementId === rC.movementId && rs2[0].ownDispatch === false, JSON.stringify(rs2 ?? null).slice(0, 200));
    check("§2e aynı iade kalemin kendi siparişinde ownDispatch=true", c1?.ownDispatch === true);
    // Liste ↔ kapı birebir: storno edilemez denen satır gerçekten 409, edilebilir denen gerçekten geçer.
    const eB = await errOf(() => cancelWarpingYarnReturn(O1.id, rB.movementId, `${TAG} ikinci storno`, U));
    // Eski grup-net kapısı bu ikinci stornoyu KABUL edip açık 4 kg'lık iadenin 2 kg'sını düşürüyordu.
    check("§2f liste 'storno edilemez' → aynı satırın ikinci stornosu 409 YARN_RETURN_NOT_OPEN (grupta açık iade varken bile)", eB?.status === 409 && eB.code === "YARN_RETURN_NOT_OPEN", show(eB));
    await cancelWarpingYarnReturn(O1.id, rA.movementId, `${TAG} storno`, U);
    const aAfter = (await listWarpingYarnReturns(O1.id)).find((r) => r.movementId === rA.movementId);
    check("§2g storno sonrası satır CANCELLED olur", aAfter?.status === "CANCELLED" && !aAfter.canCancel);
    // Eski (önce yapılan) iade storno edilince yenisi açık kalır — eşleme kg'ya göre, "en yeniden geriye" değil.
    const iO2 = dO2.yarnItems[0]!.dispatchItemId;
    const rOld = await returnWarpingYarn(O2.id, { dispatchItemId: iO2, qtyKg: 0.3, reasonCode: "KALAN_IPLIK" }, U);
    const rNew = await returnWarpingYarn(O2.id, { dispatchItemId: iO2, qtyKg: 0.5, reasonCode: "KALAN_IPLIK" }, U);
    await cancelWarpingYarnReturn(O2.id, rOld.movementId, `${TAG} storno`, U);
    const rs2b = await listWarpingYarnReturns(O2.id);
    const vOld = rs2b.find((r) => r.movementId === rOld.movementId);
    const vNew = rs2b.find((r) => r.movementId === rNew.movementId);
    check("§2h eski iadenin stornosu: eski CANCELLED, yeni ACTIVE + storno edilebilir", vOld?.status === "CANCELLED" && vNew?.status === "ACTIVE" && vNew.canCancel, `${vOld?.status}/${vNew?.status}`);

    // ── §1 (devam) liste ↔ iptal kapısı ──────────────────────────────────
    const r1b = (await listWarpingDispatches(O1.id)).find((d) => d.dispatchId === d1.dispatch.id);
    check("§1f iadeler storno edilince sevk 1 iptal edilebilir görünür", r1b?.canCancel === true && r1b.cancelBlockedReason === null, r1b?.cancelBlockedReason ?? "");
    const eR2 = await errOf(() => cancelWarpingDispatch(O1.id, d2.dispatch.id, `${TAG} iptal`, U));
    check("§1g liste 'iptal edilemez' (iade + aktarma) → gerçek iptal 409", eR2?.status === 409, show(eR2));
    const c1Res = await cancelWarpingDispatch(O1.id, d1.dispatch.id, `${TAG} iptal`, U);
    check("§1h liste 'iptal edilebilir' → gerçek iptal geçer", c1Res.dispatchId === d1.dispatch.id);
    const eNf = await errOf(() => listWarpingDispatches(randomUUID()));
    check("§1i bilinmeyen sipariş → 404 WARPING_ORDER_NOT_FOUND", eNf?.status === 404 && eNf.code === "WARPING_ORDER_NOT_FOUND", show(eNf));

    // ── §3 yarn-at-subcontractor ad alanları ─────────────────────────────
    const at = await warpingYarnAtSubcontractors({ yarnItemIds: [X, Y] });
    const atX = at.find((g) => g.yarnItemId === X);
    check("§3a ad alanları dolu: fasoncu kod/ad · iplik kodu/adı · lot no · sipariş no (kimlikler korunur)",
      !!atX && atX.subcontractorId === sub.id && !!atX.subcontractorName && !!atX.subcontractorCode && atX.yarnItemCode === `${TAG}-X` && atX.yarnItemName === `${TAG} iplik X` && atX.lotNo === `${TAG}-XL1` && atX.orders.some((o) => o.orderNo === O2.orderNo),
      JSON.stringify(atX ?? null).slice(0, 300));
    check("§3b lotsuz/fabrika malı satırda ownerCustomerName null", at.every((g) => g.ownerCustomerId !== null || g.ownerCustomerName === null));

    // ── §4 HTTP ─────────────────────────────────────────────────────────
    const login = async (username: string, password: string): Promise<string> => {
      const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "electron" }) });
      return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
    };
    const user = async (suffix: string, perms: string[]): Promise<string> => {
      const parola = kosumaOzguParola();
      const ps = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
      const u = await prisma.user.create({
        data: { username: `${TAG}-${suffix}`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} ${suffix}`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
        select: { id: true, username: true },
      });
      userIds.push(u.id);
      return login(u.username, parola);
    };
    type Resp = { status: number; code?: string; data?: unknown };
    const get = async (p: string, token: string): Promise<Resp> => {
      const r = await fetch(`${base}${p}`, { headers: { Authorization: `Bearer ${token}` } });
      const j = (await r.json().catch(() => ({}))) as { data?: unknown; details?: { code?: string } };
      return { status: r.status, code: j.details?.code, data: j.data };
    };
    const tkRead = await user("read", ["warping-order:read"]);
    const tkNone = await user("none", ["warehouse:read"]);
    check("§4 giriş (iki dar izinli kullanıcı)", tkRead.length > 0 && tkNone.length > 0);
    const paths = [`/api/warping-orders/${O1.id}/dispatches`, `/api/warping-orders/${O1.id}/yarn-returns`, `/api/warping-orders/yarn-at-subcontractor?filter[yarnItemId]=${X}`];
    const okR = await Promise.all(paths.map((p) => get(p, tkRead)));
    check("§4a `warping-order:read` → üç uç 200", okR.every((r) => r.status === 200), okR.map((r) => `${r.status}${r.code ?? ""}`).join(","));
    const atHttp = (okR[2]?.data as Array<{ subcontractorName?: string; yarnItemCode?: string }> | undefined)?.[0];
    check("§4b HTTP gövdesinde ad alanları", !!atHttp?.subcontractorName && atHttp.yarnItemCode === `${TAG}-X`, JSON.stringify(atHttp ?? null).slice(0, 200));
    const dsHttp = okR[0]?.data as Array<{ status: string }> | undefined;
    check("§4c HTTP sevk listesi iptal edilenleri durumuyla taşır", (dsHttp ?? []).filter((d) => d.status === "CANCELLED").length === 2, JSON.stringify(dsHttp?.map((d) => d.status)));
    const noR = await Promise.all(paths.map((p) => get(p, tkNone)));
    check("§4d izinsiz kullanıcı → üç uç 403", noR.every((r) => r.status === 403), noR.map((r) => `${r.status}${r.code ?? ""}`).join(","));
    const nf = await get(`/api/warping-orders/${randomUUID()}/yarn-returns`, tkRead);
    check("§4e bilinmeyen sipariş → 404", nf.status === 404, `${nf.status} ${nf.code ?? ""}`);
    const bad = await get(`/api/warping-orders/not-a-uuid/dispatches`, tkRead);
    check("§4f geçersiz kimlik → 400", bad.status === 400, `${bad.status} ${bad.code ?? ""}`);
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "false");
    const offI = await Promise.all(paths.map((p) => get(p, tkRead)));
    check("§4g iplik kapalı → üç uç 403 MODULE_DISABLED", offI.every((r) => r.status === 403 && r.code === "MODULE_DISABLED"), offI.map((r) => `${r.status}${r.code ?? ""}`).join(","));
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "true");
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "false");
    const offD = await Promise.all(paths.map((p) => get(p, tkRead)));
    check("§4h devere kapalı → üç uç 403 MODULE_DISABLED", offD.every((r) => r.status === 403 && r.code === "MODULE_DISABLED"), offD.map((r) => `${r.status}${r.code ?? ""}`).join(","));
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");
  } catch (e) {
    fail++;
    console.error("💥", e);
  } finally {
    server.close();
    stopNotificationJobs();
    const ds = await prisma.subcontractorDispatch.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } });
    const dids = ds.map((d) => d.id);
    await prisma.warpingYarnTransfer.deleteMany({ where: { OR: [{ fromWarpingOrderId: { in: orderIds } }, { toWarpingOrderId: { in: orderIds } }], reversesId: { not: null } } });
    await prisma.warpingYarnTransfer.deleteMany({ where: { OR: [{ fromWarpingOrderId: { in: orderIds } }, { toWarpingOrderId: { in: orderIds } }] } });
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: { in: dids } } }).catch(() => undefined);
    await prisma.yarnMovement.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.yarnStock.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dids } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dids } } });
    await prisma.warpingOrderToOrder.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderYarn.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderExtraSpec.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...dids] } } });
    if (specId) await prisma.warpSpec.deleteMany({ where: { id: specId } });
    await prisma.yarnLot.deleteMany({ where: { id: { in: lotIds } } });
    await prisma.item.deleteMany({ where: { id: { in: yarnIds } } });
    await prisma.userPermission.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { isActive: false } }).catch(() => undefined);
    for (const key of SETTING_FOTO) {
      const f = foto.find((s) => s.key === key);
      if (f) await prisma.systemSetting.update({ where: { key }, data: { value: f.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
  await prisma.$disconnect();
  await pool.end();
}

void main();
