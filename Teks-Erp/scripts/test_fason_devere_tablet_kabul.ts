// =============================================================================
// FASON DEVERE — TABLET DÖNÜŞ KABULÜ (devere ek D1): ayrı izin `mobile:devere-kabul`, kapılar, bağlam ucu allowlist
// =============================================================================
//   §1  statik: tabletin çağırdığı uçlar (tablet-context · belge önizleme/kabul/okuma · gövde resolve) izni web izninin
//       ALTERNATİFİ olarak alır; panel uçları (belge listesi, irsaliye grubu, eski /receive, gövde yazma) ALMAZ;
//       tablet-context ayrı kabul mantığı taşımaz (yazıcı yok) · katalog/şablon/muaf satırları
//   §2  kapı işlevi: yalnız `mobile:devere-kabul` → geçer · `mobile:depo` → 403 RBAC · `mobile:*` → geçer
//   §3  DB: açık siparişler, kalan levent/metre K3 (reddedilen düşer), devereci süzgeci, kapalı sipariş yok, OPT-IN
//       allowlist (ücret/iplik/satış siparişi sızmaz), ayarlar, modül kapalı 403 · gövde QR → bağlı sarım (D8)
// NEGATİF SONDA (2026-11-21): `warping-receive-doc.routes` POST "/" guard'ından `...MOBILE_DEVERE_KABUL` düşünce §1b
// KIRMIZI · `tablet-context.ts` sipariş `map`ine `fee: o.feeUnitPrice` eklenince §3c KIRMIZI (arşiv "Devere ek D1").
// M1 (2026-11-21): §1h ekran SCREEN_CATALOG'da (muaf silindi) · §1i levent etiket kapısı; sonda: print-event guard'ından
// `"mobile:devere-kabul"` düşünce §1i KIRMIZI.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Prisma, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA, TEST_SANDING } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { cancelWarpingOrder } from "../src/services/warping-order/cancel";
import { dispatchWarpingOrder } from "../src/services/warping-order/dispatch";
import { createWarpingBeamRejection } from "../src/services/warping-order/beam-rejection";
import { createWarpingReceiveDoc } from "../src/services/warping-order/receive-doc";
import { getWarpingTabletContext } from "../src/services/warping-order/tablet-context";
import { resolveBeamBody } from "../src/services/beam-body/read";
import { requireAnyPermission } from "../src/middlewares/rbac.middleware";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import { ROLE_TEMPLATE_CATALOG } from "../src/constants/role-template-catalog";
import { SCREEN_CATALOG, SCREENLESS_PERMISSIONS } from "../src/constants/screen-catalog";

const ROOT = path.resolve(__dirname, "..");
const TAG = `TEST-FDTK-${process.pid}`;
const PERM = "mobile:devere-kabul";
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
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

/** `router.<m>("<yol>", <guard…>` çağrısının ilk guard argümanını döner (parantez dengeli; emsal test_warp_beam_tablet). */
function guardOf(src: string, method: string, routePath: string): string | null {
  const re = new RegExp(`router\\.${method}\\(\\s*"${routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*,`);
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      if (depth === 0) break;
      depth--;
    } else if (src[i] === "," && depth === 0) break;
  }
  return src.slice(start, i);
}

function statik(): void {
  console.log("── §1 kapılar (statik) ──");
  const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const recv = read("src/routes/warping-order-receive.routes.ts");
  const docs = read("src/routes/warping-receive-doc.routes.ts");
  const body = read("src/routes/beam-body.routes.ts");
  const order = read("src/routes/warping-order.routes.ts");
  const konst = /const MOBILE_DEVERE_KABUL = \["mobile:devere-kabul"\] as const;/;
  check("§1a izin kümesi üç dosyada adlı sabit (bekçi tarayıcıları çözer)", konst.test(recv) && konst.test(docs) && konst.test(body));
  // ek-2 r: gövde çözümü Levent Sarım tabletine de açık (`...MOBILE_DEVERE`, içeride sarımda gövde QR'ı).
  const acik: Array<[string, string, string, string, string]> = [
    [recv, "get", "/tablet-context", "warping-order:read", ""],
    [docs, "post", "/preview", "warping-order:write", ""],
    [docs, "post", "/", "warping-order:write", ""],
    [docs, "get", "/:id", "warping-order:read", ""],
    [body, "get", "/resolve", "beam-body:read", ", ...MOBILE_DEVERE"],
  ];
  for (const [src, m, p, web, extra] of acik) {
    const g = guardOf(src, m, p);
    const want = `requireAnyPermission("${web}", ...MOBILE_DEVERE_KABUL${extra})`;
    check(`§1b ${m.toUpperCase()} ${p} → ${want}`, g != null && g.trim() === want, g ?? "route yok");
  }
  const kapali: Array<[string, string, string, string]> = [
    [docs, "get", "/", "belge listesi"],
    [docs, "get", "/by-delivery-note", "irsaliye grubu"],
    [recv, "post", "/:id/receive", "eski tek sipariş kabulü"],
    [recv, "post", "/:id/receipts/:receiptKey/cancel", "kabul stornosu"],
    [body, "post", "/", "gövde tanımı"],
    [body, "patch", "/:id", "gövde düzeltme"],
  ];
  for (const [src, m, p, ad] of kapali) {
    const g = guardOf(src, m, p);
    check(`§1c ${m.toUpperCase()} ${p} (${ad}) tablet izni ALMAZ`, g != null && !/mobile:|MOBILE_/.test(g), g ?? "route yok");
  }
  check("§1d tablet-context `/:id`den ÖNCE çözülür (alt router `/:id` uçlarından önce bağlı)",
    order.indexOf('router.use("/", warpingOrderReceiveRoutes)') > 0 && order.indexOf('router.use("/", warpingOrderReceiveRoutes)') < order.indexOf('router.get("/:id"'));
  const ctx = read("src/services/warping-order/tablet-context.ts");
  check("§1e bağlam servisi yazmaz (ikinci kabul mantığı yok) · gelen = K3 yüklemi · açık = RECEIVABLE",
    !/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$transaction/.test(ctx) && ctx.includes("ACCEPTED_WARPING_BEAM_WHERE") && ctx.includes("RECEIVABLE"));
  const p = PERMISSION_CATALOG.find((x) => x.code === PERM);
  check("§1f katalog satırı: mobile:devere-kabul · MOBILE/mobile", p?.module === "MOBILE" && p.category === "mobile");
  const depo = ROLE_TEMPLATE_CATALOG.find((t) => t.code === "MOBILE_DEPO");
  check("§1g Mobil — Depo Operatörü şablonu izni taşır (KARAR 4: depo rolüne ayrı izin)", !!depo && "codes" in depo && Array.isArray(depo.codes) && depo.codes.includes(PERM));
  const screen = SCREEN_CATALOG.find((s) => s.key === "DevereKabul");
  check("§1h tablet ekranı SCREEN_CATALOG'da (M1): DevereKabul · mobile · devereEnabled · requires mobile:devere-kabul; SCREENLESS muafı yok",
    screen?.app === "mobile" && screen.modul === "devereEnabled" && screen.requires.length === 1 && screen.requires[0] === PERM && !SCREENLESS_PERMISSIONS.some((s) => s.code === PERM));
  const label = read("src/routes/label.routes.ts");
  check("§1i M1: kabul edilen leventin etiketi — levent etiket okuma + baskı izi kapısı mobile:devere-kabul alır",
    /const WARP_BEAM_LABEL_READ = requireAnyPermission\([^)]*"mobile:devere-kabul"\)/.test(label) && /"\/warp-beams\/:id\/print-event",\s*verifyToken,\s*requireAnyPermission\([^)]*"mobile:devere-kabul"\)/.test(label));
}

async function kapiIslevi(): Promise<void> {
  console.log("── §2 kapı işlevi ──");
  const gate = requireAnyPermission("warping-order:write", PERM);
  const run = (permissions: string[]) => {
    let got: unknown = "yok";
    gate({ user: { userId: "x", permissions } } as unknown as Request, {} as Response, ((e?: unknown) => { got = e; }) as NextFunction);
    return got as { statusCode?: number; details?: { code?: string } } | undefined;
  };
  check("§2a yalnız mobile:devere-kabul → geçer", run([PERM]) === undefined);
  const red = run(["mobile:depo", "warping-order:read"]);
  check("§2b mobile:depo + warping-order:read → 403 (okuma izni kabul açmaz)", red?.statusCode === 403, JSON.stringify(red?.details ?? null));
  check("§2c mobile:* → geçer (joker)", run(["mobile:*"]) === undefined);
}

const SETTING_FOTO = [
  SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY, SETTING_KEYS.DEVERE_BEAM_BODY_MODE,
  SETTING_KEYS.DEVERE_REJECT_PHOTO_REQUIRED, SETTING_KEYS.DEVERE_DUPLICATE_DELIVERY_NOTE, SETTING_KEYS.DEVERE_RECEIVE_WEIGHING,
] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

const ALLOW = {
  root: ["limits", "orders", "settings", "subcontractors", "truncated"],
  order: ["beamLines", "expectedReturnAt", "id", "orderNo", "plannedBeamCount", "receivedBeamCount", "receivedM", "remainingBeamCount", "remainingM", "reworkCandidates", "status", "subcontractor", "targetLengthM", "warpSpec"],
  subcontractor: ["id", "name"],
  warpSpec: ["code", "name"],
  sub: ["id", "name", "openOrderCount"],
  // ek-2 r: rejectPhotoRequired (tablet ret sayfası); reworkCandidates alt anahtarları test_devere_tablet_ret_govde'de.
  settings: ["beamBodyMode", "duplicateDeliveryNote", "receiveWeighing", "rejectPhotoRequired"],
};
const keysOf = (o: object) => Object.keys(o).sort().join();
const same = (o: object, allow: string[]) => keysOf(o) === [...allow].sort().join();

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== FASON DEVERE TABLET DÖNÜŞ KABULÜ (D1) ===");
  statik();
  await kapiIslevi();

  console.log("── §3 bağlam ucu (DB) ──");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const sub2 = await ensureTestSubcontractor(TEST_SANDING);
  const whId = await fixtureWarehouseId();
  const yarnIds: string[] = [];
  const lotIds: string[] = [];
  const orderIds: string[] = [];
  const specIds: string[] = [];
  try {
    for (const [k, v] of [[SETTING_KEYS.DEVERE_ENABLED, "true"], [SETTING_KEYS.IPLIK_ENABLED, "true"], [SETTING_KEYS.DEVERE_LOT_REQUIRED, "false"], [SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE"],
      [SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OPTIONAL"], [SETTING_KEYS.DEVERE_REJECT_PHOTO_REQUIRED, "false"], [SETTING_KEYS.DEVERE_DUPLICATE_DELIVERY_NOTE, "BLOCK"], [SETTING_KEYS.DEVERE_RECEIVE_WEIGHING, "REQUIRED"]] as const) await setSetting(k, v);
    await reconcileReasonPresets();
    const X = (await prisma.item.create({ data: { code: `${TAG}-X`, name: `${TAG} iplik X`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } })).id;
    yarnIds.push(X);
    const lx = (await prisma.yarnLot.create({ data: { itemId: X, lotNo: `${TAG}-XL` }, select: { id: true } })).id;
    lotIds.push(lx);
    await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: X, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg: 1000, lotId: lx, reason: `${TAG} giriş` }));
    const spec = (await prisma.warpSpec.create({ data: { code: `${TAG}-S`, name: `${TAG} zemin`, yarnItemId: X, endsCount: 3000, yarns: { create: [{ yarnItemId: X, endsCount: 3000, sortOrder: 0 }] } }, select: { id: true } })).id;
    specIds.push(spec);
    const newOrder = async (subcontractorId: string, kg: number | null) => {
      const r = await createWarpingOrder({ subcontractorId, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: spec, beamLines: [{ beamCount: 10, beamLengthM: 1000 }], feeUnit: "METRE", feeUnitPrice: "0.05", feeCurrency: "USD" }, U);
      orderIds.push(r.data.id);
      if (kg !== null) await dispatchWarpingOrder(r.data.id, { clientToken: randomUUID(), lines: [{ yarnItemId: X, warehouseId: whId, lotId: lx, qtyKg: kg }] }, U);
      return r.data.id;
    };
    const A = await newOrder(sub.id, 300);
    const C = await newOrder(sub2.id, 100);
    const Z = await newOrder(sub.id, null);
    await cancelWarpingOrder(Z, `${TAG} iptal`, U);

    // Tablet akışı: E1 belge ucu (ikinci kabul mantığı yok) — 3 levent, biri yeni gövdeyle.
    const bodyNo = `${TAG}-G1`;
    const d = await createWarpingReceiveDoc({
      clientToken: randomUUID(), deliveryNoteNo: `${TAG}-IRS`,
      orders: [{ warpingOrderId: A, beams: [{ lengthM: 1000, grossKg: 80, tareKg: 30, newBody: { bodyNo, owner: { kind: "OURS" } } }, { lengthM: 900, grossKg: 75, tareKg: 30 }, { lengthM: 800, grossKg: 70, tareKg: 30 }] }],
    }, U);
    const beams = await prisma.warpBeam.findMany({ where: { warpingReceiveDocId: d.data.id }, select: { id: true, beamBodyId: true }, orderBy: { beamNo: "asc" } });
    const rejected = beams.find((b) => b.beamBodyId === null)!;
    await createWarpingBeamRejection({ clientToken: randomUUID(), warpingOrderId: A, beamIds: [rejected.id], reasonCode: "TEL_KOPUK", expectRework: true }, U);
    const rejM = (await prisma.warpBeamEvent.findFirstOrThrow({ where: { beamId: rejected.id, kind: "WOUND" }, select: { lengthM: true } })).lengthM;
    const wantM = (2700 - Number(rejM)).toFixed(3);

    const all = await getWarpingTabletContext({ subcontractorId: null });
    const oA = all.orders.find((o) => o.id === A);
    check("§3a açık siparişler: A ve C var · iptal Z yok", !!oA && all.orders.some((o) => o.id === C) && !all.orders.some((o) => o.id === Z));
    check("§3b kalan K3: 3 kabul − 1 ret = 2 levent · gelen metre ret düşülmüş · kalan 8 levent / hedef − gelen",
      !!oA && oA.plannedBeamCount === 10 && oA.receivedBeamCount === 2 && oA.receivedM === wantM && oA.remainingBeamCount === 8
      && oA.remainingM === (10000 - Number(wantM)).toFixed(3) && oA.targetLengthM === "10000.000" && oA.beamLines[0]?.beamLengthM === "1000.000", JSON.stringify(oA));
    const leak = JSON.stringify(all);
    check("§3c OPT-IN allowlist: kök/sipariş/devereci/kart/ayar anahtarları birebir · ücret, iplik, satış siparişi sızmaz",
      same(all, ALLOW.root) && all.orders.every((o) => same(o, ALLOW.order) && same(o.subcontractor, ALLOW.subcontractor) && same(o.warpSpec, ALLOW.warpSpec))
      && all.subcontractors.every((s) => same(s, ALLOW.sub)) && same(all.settings, ALLOW.settings) && !/fee|price|USD|yarn|salesOrder|netKg|grossKg/i.test(leak),
      oA ? keysOf(oA) : "A yok");
    const sA = all.subcontractors.find((s) => s.id === sub.id);
    check("§3d devereci listesi açık sipariş sayısıyla (iptal sayılmaz)", !!sA && sA.openOrderCount >= 1 && all.subcontractors.some((s) => s.id === sub2.id));
    check("§3e kabul ayarları ve sınırlar aynen iner (tablet alanı ayara göre çizer)",
      all.settings.beamBodyMode === "OPTIONAL" && all.settings.duplicateDeliveryNote === "BLOCK" && all.settings.receiveWeighing === "REQUIRED" && all.limits.maxOrders > 0 && all.limits.maxBeamsPerOrder > 0);
    const only2 = await getWarpingTabletContext({ subcontractorId: sub2.id });
    check("§3f devereci süzgeci sunucuda: yalnız C'nin deverecisi", only2.orders.length >= 1 && only2.orders.every((o) => o.subcontractor.id === sub2.id) && only2.orders.some((o) => o.id === C));
    const res = await resolveBeamBody(bodyNo.toLowerCase());
    const bodyBeam = beams.find((b) => b.beamBodyId !== null)!;
    check("§3g gövde QR çözümü (harf duyarsız) → bağlı sarım (D8 takma; B3 DTO)", res.currentWarpBeam?.id === bodyBeam.id, JSON.stringify(res.currentWarpBeam ?? null));
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "false");
    const off = await errOf(() => getWarpingTabletContext({ subcontractorId: null }));
    check("§3h devere modülü kapalı → servis düzeyinde de 403 MODULE_DISABLED", off?.status === 403 && off.code === "MODULE_DISABLED", show(off));
  } finally {
    const beamIds = (await prisma.warpBeam.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } })).map((b) => b.id);
    const docIds = (await prisma.warpingReceiveDoc.findMany({ where: { deliveryNoteNo: { startsWith: TAG } }, select: { id: true } })).map((x) => x.id);
    const rejIds = (await prisma.warpingBeamRejection.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } })).map((r) => r.id);
    const bodyIds = (await prisma.beamBody.findMany({ where: { bodyNo: { startsWith: TAG } }, select: { id: true } })).map((b) => b.id);
    const dids = (await prisma.subcontractorDispatch.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } })).map((x) => x.id);
    await prisma.warpingBeamRejectionPhoto.deleteMany({ where: { rejectionId: { in: rejIds } } });
    await prisma.warpingBeamRejectionItem.deleteMany({ where: { rejectionId: { in: rejIds } } });
    await prisma.warpingBeamRejection.deleteMany({ where: { id: { in: rejIds } } });
    await prisma.beamBody.updateMany({ where: { id: { in: bodyIds } }, data: { currentWarpBeamId: null } }).catch(() => undefined);
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: bodyIds }, reversesId: { not: null } } });
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: bodyIds } } });
    await prisma.warpBeamYarnAllocation.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds }, reversesEventId: { not: null } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: { in: [...dids, ...beamIds] } } }).catch(() => undefined);
    await prisma.warpBeam.updateMany({ where: { id: { in: beamIds } }, data: { reworkOfBeamId: null, beamBodyId: null } });
    await prisma.beamBodyMachine.deleteMany({ where: { bodyId: { in: bodyIds } } });
    await prisma.beamBody.deleteMany({ where: { id: { in: bodyIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.warpingReceiveDoc.deleteMany({ where: { id: { in: docIds } } });
    await prisma.yarnMovement.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.yarnStock.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dids } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dids } } });
    await prisma.warpingOrderToOrder.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderYarn.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderExtraSpec.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...dids, ...beamIds, ...rejIds, ...bodyIds, ...docIds] } } });
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
