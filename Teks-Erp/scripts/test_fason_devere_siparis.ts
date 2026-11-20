// =============================================================================
// FASON DEVERE SİPARİŞİ — oluştur / oku / düzenle / iptal (D4a; plan PLAN-devere-fason-1117 §10 D4)
// =============================================================================
// Kabul fikstürü (el hesabı; kg = tel × denye × metre ÷ 9.000.000):
//   S1  x/y/z tek kart çok iplik: 3000×150, 2400×150, 1800×300; 1×1000 m → 50 / 40 / 60 kg, fire yok (net = brüt)
//   S2  MONO zemin 165 den×5250 + döner 70 den×5250 (ek tel grubu, AYNI LEVENT); 2×2500 m → 481,250 + 204,167
//   K6  satır satır boy: 1×600 + 2×200 = 1000 m → S1 ile aynı kg; levent adedi 3
//   S29 ek grup: SHARED_BEAM katman önerilir · SEPARATE_BEAM/CREEL 400 · aynı iplik iki kartta → teller TOPLANIR
//   S29d bir kumaşta SHARED, ötekinde SEPARATE olan kart önerilmez (öneri = kapı süzgeci `firstNonSharedLayer`), seçilirse 400
//   Replay: aynı token aynı sipariş · farklı gövde 409 · iptal sonrası 409 (4. durum)
//   Düzenleme kapısı: plan alanı yalnız OPEN; IN_PROGRESS'te meta serbest, plan 409; iptal yalnız OPEN
//   İptal claim yarışı: iki eşzamanlı iptal → biri başarılı, biri 409
//   K3 bağ: iptal edilmiş müşteri siparişi 400 · ücret birimi varsayılanı (METRE → son sipariş birimi; fiyat → USD)
//   DB seddi: CANCELLED + cancelledAt NULL doğrudan yazımı `warping_orders_status_ck` reddeder
// NEGATİF SONDA (koşuldu 2026-11-17): plan.ts birleştirmede `cur.endsCount += l.endsCount` → `+= 0` iken S29c kırmızı;
// cancel.ts claim WHERE'inden `status: OPEN` çıkarılınca IN_PROGRESS iptali + iptal yarışı kırmızı.
// (2026-11-20) plan.ts `suggestExtraSpecs` süzgeci `true ||` ile kapatılınca S29d (çelişen katmanlı kart önerilmez) kırmızı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; kendi kayıtlarını siler (fason firma kalıcı fixture).
// =============================================================================
import { Currency, OrderStatus, WarpingFeeUnit, WarpingOrderStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { replaceItemWarpLayers } from "../src/services/item-construction.service";
import { createWarpingOrder, patchWarpingOrder, previewWarpingOrder } from "../src/services/warping-order/create";
import { cancelPreviewWarpingOrder, cancelWarpingOrder } from "../src/services/warping-order/cancel";
import { getWarpingOrder, listWarpingOrders } from "../src/services/warping-order/read";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-FDV-${process.pid}`;
const errOf = async (fn: () => Promise<unknown>): Promise<{ status?: number; code?: string; msg: string } | null> => {
  try {
    await fn();
    return null;
  } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string }; message?: string };
    return { status: x.statusCode, code: x.details?.code, msg: String(x.message ?? e) };
  }
};
const kgMap = (yarns: Array<{ code: string; netKg: string; grossKg: string; endsCount: number; letter?: string }>) =>
  Object.fromEntries(yarns.map((y) => [y.code, y]));

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== FASON DEVERE SİPARİŞİ (D4a) ===");
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const customer = await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } });
  if (!customer) throw new Error("Fikstür eksik: MUS-001 (npm run seed:fixtures)");

  const mkYarn = (k: string, den: number) =>
    prisma.item.create({ data: { code: `${TAG}-${k}`, name: `${TAG} iplik ${k}`, itemType: "YARN", unit: "KG", linearDensityDen: den }, select: { id: true } });
  const yX = await mkYarn("X", 150);
  const yY = await mkYarn("Y", 150);
  const yZ = await mkYarn("Z", 300);
  const yM = await mkYarn("M", 165);
  const yL = await mkYarn("L", 70);
  const yarnIds = [yX.id, yY.id, yZ.id, yM.id, yL.id];
  const mkSpec = (k: string, lines: Array<{ yarnItemId: string; endsCount: number }>) =>
    prisma.warpSpec.create({
      data: {
        code: `${TAG}-${k}`, name: `${TAG} kart ${k}`, yarnItemId: lines[0]!.yarnItemId, endsCount: lines.reduce((s, l) => s + l.endsCount, 0),
        yarns: { create: lines.map((l, i) => ({ yarnItemId: l.yarnItemId, endsCount: l.endsCount, sortOrder: i })) },
      },
      select: { id: true },
    });
  const cXYZ = await mkSpec("XYZ", [{ yarnItemId: yX.id, endsCount: 3000 }, { yarnItemId: yY.id, endsCount: 2400 }, { yarnItemId: yZ.id, endsCount: 1800 }]);
  const cMono = await mkSpec("MONO", [{ yarnItemId: yM.id, endsCount: 5250 }]);
  const cLeno = await mkSpec("LENO", [{ yarnItemId: yL.id, endsCount: 5250 }]);
  const cXadd = await mkSpec("XADD", [{ yarnItemId: yX.id, endsCount: 600 }]);
  const specIds = [cXYZ.id, cMono.id, cLeno.id, cXadd.id];
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KM`, name: `${TAG} tül`, itemType: "FABRIC", warpSpecId: cMono.id }, select: { id: true } });
  const fabric2 = await prisma.item.create({ data: { code: `${TAG}-KX`, name: `${TAG} kumaş x`, itemType: "FABRIC", warpSpecId: cXYZ.id }, select: { id: true } });
  const fabric3 = await prisma.item.create({ data: { code: `${TAG}-KM2`, name: `${TAG} tül 2`, itemType: "FABRIC", warpSpecId: cMono.id }, select: { id: true } });
  const so = await prisma.order.create({ data: { orderNumber: `${TAG}-SP1`, customerId: customer.id }, select: { id: true } });
  const soDead = await prisma.order.create({ data: { orderNumber: `${TAG}-SP2`, customerId: customer.id, status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelReason: "bekçi" }, select: { id: true } });
  const orderIds: string[] = [];
  const base = { subcontractorId: sub.id, fixedWasteM: 0 };

  try {
    // ── S1 x/y/z ─────────────────────────────────────────────────────────
    const tok1 = randomUUID();
    const r1 = await createWarpingOrder({ ...base, clientToken: tok1, warpSpecId: cXYZ.id, beamLines: [{ beamCount: 1, beamLengthM: 1000 }] }, U);
    orderIds.push(r1.data.id);
    const m1 = kgMap(r1.data.yarns);
    check("S1 x/y/z: 3000×150 den 1000 m → 50 kg", m1[`${TAG}-X`]?.netKg === "50.000", m1[`${TAG}-X`]?.netKg);
    check("S1 x/y/z: 2400×150 den → 40 kg", m1[`${TAG}-Y`]?.netKg === "40.000", m1[`${TAG}-Y`]?.netKg);
    check("S1 x/y/z: 1800×300 den → 60 kg", m1[`${TAG}-Z`]?.netKg === "60.000", m1[`${TAG}-Z`]?.netKg);
    check("S1 fire girdisi yok → hasWaste=false, brüt = net", !r1.data.hasWaste && r1.data.yarns.every((y) => y.grossKg === y.netKg));
    check("S1 harf sırası A/B/C kart sırasıyla", r1.data.yarns.map((y) => y.letter).join("") === "ABC" && r1.data.yarns[0]?.code === `${TAG}-X`);
    check("S1 toplam tel 7200, toplam 150 kg", r1.data.totals.endsCount === 7200 && r1.data.totals.netKg === "150.000", JSON.stringify(r1.data.totals));
    check("S1 numara doğuşta FDV önekli", /^FDV/.test(r1.data.orderNo), r1.data.orderNo);
    check("S1 durum OPEN, ücret birimi varsayılanı METRE (fasoncunun önceki siparişi yok)", r1.data.status === WarpingOrderStatus.OPEN && r1.data.fee.unit === WarpingFeeUnit.METRE, r1.data.fee.unit);
    check("S1 tolerans ayarı 0 → siparişte null (denetim yok)", r1.data.wasteTolerancePct === null);
    const auditC = await prisma.systemLog.count({ where: { recordId: r1.data.id, tableName: "WARPING_ORDER", action: "CREATE" } });
    check("S1 audit WARPING_ORDER CREATE yazıldı", auditC === 1, String(auditC));

    // ── Replay ───────────────────────────────────────────────────────────
    const r1b = await createWarpingOrder({ ...base, clientToken: tok1, warpSpecId: cXYZ.id, beamLines: [{ beamCount: 1, beamLengthM: 1000 }] }, U);
    check("Replay: aynı token + aynı gövde → aynı sipariş, replayed=true", r1b.replayed && r1b.data.id === r1.data.id);
    const cnt = await prisma.warpingOrder.count({ where: { clientToken: tok1 } });
    check("Replay: ikinci kayıt doğmadı", cnt === 1);
    const eDiff = await errOf(() => createWarpingOrder({ ...base, clientToken: tok1, warpSpecId: cXYZ.id, beamLines: [{ beamCount: 2, beamLengthM: 1000 }] }, U));
    check("Replay: aynı token + farklı levent satırı → 409", eDiff?.status === 409, JSON.stringify(eDiff));

    // ── K6 satır satır boy ───────────────────────────────────────────────
    const r6 = await createWarpingOrder({ ...base, clientToken: randomUUID(), warpSpecId: cXYZ.id, beamLines: [{ beamCount: 1, beamLengthM: 600 }, { beamCount: 2, beamLengthM: 200 }] }, U);
    orderIds.push(r6.data.id);
    const m6 = kgMap(r6.data.yarns);
    check("K6 1×600 + 2×200 → hedef 1000 m, 3 levent", r6.data.targetLengthM === "1000.000" && r6.data.beamCount === 3, `${r6.data.targetLengthM} / ${r6.data.beamCount}`);
    check("K6 kg S1 ile aynı (50/40/60)", m6[`${TAG}-X`]?.netKg === "50.000" && m6[`${TAG}-Y`]?.netKg === "40.000" && m6[`${TAG}-Z`]?.netKg === "60.000");
    check("K6 satırlar sırasıyla saklandı", JSON.stringify(r6.data.beamLines) === JSON.stringify([{ beamCount: 1, beamLengthM: "600.000" }, { beamCount: 2, beamLengthM: "200.000" }]));

    // ── S2 MONO + ek tel grubu (SHARED_BEAM) ─────────────────────────────
    await replaceItemWarpLayers(fabric.id, [{ warpSpecId: cLeno.id, role: "LENO", beamMode: "SHARED_BEAM" }]);
    const pv = await previewWarpingOrder({ warpSpecId: cMono.id, beamLines: [{ beamCount: 2, beamLengthM: 2500 }], extraWarpSpecIds: [], fixedWasteM: 0 });
    check("S29a önizleme: SHARED_BEAM katman kartı ek grup olarak ÖNERİLİR", pv.suggestedExtraSpecs.some((s) => s.id === cLeno.id), JSON.stringify(pv.suggestedExtraSpecs.map((s) => s.code)));
    const r2 = await createWarpingOrder({ ...base, clientToken: randomUUID(), warpSpecId: cMono.id, extraWarpSpecIds: [cLeno.id], beamLines: [{ beamCount: 2, beamLengthM: 2500 }] }, U);
    orderIds.push(r2.data.id);
    const m2 = kgMap(r2.data.yarns);
    check("S2 MONO 165 den × 5250 × 5000 m → 481,250 kg", m2[`${TAG}-M`]?.netKg === "481.250", m2[`${TAG}-M`]?.netKg);
    check("S2 döner 70 den × 5250 × 5000 m → 204,167 kg", m2[`${TAG}-L`]?.netKg === "204.167", m2[`${TAG}-L`]?.netKg);
    check("S2 döner satırı kaynağı ek kart; ek grup DTO'da", r2.data.yarns.find((y) => y.code === `${TAG}-L`)?.sourceWarpSpecId === cLeno.id && r2.data.extraSpecs[0]?.id === cLeno.id);

    await replaceItemWarpLayers(fabric.id, [{ warpSpecId: cLeno.id, role: "LENO", beamMode: "SEPARATE_BEAM" }]);
    const eSep = await errOf(() => previewWarpingOrder({ warpSpecId: cMono.id, beamLines: [{ beamCount: 1, beamLengthM: 100 }], extraWarpSpecIds: [cLeno.id], fixedWasteM: 0 }));
    check("S29b AYRI LEVENT katmanı ek grup → 400 WARPING_EXTRA_NOT_SHARED", eSep?.status === 400 && eSep.code === "WARPING_EXTRA_NOT_SHARED", JSON.stringify(eSep));
    await replaceItemWarpLayers(fabric.id, [{ warpSpecId: cLeno.id, role: "LENO", beamMode: "CREEL" }]);
    const eCreel = await errOf(() => createWarpingOrder({ ...base, clientToken: randomUUID(), warpSpecId: cMono.id, extraWarpSpecIds: [cLeno.id], beamLines: [{ beamCount: 1, beamLengthM: 100 }] }, U));
    check("S29b CAĞLIK katmanı ek grup → 400 WARPING_EXTRA_NOT_SHARED", eCreel?.status === 400 && eCreel.code === "WARPING_EXTRA_NOT_SHARED", JSON.stringify(eCreel));
    const pvSep = await previewWarpingOrder({ warpSpecId: cMono.id, beamLines: [{ beamCount: 1, beamLengthM: 100 }], extraWarpSpecIds: [], fixedWasteM: 0 });
    check("S29b CAĞLIK katmanı önerilmez", !pvSep.suggestedExtraSpecs.some((s) => s.id === cLeno.id));

    // ── S29d çelişen katman: bir kumaşta AYNI LEVENT, ötekinde AYRI LEVENT → öneri kapıyla aynı süzgeç ──
    await replaceItemWarpLayers(fabric.id, [{ warpSpecId: cLeno.id, role: "LENO", beamMode: "SHARED_BEAM" }]);
    await replaceItemWarpLayers(fabric3.id, [{ warpSpecId: cLeno.id, role: "LENO", beamMode: "SEPARATE_BEAM" }]);
    const pvMix = await previewWarpingOrder({ warpSpecId: cMono.id, beamLines: [{ beamCount: 1, beamLengthM: 100 }], extraWarpSpecIds: [], fixedWasteM: 0 });
    check("S29d çelişen katmanlı kart ÖNERİLMEZ (kapı 400 verecekti)", !pvMix.suggestedExtraSpecs.some((s) => s.id === cLeno.id), JSON.stringify(pvMix.suggestedExtraSpecs.map((s) => s.code)));
    const eMix = await errOf(() => previewWarpingOrder({ warpSpecId: cMono.id, beamLines: [{ beamCount: 1, beamLengthM: 100 }], extraWarpSpecIds: [cLeno.id], fixedWasteM: 0 }));
    check("S29d kapı gevşemedi: çelişen katmanlı kart seçilirse 400 WARPING_EXTRA_NOT_SHARED", eMix?.status === 400 && eMix.code === "WARPING_EXTRA_NOT_SHARED", JSON.stringify(eMix));
    await replaceItemWarpLayers(fabric3.id, []);

    // ── S29c aynı iplik iki kartta → teller toplanır ────────────────────
    await replaceItemWarpLayers(fabric2.id, [{ warpSpecId: cXadd.id, role: "LENO", beamMode: "SHARED_BEAM" }]);
    const pvAdd = await previewWarpingOrder({ warpSpecId: cXYZ.id, beamLines: [{ beamCount: 1, beamLengthM: 1000 }], extraWarpSpecIds: [cXadd.id], fixedWasteM: 0 });
    const xa = pvAdd.yarns.find((y) => y.code === `${TAG}-X`);
    check("S29c aynı iplik (X) ana + ek kartta → tek satır, 3600 tel, 60 kg", pvAdd.yarns.filter((y) => y.code === `${TAG}-X`).length === 1 && xa?.endsCount === 3600 && xa.netKg === "60.000", JSON.stringify(xa));
    check("S29c birleşen satırın kaynağı ilk (ana) kart", xa?.sourceWarpSpecId === cXYZ.id);
    const eDup = await errOf(() => previewWarpingOrder({ warpSpecId: cXYZ.id, beamLines: [{ beamCount: 1, beamLengthM: 1 }], extraWarpSpecIds: [cXYZ.id], fixedWasteM: 0 }));
    check("Ana kart ek grup olarak seçilemez → 400", eDup?.status === 400 && eDup.code === "WARPING_EXTRA_DUPLICATE", JSON.stringify(eDup));
    const eLines = await errOf(() => previewWarpingOrder({ warpSpecId: cXYZ.id, beamLines: [], extraWarpSpecIds: [], fixedWasteM: 0 }));
    check("Levent satırı boş → 400", eLines?.status === 400 && eLines.code === "WARPING_BEAM_LINES_INVALID", JSON.stringify(eLines));

    // ── K3 bağ + ücret varsayılanı ───────────────────────────────────────
    const eDead = await errOf(() => createWarpingOrder({ ...base, clientToken: randomUUID(), warpSpecId: cXYZ.id, beamLines: [{ beamCount: 1, beamLengthM: 10 }], salesOrderIds: [soDead.id] }, U));
    check("K3 iptal edilmiş müşteri siparişi bağlanamaz → 400 SALES_ORDER_CANCELLED", eDead?.status === 400 && eDead.code === "SALES_ORDER_CANCELLED", JSON.stringify(eDead));
    const rK = await createWarpingOrder({ ...base, clientToken: randomUUID(), warpSpecId: cXYZ.id, beamLines: [{ beamCount: 1, beamLengthM: 10 }], salesOrderIds: [so.id], feeUnit: WarpingFeeUnit.KG, wasteTolerancePct: 5 }, U);
    orderIds.push(rK.data.id);
    check("K3 müşteri siparişi bağı DTO'da", rK.data.salesOrders.length === 1 && rK.data.salesOrders[0]?.id === so.id);
    check("Tolerans gövdeden donar (5.00)", rK.data.wasteTolerancePct === "5.00", String(rK.data.wasteTolerancePct));
    const rF = await createWarpingOrder({ ...base, clientToken: randomUUID(), warpSpecId: cXYZ.id, beamLines: [{ beamCount: 1, beamLengthM: 10 }], feeUnitPrice: 0.05 }, U);
    orderIds.push(rF.data.id);
    check("Ücret birimi verilmezse fasoncunun SON siparişindeki birim (KG)", rF.data.fee.unit === WarpingFeeUnit.KG, rF.data.fee.unit);
    check("Fiyat verilip döviz verilmezse USD", rF.data.fee.currency === Currency.USD && rF.data.fee.unitPrice === "0.05", JSON.stringify(rF.data.fee));

    // ── Liste / özet tek where ───────────────────────────────────────────
    const list = await listWarpingOrders({ status: [], warpSpecId: cXYZ.id, subcontractorId: sub.id, salesOrderId: null, limit: 50 });
    check("Liste süzgeci kart+firma: S1, K6, K3, ücret siparişleri (4) ve özet sayısı aynı", list.data.length === 4 && list.summary.count === 4, `${list.data.length}/${list.summary.count}`);
    const listSo = await listWarpingOrders({ status: [], warpSpecId: null, subcontractorId: null, salesOrderId: so.id, limit: 50 });
    check("Liste müşteri siparişi süzgeci yalnız bağlı siparişi döner", listSo.data.length === 1 && listSo.data[0]?.id === rK.data.id);

    // ── Düzenleme kapısı ─────────────────────────────────────────────────
    const p1 = await patchWarpingOrder(r6.data.id, { beamLines: [{ beamCount: 2, beamLengthM: 1000 }], notes: "düzenlendi" }, U);
    check("PATCH OPEN: plan yeniden hesaplandı (2×1000 → X 100 kg)", kgMap(p1.yarns)[`${TAG}-X`]?.netKg === "100.000" && p1.targetLengthM === "2000.000" && p1.notes === "düzenlendi");
    const auditU = await prisma.systemLog.count({ where: { recordId: r6.data.id, tableName: "WARPING_ORDER", action: "UPDATE" } });
    check("PATCH audit WARPING_ORDER UPDATE yazıldı", auditU === 1, String(auditU));
    // IN_PROGRESS'i D4b sevki yapar; burada doğrudan geçiş (damga gerekmez → status_ck geçer).
    await prisma.warpingOrder.update({ where: { id: r6.data.id }, data: { status: WarpingOrderStatus.IN_PROGRESS } });
    const ePlan = await errOf(() => patchWarpingOrder(r6.data.id, { beamLines: [{ beamCount: 1, beamLengthM: 50 }] }, U));
    check("PATCH IN_PROGRESS plan alanı → 409 WARPING_ORDER_NOT_EDITABLE", ePlan?.status === 409 && ePlan.code === "WARPING_ORDER_NOT_EDITABLE", JSON.stringify(ePlan));
    const p2 = await patchWarpingOrder(r6.data.id, { notes: "meta serbest" }, U);
    check("PATCH IN_PROGRESS meta (not) serbest", p2.notes === "meta serbest" && p2.targetLengthM === "2000.000");
    const cpv = await cancelPreviewWarpingOrder(r6.data.id);
    check("İptal önizlemesi IN_PROGRESS'te iptal edilemez der", cpv.canCancel === false, JSON.stringify(cpv).slice(0, 160));
    const eCanIP = await errOf(() => cancelWarpingOrder(r6.data.id, "bekçi iptal", U));
    check("İptal IN_PROGRESS → 409 WARPING_ORDER_NOT_CANCELLABLE", eCanIP?.status === 409 && eCanIP.code === "WARPING_ORDER_NOT_CANCELLABLE", JSON.stringify(eCanIP));

    // ── İptal claim yarışı + iptal sonrası replay ───────────────────────
    const both = await Promise.allSettled([cancelWarpingOrder(r1.data.id, "yarış bir", U), cancelWarpingOrder(r1.data.id, "yarış iki", U)]);
    const ok = both.filter((b) => b.status === "fulfilled").length;
    const rej = both.filter((b) => b.status === "rejected").map((b) => (b as PromiseRejectedResult).reason as { statusCode?: number });
    check("İptal yarışı: tam biri başarılı, diğeri 409", ok === 1 && rej.length === 1 && rej[0]?.statusCode === 409, `ok=${ok} rej=${rej.map((r) => r.statusCode).join(",")}`);
    const after = await getWarpingOrder(r1.data.id);
    check("İptal: durum CANCELLED + damga + sebep", after.status === WarpingOrderStatus.CANCELLED && !!after.cancelledAt && !!after.cancelReason);
    const eRe = await errOf(() => createWarpingOrder({ ...base, clientToken: tok1, warpSpecId: cXYZ.id, beamLines: [{ beamCount: 1, beamLengthM: 1000 }] }, U));
    check("Replay: iptal edilmiş siparişin token'ı → 409 WARPING_ORDER_CANCELLED", eRe?.status === 409 && eRe.code === "WARPING_ORDER_CANCELLED", JSON.stringify(eRe));
    const ePatchC = await errOf(() => patchWarpingOrder(r1.data.id, { notes: "x" }, U));
    check("İptal edilmiş sipariş düzenlenemez → 409", ePatchC?.status === 409, JSON.stringify(ePatchC));
    const rAfter = await createWarpingOrder({ ...base, clientToken: randomUUID(), warpSpecId: cXYZ.id, beamLines: [{ beamCount: 1, beamLengthM: 10 }] }, U);
    orderIds.push(rAfter.data.id);
    check("Ücret birimi varsayılanı iptal sonrası da son canlı siparişin birimi (KG)", rAfter.data.fee.unit === WarpingFeeUnit.KG, rAfter.data.fee.unit);

    // ── DB seddi ─────────────────────────────────────────────────────────
    const eCk = await errOf(() => prisma.$executeRawUnsafe(`UPDATE warping_orders SET status = 'CANCELLED' WHERE id = $1::uuid`, rAfter.data.id));
    check("DB seddi: CANCELLED + cancelledAt NULL → warping_orders_status_ck reddeder", !!eCk && /warping_orders_status_ck/.test(eCk.msg), eCk?.msg.slice(0, 120));
  } finally {
    const ids = await prisma.warpingOrder.findMany({ where: { OR: [{ id: { in: orderIds } }, { warpSpecId: { in: specIds } }] }, select: { id: true } });
    const oids = ids.map((r) => r.id);
    await prisma.warpingOrderToOrder.deleteMany({ where: { warpingOrderId: { in: oids } } });
    await prisma.warpingOrderYarn.deleteMany({ where: { warpingOrderId: { in: oids } } });
    await prisma.warpingOrderExtraSpec.deleteMany({ where: { warpingOrderId: { in: oids } } });
    await prisma.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: { in: oids } } });
    await prisma.warpingOrder.deleteMany({ where: { id: { in: oids } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...oids, fabric.id, fabric2.id, fabric3.id] } } });
    await prisma.order.deleteMany({ where: { id: { in: [so.id, soDead.id] } } });
    await prisma.itemWarpLayer.deleteMany({ where: { itemId: { in: [fabric.id, fabric2.id, fabric3.id] } } });
    await prisma.item.deleteMany({ where: { id: { in: [fabric.id, fabric2.id, fabric3.id] } } });
    await prisma.warpSpec.deleteMany({ where: { id: { in: specIds } } });
    await prisma.item.deleteMany({ where: { id: { in: yarnIds } } });
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
