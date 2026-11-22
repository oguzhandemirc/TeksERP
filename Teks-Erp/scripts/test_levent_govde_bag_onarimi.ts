// =============================================================================
// FİZİKSEL NO'DAN GÖVDE BAĞI ONARIMI — `fix_beam_body_from_physical_no.ts` (GERÇEK DB, sunucusuz bekçi)
// =============================================================================
//   §1 teşhis YAZMAZ · sınıflama: DOLDUR (READY, harf duyarsız) · TAK (MOUNTED) · GEÇMİŞ (EXHAUSTED) ·
//      EŞLEŞMESİZ · ÇOK-GÖVDE · SAHİP (müşteri gövdesi) · MEŞGUL (bakımdaki gövde)
//      (ÇOK-SARIM kurulamaz: aynı no'lu iki canlı sarımı `warp_beams_physical_live_uq` reddeder; betikte sed olarak kalır)
//   §2 yazım: bağ + FILLED (+ MOUNTED tezgâhla) · GEÇMİŞ'te gövde/defter değişmez · atlananlar bağsız · audit izi
//   §3 kanca tutarlılığı: bağlanan sarımın sonraki takma/söküm/bitişi gövdeyi 409'suz yürütür
//   §4 ikinci teşhis bağlananları aday saymaz (tekrar koşum güvenli)
//   §5 bayat liste: gövde arada değişince tx geri alınır — listedeki öteki kayıt da YAZILMAZ
// NEGATİF SONDA (B, bu commit): applyProposals'tan FILLED geçişi çıkarılınca §2b ve §3a kırmızı; SAHİP
//   kapısı çıkarılınca §1h kırmızı (ikisi de geri alındı).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import { randomUUID } from "node:crypto";
import { BeamBodyStatus, Prisma, StationType, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { dispatchWarpingOrder } from "../src/services/warping-order/dispatch";
import { receiveWarpingOrder, type WarpingReceiveBeamInput } from "../src/services/warping-order/receive";
import { createBeamBody, type BeamBodyOwnerInput } from "../src/services/beam-body/write";
import { applyBeamBodyTransition } from "../src/services/beam-body/transition";
import { dismountBeam, mountBeam } from "../src/services/warp-beam-mount.service";
import { exhaustBeam } from "../src/services/warp-beam-consume.service";
import { applyProposals, diagnose } from "./fix_beam_body_from_physical_no";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-LGB${process.pid}`;
const SETTING_FOTO = [
  SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY,
  SETTING_KEYS.DEVERE_BEAM_BODY_MODE, SETTING_KEYS.DEVERE_BEAM_BODY_MACHINE_FIT, SETTING_KEYS.DEVERE_MOUNT_TRACKING,
] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== FİZİKSEL NO'DAN GÖVDE BAĞI ONARIMI ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const W = await fixtureWarehouseId();
  const customerIds: string[] = [];
  const yarnIds: string[] = [];
  const lotIds: string[] = [];
  const specIds: string[] = [];
  const orderIds: string[] = [];
  const stationIds: string[] = [];
  const machineIds: string[] = [];
  const no = (s: string) => `${TAG}-${s}`;
  const body = async (s: string, owner: BeamBodyOwnerInput = { kind: "OURS" }) =>
    (await createBeamBody({ clientToken: randomUUID(), bodyNo: no(s), owner, warehouseId: W, machineIds: [] }, U)).data;
  const bodyRow = (id: string) => prisma.beamBody.findUniqueOrThrow({ where: { id }, select: { status: true, machineId: true, currentWarpBeamId: true } });
  const bodyEvents = (bodyId: string) => prisma.beamBodyEvent.findMany({ where: { bodyId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, kind: true, warpBeamId: true, machineId: true, reason: true } });
  try {
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "true");
    await setSetting(SETTING_KEYS.DOKUMA_ENABLED, "true");
    await setSetting(SETTING_KEYS.DEVERE_LOT_REQUIRED, "false");
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE");
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MACHINE_FIT, "WARN");
    await setSetting(SETTING_KEYS.DEVERE_MOUNT_TRACKING, "true");
    // Eski kurulum: gövde takibi KAPALIYKEN sarımlar yalnız serbest metin no ile doğar.
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OFF");

    const yarn = await prisma.item.create({ data: { code: `${TAG}-Y`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } });
    yarnIds.push(yarn.id);
    const lot = await prisma.yarnLot.create({ data: { itemId: yarn.id, lotNo: `${TAG}-L` }, select: { id: true } });
    lotIds.push(lot.id);
    await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: yarn.id, warehouseId: W, kind: YarnMovementKind.IN, qtyKg: 1000, lotId: lot.id, reason: `${TAG} giriş` }));
    const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-S`, name: `${TAG} kart`, yarnItemId: yarn.id, endsCount: 3000, yarns: { create: [{ yarnItemId: yarn.id, endsCount: 3000, sortOrder: 0 }] } }, select: { id: true } });
    specIds.push(spec.id);
    const stLoom = await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: `${TAG}-DK`.slice(0, 32), type: StationType.INTERNAL, kind: "WEAVING", consumesWarpBeam: true }, select: { id: true } });
    stationIds.push(stLoom.id);
    const loom = await prisma.machine.create({ data: { stationId: stLoom.id, name: `${TAG}-T1`, code: `${TAG}-T1`.slice(0, 32), warpBeamSlots: 2 }, select: { id: true } });
    machineIds.push(loom.id);
    const c1 = await prisma.customer.create({ data: { code: `${TAG}-C1`, name: `${TAG} MUSTERI 1` }, select: { id: true } });
    customerIds.push(c1.id);

    const order = await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: spec.id, beamLines: [{ beamCount: 12, beamLengthM: 100 }] }, U);
    orderIds.push(order.data.id);
    await dispatchWarpingOrder(order.data.id, { clientToken: randomUUID(), lines: [{ yarnItemId: yarn.id, warehouseId: W, lotId: lot.id, qtyKg: 100 }] }, U);
    const L = (extra: Partial<WarpingReceiveBeamInput>): WarpingReceiveBeamInput => ({ lengthM: 100, ...extra });
    // R harf farkıyla yazılmış (küçük harf): eşleşme büyük/küçük harf duyarsız olmalı.
    // Aynı no'lu iki CANLI sarım DB'de imkânsız (`warp_beams_physical_live_uq`); ÇOK-SARIM yalnız katlama farkına sed.
    const physical = ["r", "M", "X", "N", "O", "B", "MB", "S", "S2"].map((s) => (s === "r" ? no("R").toLowerCase() : no(s)));
    const rec = await receiveWarpingOrder(order.data.id, { clientToken: randomUUID(), deliveryNoteNo: `${TAG}-DV`, beams: physical.map((p) => L({ physicalBeamNo: p })) }, U);
    const beams = await prisma.warpBeam.findMany({ where: { warpingReceiptKey: rec.receiptKey }, orderBy: { beamNo: "asc" }, select: { id: true, beamNo: true, physicalBeamNo: true } });
    const byNo = (p: string) => beams.filter((b) => b.physicalBeamNo === p);
    const bR = byNo(no("R").toLowerCase())[0]!;
    const bM = byNo(no("M"))[0]!;
    const bX = byNo(no("X"))[0]!;
    const bN = byNo(no("N"))[0]!;
    const bO = byNo(no("O"))[0]!;
    const bB = byNo(no("B"))[0]!;
    const bMB = byNo(no("MB"))[0]!;
    const bS = byNo(no("S"))[0]!;
    const bS2 = byNo(no("S2"))[0]!;
    await mountBeam(bM.id, { machineId: loom.id, position: 1 }, U);
    await exhaustBeam(bX.id, {}, U);

    // Gövde kartları SONRADAN açılır (takip açıldı).
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OPTIONAL");
    const R = await body("R");
    const M = await body("M");
    const X = await body("X");
    await body("O", { kind: "CUSTOMER", customerId: c1.id });
    const B = await body("B");
    await body("S");
    await body("S2");
    // MEŞGUL: B gövdesi bakımda — sarım "dolu" yazılamaz (aynı no'lu ikinci canlı sarımı DB zaten reddeder).
    await applyBeamBodyTransition(B.id, { kind: "MAINTENANCE_IN", reason: `${TAG} bakım` }, U);
    // ÇOK-GÖVDE: kayıt kapısının engellediği harf farkı, eski veride doğrudan var sayılır.
    await prisma.beamBody.create({ data: { bodyNo: `${TAG}-mb`, warehouseId: W } });
    await prisma.beamBody.create({ data: { bodyNo: `${TAG}-MB`, warehouseId: W } });

    const ids = beams.map((b) => b.id);
    const evBefore = await prisma.beamBodyEvent.count();
    const d = await diagnose({ onlyBeamIds: ids });
    const prop = (id: string) => d.proposals.find((p) => p.beamId === id);
    const skip = (id: string) => d.skipped.find((s) => s.beamId === id);

    // ── §1 teşhis ────────────────────────────────────────────────────────
    check("§1a teşhis YAZMAZ (gövde olayı yok, sarımlar bağsız)", (await prisma.beamBodyEvent.count()) === evBefore && (await prisma.warpBeam.count({ where: { id: { in: ids }, beamBodyId: { not: null } } })) === 0);
    check("§1b READY + harf farkı → DOLDUR (gövde boş, bizde)", prop(bR.id)?.mode === "FILL" && prop(bR.id)?.bodyId === R.id && prop(bR.id)?.bodyFrom === BeamBodyStatus.EMPTY_STOCK, JSON.stringify(prop(bR.id) ?? skip(bR.id)));
    check("§1c MOUNTED → TAK (tezgâhla)", prop(bM.id)?.mode === "FILL_MOUNT" && prop(bM.id)?.machineId === loom.id, JSON.stringify(prop(bM.id) ?? skip(bM.id)));
    check("§1d EXHAUSTED → GEÇMİŞ (yalnız bağ)", prop(bX.id)?.mode === "HISTORY" && prop(bX.id)?.bodyId === X.id);
    check("§1e gövdesiz numara → EŞLEŞMESİZ", skip(bN.id)?.reason === "NO_MATCH");
    check("§1f harf farkıyla iki gövde → ÇOK-GÖVDE (atlanır)", skip(bMB.id)?.reason === "MULTI_BODY", JSON.stringify(skip(bMB.id)));
    check("§1h müşteri gövdesi, sahipsiz sarım → SAHİP (atlanır)", skip(bO.id)?.reason === "OWNER");
    check("§1i bakımdaki gövde → MEŞGUL (atlanır)", skip(bB.id)?.reason === "BUSY", JSON.stringify(skip(bB.id)));

    // ── §5 bayat liste (önce: S/S2 adaylarını ayır) ──────────────────────
    const pS = prop(bS.id)!;
    const pS2 = prop(bS2.id)!;
    const sBody = await prisma.beamBody.findUniqueOrThrow({ where: { bodyNo: no("S") }, select: { id: true } });
    await applyBeamBodyTransition(sBody.id, { kind: "SHIP_EMPTY", subcontractorId: sub.id }, U);
    let staleErr = "";
    try { await applyProposals([pS2, pS]); } catch (e) { staleErr = String((e as Error).message ?? e); }
    const s2Linked = await prisma.warpBeam.findUniqueOrThrow({ where: { id: bS2.id }, select: { beamBodyId: true } });
    check("§5 gövde arada değişti → hata, tx geri alındı (listedeki öteki sarım da bağsız)", staleErr.length > 0 && s2Linked.beamBodyId === null, staleErr.slice(0, 120));

    // ── §2 yazım ─────────────────────────────────────────────────────────
    const xEvBefore = (await bodyEvents(X.id)).length;
    const target = d.proposals.filter((p) => p.beamId !== bS.id && p.beamId !== bS2.id);
    const written = await applyProposals(target);
    const linked = await prisma.warpBeam.findMany({ where: { id: { in: ids } }, select: { id: true, beamBodyId: true } });
    const linkOf = (id: string) => linked.find((x) => x.id === id)?.beamBodyId ?? null;
    check("§2a üç sarım bağlandı (R · M · X)", written.length === 3 && linkOf(bR.id) === R.id && linkOf(bM.id) === M.id && linkOf(bX.id) === X.id);
    const r1 = await bodyRow(R.id);
    const rEv = await bodyEvents(R.id);
    check("§2b DOLDUR: gövde FULL_STOCK · üstündeki sarım · FILLED (betik sebebiyle)", r1.status === BeamBodyStatus.FULL_STOCK && r1.currentWarpBeamId === bR.id && rEv.at(-1)?.kind === "FILLED" && rEv.at(-1)?.warpBeamId === bR.id && (rEv.at(-1)?.reason ?? "").includes("onarım"), `${r1.status} ${rEv.map((e) => e.kind).join(",")}`);
    const m1 = await bodyRow(M.id);
    const mEv = await bodyEvents(M.id);
    check("§2c TAK: gövde MOUNTED + tezgâh · FILLED,MOUNTED", m1.status === BeamBodyStatus.MOUNTED && m1.machineId === loom.id && m1.currentWarpBeamId === bM.id && mEv.slice(-2).map((e) => e.kind).join(",") === "FILLED,MOUNTED", `${m1.status} ${mEv.map((e) => e.kind).join(",")}`);
    const x1 = await bodyRow(X.id);
    check("§2d GEÇMİŞ: gövde durumu ve defteri DEĞİŞMEDİ", x1.status === BeamBodyStatus.EMPTY_STOCK && x1.currentWarpBeamId === null && (await bodyEvents(X.id)).length === xEvBefore);
    check("§2e atlananlar bağsız kaldı", [bN, bO, bB, bMB].every((b) => linkOf(b.id) === null));
    const audits = await prisma.systemLog.count({ where: { recordId: { in: [bR.id, bM.id, bX.id] }, tableName: "WARP_BEAM", action: "UPDATE", newData: { path: ["event"], equals: "BEAM_BODY_LINK_BACKFILL" } } });
    check("§2f her bağ için audit izi (WARP_BEAM · BEAM_BODY_LINK_BACKFILL)", audits === 3, `${audits}`);

    // ── §3 kanca tutarlılığı ─────────────────────────────────────────────
    const mount = await mountBeam(bR.id, { machineId: loom.id, position: 2 }, U).then(() => "ok", (e: Error) => e.message);
    const r2 = await bodyRow(R.id);
    check("§3a bağlanan READY sarım takılınca gövde MOUNTED (409 yok)", mount === "ok" && r2.status === BeamBodyStatus.MOUNTED && r2.machineId === loom.id, mount);
    const dis = await dismountBeam(bM.id, {}, U).then(() => "ok", (e: Error) => e.message);
    const m2 = await bodyRow(M.id);
    check("§3b bağlanan takılı sarım sökülünce gövde FULL_STOCK", dis === "ok" && m2.status === BeamBodyStatus.FULL_STOCK && m2.machineId === null, dis);
    const ex = await exhaustBeam(bR.id, {}, U).then(() => "ok", (e: Error) => e.message);
    const r3 = await bodyRow(R.id);
    check("§3c bitiş → gövde EMPTY_STOCK, sarım boşaldı", ex === "ok" && r3.status === BeamBodyStatus.EMPTY_STOCK && r3.currentWarpBeamId === null, ex);

    // ── §4 tekrar koşum ─────────────────────────────────────────────────
    const d2 = await diagnose({ onlyBeamIds: ids });
    check("§4 ikinci teşhis bağlananları aday saymaz", ![bR.id, bM.id, bX.id].some((id) => d2.proposals.some((p) => p.beamId === id) || d2.skipped.some((s) => s.beamId === id)));
  } finally {
    const bodies = await prisma.beamBody.findMany({ where: { bodyNo: { startsWith: TAG } }, select: { id: true } });
    const ids = bodies.map((x) => x.id);
    const beamIds = (await prisma.warpBeam.findMany({ where: { OR: [{ warpingOrderId: { in: orderIds } }, { beamBodyId: { in: ids } }] }, select: { id: true } })).map((x) => x.id);
    const ds = await prisma.subcontractorDispatch.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } });
    const dids = ds.map((d) => d.id);
    const evIds = (await prisma.beamBodyEvent.findMany({ where: { bodyId: { in: ids } }, select: { id: true } })).map((e) => e.id);
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: ids }, reversesId: { not: null } } });
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: ids } } });
    await prisma.beamBody.updateMany({ where: { id: { in: ids } }, data: { currentWarpBeamId: null, status: BeamBodyStatus.EMPTY_STOCK, machineId: null, subcontractorId: null } });
    await prisma.warpBeam.updateMany({ where: { id: { in: beamIds } }, data: { beamBodyId: null } });
    await prisma.beamBodyMachine.deleteMany({ where: { bodyId: { in: ids } } });
    await prisma.beamBody.deleteMany({ where: { id: { in: ids } } });
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
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...dids, ...ids, ...beamIds, ...evIds] } } });
    await prisma.machine.deleteMany({ where: { id: { in: machineIds } } });
    await prisma.station.deleteMany({ where: { id: { in: stationIds } } });
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
