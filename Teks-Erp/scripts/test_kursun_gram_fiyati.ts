// =============================================================================
// BEKÇİ — KURŞUN GRAM FİYATI + İSTASYON GRAMAJ TABLOSU (oie-a, 2026-11-02)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_kursun_gram_fiyati.ts
//
// NEDEN: Kurşun fiyatı gramla doğru orantılı (K1/K2): birim metre fiyatı = gramaj (gr/m) ×
// gram fiyatı; müşteriye özel gram fiyatı istasyonunkini ezer; fiyat ya da gramaj sayısı yoksa
// BUGÜNKÜ hizmet kalemi fiyatı kalır. Gramaj tablosu çeşit başına TEK varsayılan taşır (DB sınırı).
//
// ÖLÇÜLENLER:
//   §1 500 m × 40 gr/m × 0,05 = 1000; satır açıklaması "Kurşun 40 gr (40 gr/m)"
//   §2 Müşteri (cari) özel gram fiyatı istasyonunkini ezer (0,04 → 800)
//   §1b Gram fiyatı tarihsiz (fatura anındaki değer) → taslak uyarısı; uygulanmayınca uyarı yok
//   §3 Gram fiyatı yok → eski kalem fiyatı; gramaj sayısı yok → eski kalem fiyatı; para birimi farklı → eski
//   §4 Tek varsayılan: DB kısmi unique (23505/P2002) + servis 400 PROPERTY_VALUE_MULTIPLE_DEFAULT
//   §5 İstasyon kurşun ucu: aç → AUTO satırı; gramaj ekle (amount + varsayılan); kapa → satır yok; fiyat para birimsiz 400
// Negatif sonda: `applyKursunGramPrices` çağrısı kaldırılınca §1/§2 kırmızı (PR gövdesinde).
// =============================================================================
import { randomUUID } from "node:crypto";
import { ItemType, PriceKind, StationPropertyMode } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { fabricPropertyService } from "../src/routes/fabric-property.routes";
import { itemPriceService } from "../src/services/item-price.service";
import { resolveServiceItemsForRolls } from "../src/services/helpers/service-pricing.helper";
import { applyKursunOperationTx } from "../src/services/helpers/kursun-operation.helper";
import { KURSUN_PROPERTY_CODE } from "../src/services/helpers/quality-station.helper";
import { getKursunStation, setKursunStation } from "../src/services/kursun-station.service";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }
async function errOf(fn: () => Promise<unknown>): Promise<{ status: number; code: string | null; pg: string | null }> {
  try { await fn(); return { status: 200, code: null, pg: null }; } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string }; code?: string; message?: string };
    const msg = x.message ?? "";
    const pg = /23514|default_active_ck|check constraint/i.test(msg) ? "CHECK" : x.code === "P2002" || /23505|unique/i.test(msg) ? "UNIQUE" : (x.code ?? null);
    return { status: x.statusCode ?? 500, code: x.details?.code ?? null, pg };
  }
}

const STAMP = randomUUID().slice(0, 8);
const P = `TEST-KGF-${STAMP}`;
const fx = {
  itemIds: [] as string[], propIds: [] as string[], valueIds: [] as string[], woIds: [] as string[], rollIds: [] as string[],
  stationIds: [] as string[], machineIds: [] as string[], customerIds: [] as string[], cariIds: [] as string[],
  kursunCreated: null as string | null, variantRestore: null as { id: string; serviceItemId: string | null } | null,
};

async function main(): Promise<void> {
  console.log("=== Kurşun gram fiyatı — gr/m × gram fiyatı · cari ezer · eski fiyat · tek varsayılan · istasyon ucu ===");
  const actor = await testActorId();

  let kursun = await prisma.fabricProperty.findUnique({ where: { code: KURSUN_PROPERTY_CODE }, select: { id: true } });
  if (!kursun) {
    kursun = await prisma.fabricProperty.create({ data: { code: KURSUN_PROPERTY_CODE, name: `TEST Kurşunlu ${STAMP}`, valueType: "FLAG" }, select: { id: true } });
    fx.kursunCreated = kursun.id;
  }
  let variant = await prisma.fabricProperty.findFirst({ where: { variantOfPropertyId: kursun.id }, select: { id: true, serviceItemId: true } });
  if (!variant) {
    variant = await prisma.fabricProperty.create({
      data: { code: `${P}-GR`.slice(0, 32), name: `TEST KGF gramaj ${STAMP}`, valueType: "CHOICE", variantOfPropertyId: kursun.id },
      select: { id: true, serviceItemId: true },
    });
    fx.propIds.push(variant.id);
  } else {
    fx.variantRestore = { id: variant.id, serviceItemId: variant.serviceItemId };
  }
  const variantId = variant.id;

  const fabric = (await prisma.item.create({ data: { code: `${P}-KUM`.slice(0, 32), name: `TEST KGF kumaş ${STAMP}`, itemType: ItemType.FABRIC, unit: "MT" }, select: { id: true } })).id;
  const svc = (await prisma.item.create({ data: { code: `${P}-SVC`.slice(0, 32), name: `TEST KGF Kurşun ${STAMP}`, itemType: ItemType.SERVICE, unit: "MT" }, select: { id: true } })).id;
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

  const cust = await prisma.customer.create({ data: { code: `${P}-C`.slice(0, 32), name: `TEST KGF müşteri ${STAMP}` }, select: { id: true } });
  fx.customerIds.push(cust.id);
  const st = await prisma.station.create({
    data: { code: `${P}-K`.slice(0, 32), name: `TEST KGF kurşun ${STAMP}`, type: "INTERNAL", kind: "PROCESS_QC", appliesProperty: true, kursunGramPrice: "0.05", kursunGramCurrency: "TRY" },
    select: { id: true },
  });
  fx.stationIds.push(st.id);
  const m = await prisma.machine.create({ data: { stationId: st.id, code: `${P}-M`.slice(0, 32), name: `TEST KGF makine ${STAMP}` }, select: { id: true } });
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

  section("§1 500 m × 40 gr/m × 0,05 = 1000");
  const a = await resolveServiceItemsForRolls({ rollIds: [r40], customerId: null, currency: "TRY" });
  const l = a.lines[0];
  const total = l ? Number(l.unitPrice) * Number(l.quantity) : NaN;
  check("birim metre fiyatı 2 (40 × 0,05), miktar 500, tutar 1000", a.lines.length === 1 && Number(l?.unitPrice) === 2 && Number(l?.quantity) === 500 && total === 1000, JSON.stringify(a.lines.map((x) => [x.unitPrice, x.quantity, x.unit])));
  check("birim METER, açıklama 'Kurşun 40 gr (40 gr/m)'", l?.unit === "METER" && l?.label === "Kurşun 40 gr (40 gr/m)", String(l?.label));
  check("gram fiyatı tarihsiz → taslakta 'BUGÜNKÜ değeriyle' uyarısı (1 iş)", a.warnings.some((w) => w.includes("gram fiyatının BUGÜNKÜ değeriyle") && w.startsWith("1 ")), JSON.stringify(a.warnings));

  section("§2 müşteri özel gram fiyatı istasyonunkini ezer");
  const cari = await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: cust.id, kursunGramPrice: "0.04", kursunGramCurrency: "TRY" }, select: { id: true } });
  fx.cariIds.push(cari.id);
  const b = await resolveServiceItemsForRolls({ rollIds: [r40], customerId: cust.id, currency: "TRY" });
  check("cari 0,04 → birim 1,6, tutar 800", Number(b.lines[0]?.unitPrice) === 1.6 && Number(b.lines[0]?.unitPrice) * Number(b.lines[0]?.quantity) === 800, JSON.stringify(b.lines.map((x) => x.unitPrice)));

  section("§3 fiyat/gramaj yoksa bugünkü kalem fiyatı");
  const c = await resolveServiceItemsForRolls({ rollIds: [rNA], customerId: null, currency: "TRY" });
  check("gramaj sayısı yok → kalem fiyatı 3, açıklamasız", Number(c.lines[0]?.unitPrice) === 3 && c.lines[0]?.label === undefined, JSON.stringify(c.lines.map((x) => [x.unitPrice, x.label])));
  check("gram fiyatı uygulanmayan taslakta uyarı yok", !c.warnings.some((w) => w.includes("gram fiyatının")), JSON.stringify(c.warnings));
  await prisma.station.update({ where: { id: st.id }, data: { kursunGramPrice: null, kursunGramCurrency: null } });
  const d = await resolveServiceItemsForRolls({ rollIds: [r40], customerId: null, currency: "TRY" });
  check("gram fiyatı yok → kalem fiyatı 3", Number(d.lines[0]?.unitPrice) === 3 && d.lines[0]?.label === undefined, JSON.stringify(d.lines.map((x) => x.unitPrice)));
  await prisma.station.update({ where: { id: st.id }, data: { kursunGramPrice: "0.05", kursunGramCurrency: "USD" } });
  const e = await resolveServiceItemsForRolls({ rollIds: [r40], customerId: null, currency: "TRY" });
  check("istasyon fiyatı farklı para biriminde → kalem fiyatı 3", Number(e.lines[0]?.unitPrice) === 3, JSON.stringify(e.lines.map((x) => x.unitPrice)));

  section("§4 çeşit başına tek varsayılan");
  await prisma.fabricPropertyValue.update({ where: { id: V40 }, data: { isDefault: true } });
  const dup = await errOf(() => prisma.fabricPropertyValue.update({ where: { id: VNA }, data: { isDefault: true } }));
  check("DB: ikinci varsayılan reddedilir (kısmi unique)", dup.pg === "UNIQUE", JSON.stringify(dup));
  const pasDef = await errOf(() => prisma.fabricPropertyValue.update({ where: { id: V40 }, data: { isActive: false } }));
  check("DB: varsayılan değer pasife düşemez (CHECK)", pasDef.pg === "CHECK", JSON.stringify(pasDef));
  const all = await prisma.fabricPropertyValue.findMany({ where: { propertyId: variantId }, select: { code: true, name: true, sortOrder: true, isActive: true } });
  const two = await errOf(() => fabricPropertyService.update(variantId, { values: all.map((v) => ({ ...v, isDefault: v.isActive })) }, actor));
  check("servis: iki varsayılan 400 PROPERTY_VALUE_MULTIPLE_DEFAULT", two.status === 400 && two.code === "PROPERTY_VALUE_MULTIPLE_DEFAULT", JSON.stringify(two));
  const naCode = all.find((v) => v.name === "55 gr")!.code;
  const move = await errOf(() => fabricPropertyService.update(variantId, { values: all.map((v) => ({ ...v, isDefault: v.code === naCode })) }, actor));
  const defs = await prisma.fabricPropertyValue.findMany({ where: { propertyId: variantId, isDefault: true }, select: { id: true } });
  check("servis: varsayılan taşınır (eski düşer, tek kalır)", move.status === 200 && defs.length === 1 && defs[0]!.id === VNA, JSON.stringify(move));

  section("§5 istasyon kurşun ucu");
  const noCur = await errOf(() => setKursunStation(st.id, { gramPrice: "0.05", gramCurrency: null }, actor));
  check("gram fiyatı para birimsiz 400 KURSUN_GRAM_PRICE_INVALID", noCur.status === 400 && noCur.code === "KURSUN_GRAM_PRICE_INVALID", JSON.stringify(noCur));
  const on = await setKursunStation(st.id, { enabled: true, gramPrice: "0.05", gramCurrency: "TRY" }, actor);
  const row = await prisma.stationProperty.findFirst({ where: { stationId: st.id, propertyId: kursun.id }, select: { mode: true } });
  check("aç → StationProperty(KURSUN, AUTO) + gram fiyatı", on.enabled && row?.mode === StationPropertyMode.AUTO && on.gramPrice === "0.05" && on.gramCurrency === "TRY", JSON.stringify({ enabled: on.enabled, mode: row?.mode, p: on.gramPrice }));
  const cur = await getKursunStation(st.id);
  const list = [...cur.values.filter((v) => v.isActive).map((v) => ({ code: v.code, name: v.name, amount: v.amount, isDefault: false })), { name: "80 gr", amount: "80", isDefault: true }];
  const added = await setKursunStation(st.id, { values: list }, actor);
  const v80 = added.values.find((v) => v.name === "80 gr");
  check("gramaj eklenir: kod doğar, amount 80, tek varsayılan", !!v80 && v80.code === "80-GR" && v80.amount === "80" && v80.isDefault && added.values.filter((v) => v.isDefault).length === 1, JSON.stringify(v80));
  if (v80) fx.valueIds.push(v80.id);
  const twoDef = await errOf(() => setKursunStation(st.id, { values: list.map((v) => ({ ...v, isDefault: true })) }, actor));
  check("iki varsayılan 400", twoDef.status === 400 && twoDef.code === "PROPERTY_VALUE_MULTIPLE_DEFAULT", JSON.stringify(twoDef));
  const dropped = await setKursunStation(st.id, { values: list.filter((v) => v.name !== "80 gr").map((v) => ({ ...v, isDefault: false })) }, actor);
  const v80b = dropped.values.find((v) => v.name === "80 gr");
  check("listeden çıkan gramaj SİLİNMEZ, pasife düşer (varsayılanlığı da)", !!v80b && !v80b.isActive && !v80b.isDefault, JSON.stringify(v80b));
  const off = await setKursunStation(st.id, { enabled: false }, actor);
  const left = await prisma.stationProperty.count({ where: { stationId: st.id, propertyId: kursun.id } });
  check("kapa → KURSUN satırı yok", !off.enabled && left === 0, String(left));
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
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("value", () => prisma.fabricPropertyValue.deleteMany({ where: { OR: [{ id: { in: fx.valueIds } }, { propertyId: { in: fx.propIds } }] } }));
  if (fx.variantRestore) { const r = fx.variantRestore; await del("variant geri", () => prisma.fabricProperty.update({ where: { id: r.id }, data: { serviceItemId: r.serviceItemId } })); }
  await del("variant bağı", () => prisma.fabricProperty.updateMany({ where: { id: { in: fx.propIds } }, data: { variantOfPropertyId: null } }));
  await del("property", () => prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } }));
  if (fx.kursunCreated) { const k = fx.kursunCreated; await del("KURSUN", () => prisma.fabricProperty.deleteMany({ where: { id: k } })); }
  await del("itemPrice", () => prisma.itemPrice.deleteMany({ where: { itemId: { in: fx.itemIds } } }));
  await del("item", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  await del("cari", () => prisma.cariAccount.deleteMany({ where: { id: { in: fx.cariIds } } }));
  await del("customer", () => prisma.customer.deleteMany({ where: { id: { in: fx.customerIds } } }));
  const left = await prisma.roll.count({ where: { barcode: { startsWith: P } } });
  check("temizlik: TEST-KGF top kalıntısı yok", left === 0, String(left));
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
