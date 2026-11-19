// =============================================================================
// FASON DEVERE — "levent adedi belli değil" siparişi (yalnız toplam metre; adet kabulde çıkar)
// =============================================================================
// Fikstür: kart XY (3000 × 150 den + 2400 × 150 den). 1500 m → X 75 kg, Y 60 kg (tel × denye × m ÷ 9.000.000).
//   A1  açık adet: beamCount NULL · satır yok · hedef 1500 · beamCountOpen · iplik planı toplam metreden
//   A2  eski davranış: 1 × 1500 aynı kg, adet 1, açık değil · 2 × 700 + 1 × 100 hedef 1500, adet 3
//   A3  beamLines XOR openTargetLengthM (ikisi / hiçbiri / sıfır → 400) · önizleme aynı helper
//   A4  replay: aynı gövde aynı sipariş; aynı token satırlı gövde 409
//   A5  düzenleme: yalnız not/fire → mod korunur; satır → satırlı; toplam metre → yeniden açık (satırlar silinir)
//   A6  kabul 3 levent (500+600+300) → mutabakat hedef 1500 / gelen 1400 / fark −100, plan adedi NULL, gelen 3
//   A7  talimat + liste + iptal önizlemesi `beamCountOpen`; DB CHECK beamCount > 0 duruyor
// NEGATİF SONDA (koşuldu 2026-11-19): bkz. arşiv notu "Devere levent adedi belli değil".
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWarpingOrder, patchWarpingOrder, previewWarpingOrder } from "../src/services/warping-order/create";
import { getWarpingInstruction } from "../src/services/warping-order/dispatch";
import { listWarpingOrders, loadWarpingOrderDto } from "../src/services/warping-order/read";
import { receiveWarpingOrder } from "../src/services/warping-order/receive";
import { cancelPreviewWarpingOrder } from "../src/services/warping-order/cancel";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-FDLA-${process.pid}`;
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
const SETTING_FOTO = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== FASON DEVERE — LEVENT ADEDİ BELLİ DEĞİL ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const yarnIds: string[] = [];
  const orderIds: string[] = [];
  const specIds: string[] = [];
  try {
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "true");
    const mkYarn = async (k: string, den: number) => {
      const y = await prisma.item.create({ data: { code: `${TAG}-${k}`, name: `${TAG} iplik ${k}`, itemType: "YARN", unit: "KG", linearDensityDen: den }, select: { id: true } });
      yarnIds.push(y.id);
      return y.id;
    };
    const X = await mkYarn("X", 150);
    const Y = await mkYarn("Y", 150);
    const spec = await prisma.warpSpec.create({
      data: { code: `${TAG}-XY`, name: `${TAG} XY`, yarnItemId: X, endsCount: 5400, yarns: { create: [{ yarnItemId: X, endsCount: 3000, sortOrder: 0 }, { yarnItemId: Y, endsCount: 2400, sortOrder: 1 }] } },
      select: { id: true },
    });
    specIds.push(spec.id);
    const base = { subcontractorId: sub.id, warpSpecId: spec.id, fixedWasteM: 0 };
    const create = async (body: Partial<Parameters<typeof createWarpingOrder>[0]>, token = randomUUID()) => {
      const r = await createWarpingOrder({ ...base, clientToken: token, ...body }, U);
      if (!orderIds.includes(r.data.id)) orderIds.push(r.data.id);
      return r;
    };
    const kgOf = (o: { yarns: Array<{ yarnItemId: string; netKg: string }> }, y: string) => o.yarns.find((v) => v.yarnItemId === y)?.netKg;
    const lineRows = (id: string) => prisma.warpingOrderBeamLine.count({ where: { warpingOrderId: id } });

    // ── A1 açık adet ─────────────────────────────────────────────────────
    const tokOpen = randomUUID();
    const open = (await create({ openTargetLengthM: 1500 }, tokOpen)).data;
    const openRow = await prisma.warpingOrder.findUniqueOrThrow({ where: { id: open.id }, select: { beamCount: true, targetLengthM: true } });
    check("A1 açık adet: DB beamCount NULL · satır yok · hedef 1500", openRow.beamCount === null && (await lineRows(open.id)) === 0 && openRow.targetLengthM.toFixed(3) === "1500.000", JSON.stringify(openRow));
    check("A1 DTO: beamCount null · beamCountOpen · beamLines []", open.beamCount === null && open.beamCountOpen === true && open.beamLines.length === 0 && open.targetLengthM === "1500.000");
    check("A1 iplik planı toplam metreden: X 75 kg · Y 60 kg", kgOf(open, X) === "75.000" && kgOf(open, Y) === "60.000", JSON.stringify(open.yarns.map((y) => y.netKg)));

    // ── A2 eski davranış ─────────────────────────────────────────────────
    const fixed = (await create({ beamLines: [{ beamCount: 1, beamLengthM: 1500 }] })).data;
    check("A2 eski davranış 1 × 1500: adet 1 · açık değil · aynı kg", fixed.beamCount === 1 && fixed.beamCountOpen === false && fixed.beamLines.length === 1 && kgOf(fixed, X) === "75.000" && kgOf(fixed, Y) === "60.000");
    const multi = (await create({ beamLines: [{ beamCount: 2, beamLengthM: 700 }, { beamCount: 1, beamLengthM: 100 }] })).data;
    check("A2 çok satır 2 × 700 + 1 × 100: hedef 1500 · adet 3", multi.beamCount === 3 && multi.targetLengthM === "1500.000" && kgOf(multi, X) === "75.000");

    // ── A3 XOR ───────────────────────────────────────────────────────────
    const eBoth = await errOf(() => create({ beamLines: [{ beamCount: 1, beamLengthM: 100 }], openTargetLengthM: 100 }));
    const eNone = await errOf(() => create({}));
    const eZero = await errOf(() => create({ openTargetLengthM: 0 }));
    check("A3 ikisi birden / hiçbiri / sıfır metre → 400 WARPING_BEAM_LINES_INVALID", [eBoth, eNone, eZero].every((e) => e?.status === 400 && e.code === "WARPING_BEAM_LINES_INVALID"), [eBoth, eNone, eZero].map(show).join(" | "));
    const pv = await previewWarpingOrder({ warpSpecId: spec.id, openTargetLengthM: 1500, fixedWasteM: 0 });
    check("A3 önizleme açık adet: beamCount null · beamCountOpen · aynı kg", pv.beamCount === null && pv.beamCountOpen === true && pv.beamLines.length === 0 && pv.yarns.find((y) => y.yarnItemId === X)?.netKg === "75.000");

    // ── A4 replay ────────────────────────────────────────────────────────
    const rp = await create({ openTargetLengthM: 1500 }, tokOpen);
    check("A4 replay aynı gövde: aynı sipariş, replayed", rp.replayed && rp.data.id === open.id);
    const eCol = await errOf(() => create({ beamLines: [{ beamCount: 1, beamLengthM: 1500 }] }, tokOpen));
    const eCol2 = await errOf(() => create({ openTargetLengthM: 1600 }, tokOpen));
    check("A4 aynı token satırlı gövde / farklı metre → 409", eCol?.status === 409 && eCol2?.status === 409, `${show(eCol)} | ${show(eCol2)}`);

    // ── A5 düzenleme ─────────────────────────────────────────────────────
    const p1 = await patchWarpingOrder(open.id, { notes: `${TAG} not` }, U);
    const p2 = await patchWarpingOrder(open.id, { fixedWasteM: 0 }, U);
    check("A5 not / fire düzenlemesi açık modu korur (hedef 1500, satır yok)", p1.beamCountOpen && p2.beamCountOpen && p2.targetLengthM === "1500.000" && (await lineRows(open.id)) === 0 && kgOf(p2, X) === "75.000");
    const p3 = await patchWarpingOrder(open.id, { beamLines: [{ beamCount: 2, beamLengthM: 500 }] }, U);
    check("A5 satır girince satırlı mod: adet 2 · hedef 1000 · X 50 kg", p3.beamCount === 2 && !p3.beamCountOpen && p3.targetLengthM === "1000.000" && kgOf(p3, X) === "50.000" && (await lineRows(open.id)) === 1);
    const p4 = await patchWarpingOrder(open.id, { openTargetLengthM: 1500 }, U);
    check("A5 toplam metre girince yeniden açık: satırlar silindi · hedef 1500", p4.beamCount === null && p4.beamCountOpen && p4.targetLengthM === "1500.000" && (await lineRows(open.id)) === 0 && kgOf(p4, X) === "75.000");
    const eP = await errOf(() => patchWarpingOrder(open.id, { beamLines: [{ beamCount: 1, beamLengthM: 1 }], openTargetLengthM: 1 }, U));
    check("A5 düzenlemede ikisi birden → 400", eP?.status === 400 && eP.code === "WARPING_BEAM_LINES_INVALID", show(eP));

    // ── A6 kabul 3 levent → mutabakat ────────────────────────────────────
    const rc = await receiveWarpingOrder(open.id, { clientToken: randomUUID(), deliveryNoteNo: `${TAG}-IRS`, beams: [{ lengthM: 500 }, { lengthM: 600 }, { lengthM: 300 }] }, U);
    const m = rc.settlement.metre;
    check("A6 mutabakat: hedef 1500 · gelen 1400 · fark −100 (−6,67%) · plan adedi NULL (açık) · gelen 3 levent",
      m.targetM === "1500.000" && m.receivedM === "1400.000" && m.diffM === "-100.000" && m.diffPct === "-6.67" && m.planBeamCount === null && m.planBeamCountOpen === true && m.receivedBeamCount === 3, JSON.stringify(m));
    const fixedRc = await receiveWarpingOrder(fixed.id, { clientToken: randomUUID(), beams: [{ lengthM: 1400 }] }, U);
    check("A6 eski davranış mutabakatı: plan adedi 1 · açık değil · fark −100", fixedRc.settlement.metre.planBeamCount === 1 && fixedRc.settlement.metre.planBeamCountOpen === false && fixedRc.settlement.metre.diffM === "-100.000");

    // ── A7 yüzeyler ──────────────────────────────────────────────────────
    const ins = await getWarpingInstruction(open.id);
    check("A7 talimat: beamCountOpen · beamLines [] · toplam 1500", ins.beamCountOpen && ins.beamCount === null && ins.beamLines.length === 0 && ins.targetLengthM === "1500.000");
    const list = await listWarpingOrders({ status: [], subcontractorId: null, warpSpecId: spec.id, salesOrderId: null, search: (await loadWarpingOrderDto(prisma, open.id)).orderNo, limit: 10 });
    const lr = list.data.find((r) => r.id === open.id);
    check("A7 liste satırı: beamCount null · beamCountOpen", lr?.beamCount === null && lr.beamCountOpen === true, JSON.stringify(lr));
    const cpv = await cancelPreviewWarpingOrder(multi.id);
    check("A7 iptal önizlemesi beamCountOpen taşır (satırlı → false)", cpv.order.beamCountOpen === false && cpv.order.beamCount === 3);
    const eCk = await errOf(() => prisma.$executeRaw`UPDATE warping_orders SET "beamCount" = 0 WHERE id = ${multi.id}::uuid`);
    check("A7 DB CHECK beamCount > 0 duruyor (0 reddedilir; NULL serbest)", eCk !== null, show(eCk));
  } finally {
    const beamIds = (await prisma.warpBeam.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } })).map((b) => b.id);
    await prisma.warpBeamYarnAllocation.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds }, reversesEventId: { not: null } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: { in: beamIds } } }).catch(() => undefined);
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.warpingOrderYarn.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...beamIds] } } });
    await prisma.warpSpec.deleteMany({ where: { id: { in: specIds } } });
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
