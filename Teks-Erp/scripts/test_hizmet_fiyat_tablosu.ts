// =============================================================================
// BEKÇİ — HİZMET FİYAT TABLOSU: kademe fiyatı sırası (K1) + tabloda olmayan kademe (K5) + S0
// =============================================================================
// Çalıştırma: npx tsx scripts/test_hizmet_fiyat_tablosu.ts
//
// NEDEN: Hizmet fiyatı artık kademe (çeşit değeri) başına girilebilir. Sıra tek helper'da
// (`service-price-pick.helper`): müşteri kademe → müşteri gram → genel kademe → istasyon gram → kalem.
// Kademe satırı yokken hesap BUGÜNKÜYLE aynı kalmalı (S0) — bayrak yok, davranış veriyle açılır.
//
// ÖLÇÜLENLER: S0 (saf sıra 10 kombinasyon + anlık görüntü bayt-aynı) · S1 genel kademe · S2 müşteri
// kademe · S3 müşteri gram > genel kademe · S4 genel kademe > istasyon gram · K5 tabloda olmayan kademe
// fiyatsız + uyarı · S5 ileri tarihli kademe as-of · S6 birim uyuşmazlığı · S7 iki kademe iki satır.
// Negatif sonda (PR gövdesinde): `pickServicePrice` içinde genel kademe gramdan önce alınınca S3 kırmızı;
// K5 dalı silinince K5a kırmızı; kademe adayı her zaman null verilince S1/S2/S4/S7 kırmızı.
// =============================================================================
import { randomUUID } from "node:crypto";
import { ItemType, PriceKind, Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { itemPriceService } from "../src/services/item-price.service";
import { resolveServiceItemsForRolls } from "../src/services/helpers/service-pricing.helper";
import { pickServicePrice } from "../src/services/helpers/service-price-pick.helper";
import { applyKursunOperationTx } from "../src/services/helpers/kursun-operation.helper";
import { KURSUN_PROPERTY_CODE } from "../src/services/helpers/quality-station.helper";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }

const INVOICE = { gramPriceBasis: "INVOICE_DATE" as const };
const STAMP = randomUUID().slice(0, 8);
const P = `TEST-HFT-${STAMP}`;
const fx = {
  itemIds: [] as string[], propIds: [] as string[], valueIds: [] as string[], woIds: [] as string[], rollIds: [] as string[],
  stationIds: [] as string[], machineIds: [] as string[], customerIds: [] as string[], cariIds: [] as string[],
  kursunCreated: null as string | null, variantRestore: null as { id: string; serviceItemId: string | null } | null,
};

async function main(): Promise<void> {
  console.log("=== Hizmet fiyat tablosu — S0 bayt-aynı · kademe sırası (K1) · tabloda olmayan kademe (K5) · as-of · iki kademe ===");
  const actor = await testActorId();

  let kursun = await prisma.fabricProperty.findUnique({ where: { code: KURSUN_PROPERTY_CODE }, select: { id: true } });
  if (!kursun) {
    kursun = await prisma.fabricProperty.create({ data: { code: KURSUN_PROPERTY_CODE, name: `TEST Kurşunlu ${STAMP}`, valueType: "FLAG" }, select: { id: true } });
    fx.kursunCreated = kursun.id;
  }
  let variant = await prisma.fabricProperty.findFirst({ where: { variantOfPropertyId: kursun.id }, select: { id: true, serviceItemId: true } });
  if (!variant) {
    variant = await prisma.fabricProperty.create({
      data: { code: `${P}-GR`.slice(0, 32), name: `TEST HFT gramaj ${STAMP}`, valueType: "CHOICE", variantOfPropertyId: kursun.id },
      select: { id: true, serviceItemId: true },
    });
    fx.propIds.push(variant.id);
  } else {
    fx.variantRestore = { id: variant.id, serviceItemId: variant.serviceItemId };
  }
  const variantId = variant.id;

  const fabric = (await prisma.item.create({ data: { code: `${P}-KUM`.slice(0, 32), name: `TEST HFT kumaş ${STAMP}`, itemType: ItemType.FABRIC, unit: "MT" }, select: { id: true } })).id;
  const svc = (await prisma.item.create({ data: { code: `${P}-SVC`.slice(0, 32), name: `TEST HFT Kurşun ${STAMP}`, itemType: ItemType.SERVICE, unit: "MT" }, select: { id: true } })).id;
  fx.itemIds.push(fabric, svc);
  await itemPriceService.upsert({ itemId: svc, kind: PriceKind.SALE, currency: "TRY", price: 3 });
  // Gramaj başına kalem ZORUNLU DEĞİL: değerde kalem yok, çeşidin tek "Kurşun" kalemine düşülür (pickServiceItemId).
  await prisma.fabricProperty.update({ where: { id: variantId }, data: { serviceItemId: svc } });

  const mkVal = async (n: string, amount: string | null, sort: number) => {
    const v = await prisma.fabricPropertyValue.create({ data: { propertyId: variantId, code: `KG${n}-${STAMP}`.slice(0, 32).toUpperCase(), name: `${n} gr`, sortOrder: sort, amount }, select: { id: true } });
    fx.valueIds.push(v.id);
    return v.id;
  };
  const V40 = await mkVal("40", "40", 10);
  const VNA = await mkVal("55", null, 20);
  const V50 = await mkVal("50", "50", 30);

  const cust = await prisma.customer.create({ data: { code: `${P}-C`.slice(0, 32), name: `TEST HFT müşteri ${STAMP}` }, select: { id: true } });
  fx.customerIds.push(cust.id);
  const cust2 = (await prisma.customer.create({ data: { code: `${P}-C2`.slice(0, 32), name: `TEST HFT müşteri2 ${STAMP}` }, select: { id: true } })).id;
  fx.customerIds.push(cust2);
  const st = await prisma.station.create({
    data: { code: `${P}-K`.slice(0, 32), name: `TEST HFT kurşun ${STAMP}`, type: "INTERNAL", kind: "PROCESS_QC", appliesProperty: true, kursunGramPrice: "0.05", kursunGramCurrency: "TRY" },
    select: { id: true },
  });
  fx.stationIds.push(st.id);
  const m = await prisma.machine.create({ data: { stationId: st.id, code: `${P}-M`.slice(0, 32), name: `TEST HFT makine ${STAMP}` }, select: { id: true } });
  fx.machineIds.push(m.id);
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${P}-WO`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: fabric, steps: { create: [{ stationId: st.id, stepSequence: 1, status: "ACTIVE" as const }] } },
    select: { id: true, steps: { select: { id: true } } },
  });
  fx.woIds.push(wo.id);
  const S1 = wo.steps[0]!.id;
  let seq = 0;
  const mkPressed = async (meters: number, valueId: string) => {
    seq++;
    const roll = await prisma.roll.create({ data: { itemId: fabric, barcode: `${P}-R${seq}`, initialQty: meters, currentQty: meters, status: "IN_PRODUCTION", currentStepId: S1 }, select: { id: true } });
    fx.rollIds.push(roll.id);
    await prisma.rollMovement.create({ data: { rollId: roll.id, workOrderStepId: S1, qtyIn: meters, qtyOut: meters, exitedAt: new Date() } });
    await prisma.$transaction((tx) => applyKursunOperationTx(tx, { rollId: roll.id, stepId: S1, valueId, userId: actor, machineId: m.id }));
    return roll.id;
  };
  const r40 = await mkPressed(500, V40);
  const rNA = await mkPressed(200, VNA);
  const r40b = await mkPressed(300, V40);
  const r50 = await mkPressed(100, V50);
  const other = (await prisma.item.create({ data: { code: `${P}-SV2`.slice(0, 32), name: `TEST HFT başka ${STAMP}`, itemType: ItemType.SERVICE, unit: "MT" }, select: { id: true } })).id;
  fx.itemIds.push(other);



  const res = (rollIds: string[], customerId: string | null = null, extra: object = {}) =>
    resolveServiceItemsForRolls({ rollIds, customerId, currency: "TRY", options: { ...INVOICE, priceAsOf: new Date(), ...extra } });
  const snap = async () => JSON.stringify([await res([r40, rNA, r50]), await res([r40, rNA, r50], cust.id)].map((x) => ({ lines: x.lines, warnings: x.warnings })));
  const prices = (x: Awaited<ReturnType<typeof res>>) => x.lines.map((l) => `${l.label ?? l.name}=${l.unitPrice}`).sort().join(" | ");

  section("S0 kademe satırı yokken hesap bugünküyle aynı");
  // Fiyat anı = şimdi (DISPATCH_DAY gibi): kademe satırları işten SONRA girildi, hizmet anına çözülseydi okunmazdı (as-of doğru).
  // Saf sıra: kademe adayı yokken her kombinasyonda bugünkü kural (gram ?? kalem; gram sahibi/geç farketmez).
  const D = (n: number) => new Prisma.Decimal(n);
  let pureOk = true;
  for (const gram of [null, { unitPrice: D(2), amount: D(40), owner: "CUSTOMER" as const, late: false }, { unitPrice: D(2), amount: D(40), owner: "CUSTOMER" as const, late: true }, { unitPrice: D(2), amount: D(40), owner: "STATION" as const, late: false }, { unitPrice: D(2), amount: D(40), owner: "STATION" as const, late: true }]) {
    for (const item of [null, D(3)]) {
      const p = pickServicePrice({ customerTier: null, generalTier: null, gram, item, itemHasTiers: false, valueInTable: false });
      const legacy = gram?.unitPrice ?? item ?? null;
      if (String(p.unitPrice) !== String(legacy) || p.tierMissing) pureOk = false;
    }
  }
  check("S0a ⭐ saf sıra: kademesiz 10 kombinasyonun hepsi bugünkü kurala (gram ?? kalem) eşit", pureOk);
  await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: cust.id, kursunGramPrice: "0.04", kursunGramCurrency: "TRY" }, select: { id: true } }).then((c) => fx.cariIds.push(c.id));
  const before = await snap();
  check("S0b bugünkü değerler: istasyon gram 2 (40×0,05), 50 gr 2,5, gramajsız → kalem 3; cari gram 1,6", prices(await res([r40, rNA, r50])) === "Kurşun 40 gr (40 gr/m)=2 | Kurşun 50 gr (50 gr/m)=2.5 | TEST HFT Kurşun " + STAMP + "=3" && prices(await res([r40], cust.id)) === "Kurşun 40 gr (40 gr/m)=1.6", prices(await res([r40, rNA, r50])));
  // Başka bir hizmetin kademe tablosu bu hizmetin hesabını değiştirmez.
  const otherProp = await prisma.fabricProperty.create({ data: { code: `${P}-OP`.slice(0, 32), name: `TEST HFT op ${STAMP}`, valueType: "FLAG", serviceItemId: other }, select: { id: true } });
  fx.propIds.push(otherProp.id);
  const otherVal = await prisma.fabricPropertyValue.create({ data: { propertyId: otherProp.id, code: `HFTO-${STAMP}`.slice(0, 32).toUpperCase(), name: "x" }, select: { id: true } });
  fx.valueIds.push(otherVal.id);
  await itemPriceService.upsert({ itemId: other, propertyValueId: otherVal.id, kind: PriceKind.SALE, currency: "TRY", price: 99 });
  check("S0c ⭐ kademe satırı (başka hizmette) eklendikten sonra satırlar + uyarılar BAYT-AYNI", (await snap()) === before);

  section("S1–S4 kademe sırası (K1)");
  await prisma.station.update({ where: { id: st.id }, data: { kursunGramPrice: null, kursunGramCurrency: null } });
  await itemPriceService.upsert({ itemId: svc, propertyValueId: V40, kind: PriceKind.SALE, currency: "TRY", price: 7 });
  const s1 = await res([r40]);
  check("S1 ⭐ genel 40 gr kademesi 7 → satır 'Kurşun 40 gr' 7", s1.lines.length === 1 && s1.lines[0]!.unitPrice === "7" && s1.lines[0]!.label === "Kurşun 40 gr", prices(s1));
  await itemPriceService.upsert({ itemId: svc, customerId: cust2, propertyValueId: V40, kind: PriceKind.SALE, currency: "TRY", price: 6.5 });
  check("S2 ⭐ müşteri 40 gr kademesi 6,5 → 6,5", prices(await res([r40], cust2)) === "Kurşun 40 gr=6.5", prices(await res([r40], cust2)));
  check("S3 ⭐ müşteri gram fiyatı (0,04) genel kademeden önce → 1,6", prices(await res([r40], cust.id)) === "Kurşun 40 gr (40 gr/m)=1.6", prices(await res([r40], cust.id)));
  await prisma.station.update({ where: { id: st.id }, data: { kursunGramPrice: "0.05", kursunGramCurrency: "TRY" } });
  check("S4 ⭐ genel kademe istasyon gram fiyatından önce → 7", prices(await res([r40])) === "Kurşun 40 gr=7", prices(await res([r40])));
  check("S4b müşteri kademesi müşteri gramından önce (cust2'ye gram yok; kademe 6,5)", prices(await res([r40], cust2)) === "Kurşun 40 gr=6.5");

  section("K5 tabloda olmayan kademe");
  const k5 = await res([rNA]);
  check("K5a ⭐ kademesi tabloda yok + gram yok → kalem fiyatına (3) DÜŞMEZ, fiyatsız + uyarı", k5.lines.length === 1 && k5.lines[0]!.unitPrice === null && k5.warnings.some((w) => w.includes("hizmet fiyat tablosunda 1 işin kademesi yok")), JSON.stringify([prices(k5), k5.warnings]));
  check("K5b kademesi tabloda yok ama gram fiyatı var → gram formülü (50 × 0,05 = 2,5)", prices(await res([r50])) === "Kurşun 50 gr (50 gr/m)=2.5", prices(await res([r50])));

  section("S5 as-of (ileri tarihli kademe fiyatı)");
  const later = new Date(Date.now() + 2 * 24 * 3600 * 1000);
  await itemPriceService.upsert({ itemId: svc, propertyValueId: V40, kind: PriceKind.SALE, currency: "TRY", price: 9, validFrom: new Date(Date.now() + 24 * 3600 * 1000) });
  check("S5 ⭐ fiyat değişti (ileri tarih): bugünkü iş eski fiyat 7, değişimden sonraki an 9", prices(await res([r40])) === "Kurşun 40 gr=7" && prices(await res([r40], null, { priceAsOf: later })) === "Kurşun 40 gr=9", prices(await res([r40], null, { priceAsOf: later })));

  section("S6 birim uyuşmazlığı");
  await itemPriceService.upsert({ itemId: svc, propertyValueId: V50, kind: PriceKind.SALE, currency: "TRY", price: 4, priceUnit: "PIECE" });
  check("S6 adet birimli kademe satırı metre işine uygulanmaz (gram 2,5 kalır)", prices(await res([r50])) === "Kurşun 50 gr (50 gr/m)=2.5", prices(await res([r50])));

  section("S7 iki kademe, aynı kalem");
  await itemPriceService.upsert({ itemId: svc, propertyValueId: V50, kind: PriceKind.SALE, currency: "TRY", price: 8, priceUnit: "METER" });
  const s7 = await res([r40, r40b, r50]);
  const sumLines = s7.lines.reduce((a, l) => a + Number(l.quantity), 0);
  const sumWorks = s7.works.filter((w) => w.serviceItemId).reduce((a, w) => a + Number(w.quantity), 0);
  check("S7 ⭐ 40/50 gr farklı fiyat → iki satır (40 gr: 800 m × 7, 50 gr: 100 m × 8), Σqty = Σiş", s7.lines.length === 2 && prices(s7) === "Kurşun 40 gr=7 | Kurşun 50 gr=8" && sumLines === 900 && sumWorks === 900, `${prices(s7)} Σ=${sumLines}/${sumWorks}`);
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  const ids = fx.rollIds;
  await del("rollProperty", () => prisma.rollProperty.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollOperation", () => prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: ids } } }));
  await del("travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("machine", () => prisma.machine.deleteMany({ where: { id: { in: fx.machineIds } } }));
  await del("stationProperty", () => prisma.stationProperty.deleteMany({ where: { stationId: { in: fx.stationIds } } }));
  // Bekçi kendi fikstür sürümlerini kaldırır (src'de sürüm silinmez — defter-beyan §10).
  await del("gramSürüm", () => prisma.kursunGramPriceVersion.deleteMany({ where: { OR: [{ stationId: { in: fx.stationIds } }, { cariAccountId: { in: fx.cariIds } }] } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  // Kademe fiyat satırı değere RESTRICT FK'lıdır: önce fiyat.
  await del("itemPrice", () => prisma.itemPrice.deleteMany({ where: { itemId: { in: fx.itemIds } } }));
  await del("value", () => prisma.fabricPropertyValue.deleteMany({ where: { OR: [{ id: { in: fx.valueIds } }, { propertyId: { in: fx.propIds } }] } }));
  if (fx.variantRestore) { const r = fx.variantRestore; await del("variant geri", () => prisma.fabricProperty.update({ where: { id: r.id }, data: { serviceItemId: r.serviceItemId } })); }
  await del("variant bağı", () => prisma.fabricProperty.updateMany({ where: { id: { in: fx.propIds } }, data: { variantOfPropertyId: null } }));
  await del("property", () => prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } }));
  if (fx.kursunCreated) { const k = fx.kursunCreated; await del("KURSUN", () => prisma.fabricProperty.deleteMany({ where: { id: k } })); }
  await del("item", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  await del("cari", () => prisma.cariAccount.deleteMany({ where: { id: { in: fx.cariIds } } }));
  await del("customer", () => prisma.customer.deleteMany({ where: { id: { in: fx.customerIds } } }));
  const left = await prisma.roll.count({ where: { barcode: { startsWith: P } } });
  check("temizlik: TEST-HFT top kalıntısı yok", left === 0, String(left));
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    await cleanup().catch((e) => { fail++; console.error(e); });
    if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
