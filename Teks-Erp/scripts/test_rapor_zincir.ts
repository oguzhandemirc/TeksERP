// =============================================================================
// BEKÇİ — Üretim Zinciri hub raporu (Z3, 2026-09-18) — `getProductionChain` sözleşmesi (URETIM-ZINCIRI-HUB-EKRAN-SOZLESMESI §8.5)
// =============================================================================
//   ① zincir satırı dört belgeyi de doğru bağlar (sipariş satırı → iş emri + adım → dokuma işi + Σkoşum/plan → levent + kalan)
//   ② bağsız kayıt kovaları sayıyı DOĞRU verir — satır listesinden DEĞİL kendi sayımından (delta ölçümü: bağla/iptal et → düşer)
//   ③ devere KAPALI → satırda `levent` anahtarı HİÇ yok, kovada `issizLevent` yok, `moduller.devere` false
//   ④ `plannedM` null dokuma işinde ilerleme null (yüzde uydurulmaz), dokunanM 0
//   ⑤ süzgeç yokken iki çağrı bayt bayt aynı; `dusenSatir` yok · süzgeçler: müşteri (DB) · gecikmiş · durum (satır) + dusenSatir
//   NEGATİF SONDALAR (ölçüldü): kovalar satır listesinden türetilirse ② delta 0 → ❌ · plannedM null'da ilerleme 0 → ④ ❌
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar fotoğrafına döner. Fikstür `TESTZ3<ts>`.
// =============================================================================
import { ItemType, OrderStatus, Prisma, RollEntrySource, RollStatus, StationType, WarpBeamOrigin, WeavingExecutionKind } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWeavingOrder, cancelWeavingOrder } from "../src/services/weaving-order.service";
import { createWarpBeam, updateWarpBeam } from "../src/services/warp-beam.service";
import { getProductionChain, lateDays, progressPct, rowStatus } from "../src/services/reports/production-chain.report.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✓" : "✗ FAIL:"} ${label}${extra ? ` — ${extra}` : ""}`);
}
const T = `TESTZ3${Date.now().toString(36).toUpperCase()}`;
const FLAGS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.TICARET_ENABLED, SETTING_KEYS.IPLIK_ENABLED];
const ids = { item: "", spec: "", customer: "", customer2: "", order: "", order2: "", line1: "", line2: "", line3: "", station: "", machine: "", wo: "", step: "" };
const weavingOrderIds: string[] = [];
const beamIds: string[] = [];
const rollIds: string[] = [];
let foto: Array<{ key: string; value: Prisma.JsonValue }> = [];
const bayrak = (key: string, value: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU: ${engel}`);
  foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  try {
    for (const k of FLAGS) await bayrak(k, true);
    console.log("\n§0 saf yardımcılar");
    check("lateDays: plan bitişi 3 gün önce → 3; bugün/ileri → null; yok → null", lateDays(new Date(Date.now() - 3 * 86_400_000)) === 3 && lateDays(new Date()) === null && lateDays(new Date(Date.now() + 86_400_000)) === null && lateDays(null) === null);
    check("progressPct: 200/500 → 40; plan null → null; plan 0 → null; 600/500 → 120 (hedef tetik değil)", progressPct(200, 500) === 40 && progressPct(10, null) === null && progressPct(10, 0) === null && progressPct(600, 500) === 120);
    check("rowStatus: sevk ≥ sipariş → TAMAMLANAN; gecikme → GECIKMIS; bağ var → DEVAM; hiç yok → BEKLEYEN", rowStatus({ siparisM: 100, sevkM: 100, gecikmeGun: 5, isEmri: null, dokuma: null }) === "TAMAMLANAN" && rowStatus({ siparisM: 100, sevkM: 0, gecikmeGun: 5, isEmri: null, dokuma: {} }) === "GECIKMIS" && rowStatus({ siparisM: 100, sevkM: 0, gecikmeGun: null, isEmri: {}, dokuma: null }) === "DEVAM" && rowStatus({ siparisM: 100, sevkM: 0, gecikmeGun: null, isEmri: null, dokuma: null }) === "BEKLEYEN");

    // ── fikstür ────────────────────────────────────────────────────────────
    const yarn = await prisma.item.create({ data: { code: `${T}-IP`, name: `${T} iplik`, itemType: ItemType.YARN, unit: "KG", linearDensityDen: 300 }, select: { id: true } });
    ids.item = (await prisma.item.create({ data: { code: `${T}-K`, name: `${T} kumaş`, itemType: ItemType.FABRIC }, select: { id: true } })).id;
    ids.spec = (await prisma.warpSpec.create({ data: { code: `${T}-CK`, name: `${T} çözgü`, yarnItemId: yarn.id, endsCount: 3000 }, select: { id: true } })).id;
    ids.customer = (await prisma.customer.create({ data: { code: `${T}-M`, name: `${T} Müşteri A`, isCustomerRole: true, isSupplierRole: true }, select: { id: true } })).id;
    ids.customer2 = (await prisma.customer.create({ data: { code: `${T}-M2`, name: `${T} Müşteri B`, isCustomerRole: true }, select: { id: true } })).id;
    const past = new Date(Date.now() - 5 * 86_400_000);
    const order = await prisma.order.create({ data: { orderNumber: `${T}-SIP`, customerId: ids.customer, status: OrderStatus.APPROVED, lines: { create: [{ itemId: ids.item, quantity: 300 }, { itemId: ids.item, quantity: 200 }] } }, select: { id: true, lines: { select: { id: true }, orderBy: { createdAt: "asc" } } } });
    ids.order = order.id; ids.line1 = order.lines[0]!.id; ids.line2 = order.lines[1]!.id;
    const order2 = await prisma.order.create({ data: { orderNumber: `${T}-SIP2`, customerId: ids.customer2, status: OrderStatus.PENDING, deadline: past, lines: { create: [{ itemId: ids.item, quantity: 50 }] } }, select: { id: true, lines: { select: { id: true } } } });
    ids.order2 = order2.id; ids.line3 = order2.lines[0]!.id;
    const st = await prisma.station.create({ data: { name: `${T}-DOKUMA`, code: `${T}-DK`.slice(0, 32), type: StationType.INTERNAL, consumesWarpBeam: true }, select: { id: true } });
    ids.station = st.id;
    ids.machine = (await prisma.machine.create({ data: { stationId: st.id, name: `${T}-T1`, code: `${T}-T1`.slice(0, 32), warpBeamSlots: 2 }, select: { id: true } })).id;
    // iş emri: line1'e bağlı, iki adım (1 COMPLETED · 2 ACTIVE) → adım = 2. istasyon adı
    const st2 = await prisma.station.create({ data: { name: `${T}-KK1`, code: `${T}-KK`.slice(0, 32), type: StationType.INTERNAL }, select: { id: true } });
    const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${T}-WO`, status: "IN_PROGRESS", orderLinks: { create: [{ orderLineId: ids.line1 }] }, steps: { create: [{ stationId: st.id, stepSequence: 1, status: "COMPLETED" }, { stationId: st2.id, stepSequence: 2, status: "ACTIVE" }] } }, select: { id: true, steps: { select: { id: true }, orderBy: { stepSequence: "asc" } } } });
    ids.wo = wo.id; ids.step = wo.steps[1]!.id;
    // dokuma işi: line1'e bağlı, plan 500, koşum 200 m (+ iptal edilmiş koşum 999 m SAYILMAZ)
    const dk = (await createWeavingOrder({ itemId: ids.item, executionKind: WeavingExecutionKind.IN_HOUSE, warpSpecId: ids.spec, plannedM: 500, orderLines: [{ orderLineId: ids.line1, allocatedM: 300 }] })).data;
    weavingOrderIds.push(dk.id);
    await prisma.machineRun.create({ data: { machineId: ids.machine, startedAt: new Date(Date.now() - 3600_000), endedAt: new Date(), weavingOrderId: dk.id, producedM: "200" } });
    await prisma.machineRun.create({ data: { machineId: ids.machine, startedAt: new Date(Date.now() - 7200_000), endedAt: new Date(Date.now() - 3700_000), weavingOrderId: dk.id, producedM: "999", revokedAt: new Date() } });
    // dokuma işi 2: line2'ye bağlı, plan YOK
    const dk2 = (await createWeavingOrder({ itemId: ids.item, executionKind: WeavingExecutionKind.IN_HOUSE, warpSpecId: ids.spec, orderLines: [{ orderLineId: ids.line2 }] })).data;
    weavingOrderIds.push(dk2.id);
    // levent: dk'ya bağlı (planlı, 100 m)
    const b1 = (await createWarpBeam({ warpSpecId: ids.spec, plannedLengthM: 100, originKind: WarpBeamOrigin.PURCHASED, supplierId: ids.customer, weavingOrderId: dk.id })).data;
    beamIds.push(b1.id);
    // BAĞSIZ kayıtlar: işsiz levent · siparişsiz dokuma · dışarıdan gelen top (iş emri adımında)
    const bBos = (await createWarpBeam({ warpSpecId: ids.spec, plannedLengthM: 80, originKind: WarpBeamOrigin.PURCHASED, supplierId: ids.customer })).data;
    beamIds.push(bBos.id);
    const dkBos = (await createWeavingOrder({ itemId: ids.item, executionKind: WeavingExecutionKind.IN_HOUSE, warpSpecId: ids.spec, plannedM: 100 })).data;
    weavingOrderIds.push(dkBos.id);
    const roll = await prisma.roll.create({ data: { barcode: `${T}-R1`, itemId: ids.item, initialQty: 40, currentQty: 40, status: RollStatus.IN_PRODUCTION, entrySource: RollEntrySource.SEMI_FINISHED, currentStepId: ids.step }, select: { id: true } });
    rollIds.push(roll.id);

    // ── ① zincir satırı ───────────────────────────────────────────────────
    console.log("\n§1 zincir satırı dört belgeyi bağlar");
    const r = await getProductionChain();
    const s1 = r.satirlar.find((x) => x.orderLineId === ids.line1);
    check("satır var; müşteri/kumaş/sipariş no", !!s1 && s1.musteri.id === ids.customer && s1.kumas.id === ids.item && s1.siparis.no === `${T}-SIP` && s1.siparisM === 300 && s1.sevkM === 0, JSON.stringify(s1 && { m: s1.musteri.ad, k: s1.kumas.ad, q: s1.siparisM }));
    check("⭐ iş emri: no + durum + adım = ACTIVE adımın istasyonu (KK1)", s1?.isEmri?.no === `${T}-WO` && s1.isEmri.durum === "IN_PROGRESS" && s1.isEmri.adim === `${T}-KK1`, JSON.stringify(s1?.isEmri));
    check("⭐ dokuma: Σkoşum 200 (iptal 999 sayılmaz) / plan 500 → %40; durum işin kendisi", s1?.dokuma?.dokunanM === 200 && s1.dokuma.planM === 500 && s1.dokuma.ilerlemePct === 40 && s1.dokuma.no === dk.weavingOrderNumber, JSON.stringify(s1?.dokuma));
    check("⭐ levent: en ileri canlı levent (planlı) + kalan defterden (sarılmadı → 0)", s1?.levent?.id === b1.id && s1.levent.durum === "PLANNED" && s1.levent.kalanM === 0, JSON.stringify(s1?.levent));
    check("durum DEVAM (bağ var, gecikme yok, sevk yok)", s1?.durum === "DEVAM" && s1.gecikmeGun === null);
    check("moduller.devere true", r.moduller.devere === true);

    // ── ④ plan yok → ilerleme null ────────────────────────────────────────
    console.log("\n§4 plannedM null");
    const s2 = r.satirlar.find((x) => x.orderLineId === ids.line2);
    check("⭐ plan yok → planM null, ilerlemePct NULL (0 değil), dokunanM 0; iş emri yok → null", s2?.dokuma?.planM === null && s2.dokuma.ilerlemePct === null && s2.dokuma.dokunanM === 0 && s2.isEmri === null && s2.levent === null, JSON.stringify(s2?.dokuma));

    // ── gecikme + süzgeçler ─────────────────────────────────────────────────
    console.log("\n§5 gecikme ve süzgeçler");
    const s3 = r.satirlar.find((x) => x.orderLineId === ids.line3);
    check("⭐ dokumasız satırda gecikme sipariş teslim tarihinden (5 gün) → GECIKMIS, BEKLEYEN değil", s3?.gecikmeGun === 5 && s3.durum === "GECIKMIS", JSON.stringify({ g: s3?.gecikmeGun, d: s3?.durum }));
    check("ozet: satir = liste + omitted; gecikmis ≥ 1; bagsiz = kovalar toplamı", r.ozet.satir === r.satirlar.length + r.satirOmitted && r.ozet.gecikmis >= 1 && r.ozet.bagsiz === (r.kovalar.issizLevent ?? 0) + r.kovalar.siparissizDokuma + r.kovalar.disaridanTop);
    check("secenekler.customerId iki müşteriyi de içerir (süzgeçten bağımsız)", r.secenekler.customerId!.some((o) => o.id === ids.customer) && r.secenekler.customerId!.some((o) => o.id === ids.customer2) && r.dusenSatir === undefined);
    const rM = await getProductionChain({ customerId: [ids.customer2] });
    check("⭐ müşteri süzgeci: yalnız B'nin satırı; seçenekler DARALMAZ; dusenSatir = evren − 1", rM.satirlar.length === 1 && rM.satirlar[0]!.orderLineId === ids.line3 && rM.secenekler.customerId!.some((o) => o.id === ids.customer) && rM.dusenSatir === r.ozet.satir - 1, `dusen=${rM.dusenSatir} evren=${r.ozet.satir}`);
    const rG = await getProductionChain({ gecikmis: "true" });
    check("gecikmis=true → her satır gecikmeli, line3 içinde, line1 dışında", rG.satirlar.every((x) => x.gecikmeGun != null) && rG.satirlar.some((x) => x.orderLineId === ids.line3) && !rG.satirlar.some((x) => x.orderLineId === ids.line1));
    const rD = await getProductionChain({ durum: "DEVAM" });
    check("durum=DEVAM → line1 içinde, line3 dışında; dusenSatir tanımlı", rD.satirlar.some((x) => x.orderLineId === ids.line1) && !rD.satirlar.some((x) => x.orderLineId === ids.line3) && typeof rD.dusenSatir === "number");

    // ── ⑤ determinizm ────────────────────────────────────────────────────────
    const r2 = await getProductionChain();
    check("⭐ süzgeçsiz iki çağrı bayt bayt aynı", JSON.stringify(r) === JSON.stringify(r2));

    // ── ② kovalar: delta ölçümü ─────────────────────────────────────────────
    console.log("\n§2 bağsız kovalar (delta)");
    const once = r.kovalar;
    await updateWarpBeam(bBos.id, { weavingOrderId: dk.id });
    await cancelWeavingOrder(dkBos.id, "bekçi");
    await prisma.roll.update({ where: { id: roll.id }, data: { currentStepId: null } });
    const sonra = (await getProductionChain()).kovalar;
    check("⭐ işsiz levent bağlanınca kova 1 düşer", (once.issizLevent ?? 0) - (sonra.issizLevent ?? 0) === 1, `${once.issizLevent} → ${sonra.issizLevent}`);
    check("⭐ siparişsiz dokuma iptal edilince kova 1 düşer", once.siparissizDokuma - sonra.siparissizDokuma === 1, `${once.siparissizDokuma} → ${sonra.siparissizDokuma}`);
    check("⭐ dışarıdan top adımdan çıkınca kova 1 düşer", once.disaridanTop - sonra.disaridanTop === 1, `${once.disaridanTop} → ${sonra.disaridanTop}`);

    // ── ③ devere kapalı ─────────────────────────────────────────────────────
    console.log("\n§3 devere kapalı");
    await bayrak(SETTING_KEYS.DEVERE_ENABLED, false);
    const rK = await getProductionChain();
    const k1 = rK.satirlar.find((x) => x.orderLineId === ids.line1)!;
    check("⭐ satırda `levent` anahtarı HİÇ yok; kovada issizLevent yok; moduller.devere false", !("levent" in k1) && !("issizLevent" in rK.kovalar) && rK.moduller.devere === false, JSON.stringify(Object.keys(k1)));
    check("öteki alanlar aynen (iş emri + dokuma)", k1.isEmri?.no === `${T}-WO` && k1.dokuma?.ilerlemePct === 40);
  } finally {
    await temizle();
    await prisma.$disconnect();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(): Promise<void> {
  if (rollIds.length > 0) await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  if (ids.station) await prisma.machineRun.deleteMany({ where: { machine: { stationId: ids.station } } });
  if (beamIds.length > 0) {
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
  }
  if (weavingOrderIds.length > 0) {
    await prisma.weavingOrderToOrderLine.deleteMany({ where: { weavingOrderId: { in: weavingOrderIds } } });
    await prisma.weavingOrder.deleteMany({ where: { id: { in: weavingOrderIds } } });
  }
  if (ids.wo) {
    await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: ids.wo } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: ids.wo } });
    await prisma.workOrder.deleteMany({ where: { id: ids.wo } });
  }
  for (const o of [ids.order, ids.order2]) if (o) { await prisma.orderLine.deleteMany({ where: { orderId: o } }); await prisma.order.deleteMany({ where: { id: o } }); }
  if (ids.station) await prisma.machine.deleteMany({ where: { stationId: ids.station } });
  await prisma.station.deleteMany({ where: { code: { startsWith: T } } });
  await prisma.warpSpec.deleteMany({ where: { code: { startsWith: T } } });
  await prisma.item.deleteMany({ where: { code: { startsWith: T } } });
  await prisma.customer.deleteMany({ where: { code: { startsWith: T } } });
  for (const key of FLAGS) {
    const eski = foto.find((f) => f.key === key);
    if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});
