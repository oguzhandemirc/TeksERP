// `test_fason_devere_sevk` D2 — siparişle ilk sevk (tek istek, tek tx): bekçinin fikstürünü (kart x/y/z, W plan dışı,
// xL1/yL1 lotları) paylaşır; dosya boyut sınırı için ayrıldı. NEGATİF SONDA (2026-11-28): create.ts replay kimliğinde
// `initialDispatch` gelen imzası kayıtlıyla eşitlenince D2c (iki kontrol) kırmızı.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WarpingOrderStatus } from "@prisma/client";
import prisma from "../../src/lib/prisma";
import { SETTING_KEYS } from "../../src/services/system-setting.service";
import { createWarpingOrder, initialDispatchToken } from "../../src/services/warping-order/create";
import { cancelWarpingDispatch } from "../../src/services/warping-order/dispatch-cancel";
import type { WarpingDispatchLineInput } from "../../src/services/warping-order/dispatch";

type Err = { status?: number; code?: string; msg: string };

export interface IlkSevkBaglam {
  check: (label: string, ok: boolean, detail?: string) => void;
  errOf: (fn: () => Promise<unknown>) => Promise<Err | null>;
  show: (e: Err | null) => string;
  setSetting: (key: string, value: string) => Promise<unknown>;
  tag: string;
  userId: string;
  subcontractorId: string;
  specId: string;
  warehouseId: string;
  yarn: { X: string; Y: string; Z: string; W: string };
  lot: { xL1: string; yL1: string };
  /** Bekçinin temizlik listesi — doğan siparişler buraya eklenir. */
  orderIds: string[];
}

export async function ilkSevkBolumu(c: IlkSevkBaglam): Promise<void> {
  const { check, errOf, show } = c;
  const { X, Y, Z, W } = c.yarn;
  const whId = c.warehouseId;
  const mk = (clientToken: string, lines: WarpingDispatchLineInput[] | null) =>
    createWarpingOrder({ subcontractorId: c.subcontractorId, fixedWasteM: 0, clientToken, warpSpecId: c.specId, beamLines: [{ beamCount: 1, beamLengthM: 1000 }], ...(lines ? { initialDispatch: { lines } } : {}) }, c.userId);
  const tD2 = randomUUID();
  const d2Lines: WarpingDispatchLineInput[] = [{ yarnItemId: X, warehouseId: whId, lotId: c.lot.xL1, qtyKg: 10, packageCount: 2, bobbinCount: 40 }, { yarnItemId: Y, warehouseId: whId, lotId: c.lot.yL1, qtyKg: 5 }];
  const rD2 = await mk(tD2, d2Lines);
  c.orderIds.push(rD2.data.id);
  const dD2 = rD2.initialDispatch ? await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: rD2.initialDispatch.id }, select: { warpingOrderId: true, clientToken: true, items: { select: { dispatchedQty: true, packageCount: true, bobbinCount: true } } } }) : null;
  check("D2a ilk sevkli sipariş → IN_PROGRESS + sevk aynı siparişe bağlı, 2 kalem, 15 kg",
    rD2.data.status === WarpingOrderStatus.IN_PROGRESS && dD2?.warpingOrderId === rD2.data.id && dD2.items.length === 2 && rD2.initialDispatch?.yarnTotalKg === "15.000", JSON.stringify(rD2.initialDispatch));
  check("D2a koli/bobin kaleme yazıldı (2 koli · 40 bobin) ve sevk token'ı siparişten türedi",
    dD2?.items.some((i) => i.packageCount === 2 && i.bobbinCount === 40) === true && dD2.clientToken === initialDispatchToken(tD2));
  check("D2a sevk audit'i (SUBCONTRACTOR_DISPATCH CREATE) yazıldı", (await prisma.systemLog.count({ where: { tableName: "SUBCONTRACTOR_DISPATCH", recordId: rD2.initialDispatch?.id ?? "", action: "CREATE" } })) === 1);
  const rD2b = await mk(tD2, d2Lines);
  check("D2b replay: aynı token + aynı satırlar → aynı sipariş + aynı sevk, ikinci sevk yok",
    rD2b.replayed && rD2b.data.id === rD2.data.id && rD2b.initialDispatch?.id === rD2.initialDispatch?.id && (await prisma.subcontractorDispatch.count({ where: { warpingOrderId: rD2.data.id } })) === 1);
  const eD2kg = await errOf(() => mk(tD2, [{ ...d2Lines[0]!, qtyKg: 11 }, d2Lines[1]!]));
  check("D2c aynı token + farklı ilk sevk miktarı → 409 CLIENT_TOKEN_COLLISION", eD2kg?.status === 409 && eD2kg.code === "CLIENT_TOKEN_COLLISION", show(eD2kg));
  const eD2none = await errOf(() => mk(tD2, null));
  check("D2c aynı token + ilk sevksiz gövde → 409 CLIENT_TOKEN_COLLISION", eD2none?.status === 409 && eD2none.code === "CLIENT_TOKEN_COLLISION", show(eD2none));
  const tOff = randomUUID();
  const eD2off = await errOf(() => mk(tOff, [{ yarnItemId: W, warehouseId: whId, qtyKg: 5 }]));
  check("D2d plan dışı iplik → 400 WARPING_YARN_NOT_IN_PLAN ve sipariş DOĞMADI (tek tx)",
    eD2off?.status === 400 && eD2off.code === "WARPING_YARN_NOT_IN_PLAN" && (await prisma.warpingOrder.count({ where: { clientToken: tOff } })) === 0, show(eD2off));
  await c.setSetting(SETTING_KEYS.DEVERE_LOT_REQUIRED, "true");
  const tLot = randomUUID();
  const eD2lot = await errOf(() => mk(tLot, [{ yarnItemId: Z, warehouseId: whId, lotId: null, qtyKg: 5 }]));
  check("D2e `devere.lotRequired` + lotsuz ilk sevk → 400 YARN_LOT_REQUIRED, sipariş doğmadı",
    eD2lot?.status === 400 && eD2lot.code === "YARN_LOT_REQUIRED" && (await prisma.warpingOrder.count({ where: { clientToken: tLot } })) === 0, show(eD2lot));
  await c.setSetting(SETTING_KEYS.DEVERE_LOT_REQUIRED, "false");
  const eD2dup = await errOf(() => mk(randomUUID(), [d2Lines[0]!, d2Lines[0]!]));
  check("D2f aynı iplik/depo/lot iki satır → 400 WARPING_DISPATCH_DUPLICATE_LINE", eD2dup?.status === 400 && eD2dup.code === "WARPING_DISPATCH_DUPLICATE_LINE", show(eD2dup));
  await cancelWarpingDispatch(rD2.data.id, rD2.initialDispatch!.id, `${c.tag} iptal`, c.userId);
  const eD2c = await errOf(() => mk(tD2, d2Lines));
  check("D2g ilk sevk iptal edildikten sonra aynı token → 409 DISPATCH_CANCELLED (4. durum)", eD2c?.status === 409 && eD2c.code === "DISPATCH_CANCELLED", show(eD2c));
  const routesD2 = fs.readFileSync(path.join(__dirname, "../../src/routes/warping-order.routes.ts"), "utf8");
  check("D2h sipariş açma ucu ilk sevkte iplik kapısı alır", /router\.post\("\/", requirePermission\("warping-order:write"\), requireIplikForInitialDispatch/.test(routesD2));
}
