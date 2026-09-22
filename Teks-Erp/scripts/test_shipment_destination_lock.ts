// =============================================================================
// Test: sevk yönü KİLİDİ — createShipment · Hızlı Sevk · setDestination (S2, 2026-09-23)
// Çalıştır: npx tsx scripts/test_shipment_destination_lock.ts
// Sevk onayı AÇIK kurulur (sevkiyat PLANNED kalır — dispatch yan etkisi fikstüre girmez).
// Doğrulananlar:
//   1. Kilitli cari + farklı istek (ESKİ TABLET taklidi: yön gönderir) → kilitli değer
//      kullanılır, `warnings`te Türkçe satır; cari kartı değişmez.
//   2. Kilitli EXPORT + tartısız çuval → 400 (ihracat tartısı korunur) · tartılı → EXPORT.
//   3. İlk sevk, şubesiz, cari boş, açık istek → CARİYE yazılır + audit satırı.
//   4. İlk sevk, şubeli, şube ve cari boş → ŞUBEYE yazılır, cariye DOKUNULMAZ.
//   5. Şube boş + cari dolu → yazım YOK, cariden miras.
//   6. İstek yok + zincir boş → DOMESTIC, kart boş kalır (örtük seçim yazılmaz).
//   7. Hızlı Sevk: istek yok + zincir boş → DOMESTIC, kart boş · kilitli EXPORT carisi →
//      400 QUICK_SHIP_EXPORT_UNSUPPORTED — kilitli ihracat carisinde hızlı sevk KAPALI
//      (DAVRANIŞ DEĞİŞİKLİĞİ — önceden sessizce yurtiçi gidiyordu).
//   8. Eşzamanlı iki ilk sevk (elle açık tutulan tx): farklı seçim → 409
//      SHIPMENT_DESTINATION_LOCKED + kazanan · aynı seçim → başarı, ikinci yazım yok.
//   9. Cari sonradan değişince eski sevkiyatın yönü DEĞİŞMEZ.
//  10. setDestination: kilitliyken farklı değer 409 + kaynak · kilitli değer kabul ·
//      zincir boşken serbest ve karta yazmaz.
// Negatif sondalar (2026-09-23, `shipping.service.ts`, hepsi geri alındı → 31/0):
//   ① kilitliyken istek kazanır → 1a ❌ (ihracat tartısı reddetti) · ② uyarı null → 1b/2b/5c ❌
//   ③ claim'den `defaultDestination: null` düştü → 8a ×2, 8b audit ❌ · ④ aynı-seçim toleransı
//   düştü → 8b ❌ · ⑤ şube dalı düştü (hep cariye) → 4a/4b ❌ · ⑥ örtük DOMESTIC yazıldı →
//   6b/7b/10d/10e ❌ · ⑦ setDestination kilit kontrolü düştü → 10a/10b ❌
// =============================================================================
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";
import { CustomerService } from "../src/services/customer.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { AppError } from "../src/utils/app-error";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import type { ShipmentDestination } from "@prisma/client";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const TS = Date.now().toString(36);
const shipping = new ShippingService();
const customers = new CustomerService({
  modelName: "customer",
  tableName: "CUSTOMER",
  searchFields: ["name"],
  codeSearchFields: ["code", "taxNumber", "exportCode"],
  defaultInclude: undefined,
  uniqueField: "code",
  nestedCreateFields: ["branches"],
});

const made = { customerIds: [] as string[], itemId: "", rollIds: [] as string[], sackIds: [] as string[] };
const CONFIRM_KEY = SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED;
let confirmBefore: { value: unknown } | null | undefined;
let warehouseId = "";
let seq = 0;

async function yeniCari(dest?: ShipmentDestination): Promise<string> {
  const r = await customers.create({ name: `TEST Yön Kilit ${TS} ${++seq}`, ...(dest ? { defaultDestination: dest } : {}) }, undefined);
  const id = (r.data as { id: string }).id;
  made.customerIds.push(id);
  return id;
}

async function yeniSube(customerId: string, dest?: ShipmentDestination): Promise<string> {
  const b = await prisma.customerBranch.create({
    data: { customerId, name: `TEST Şube ${TS} ${++seq}`, ...(dest ? { defaultDestination: dest } : {}) },
    select: { id: true },
  });
  return b.id;
}

async function yeniTop(sackId: string | null): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: `TEST-YK-R-${TS}-${++seq}`,
      itemId: made.itemId,
      initialQty: 50,
      currentQty: 50,
      status: "WAREHOUSE",
      sackId,
      warehouseId,
    },
    select: { id: true },
  });
  made.rollIds.push(r.id);
  return r.id;
}

async function doluCuval(customerId: string, branchId: string | null, tartili: boolean): Promise<string> {
  const r = await shipping.openSack({ customerId, branchId, ...(tartili ? { weightKg: 12.5 } : {}) });
  const id = (r.data as { id: string }).id;
  made.sackIds.push(id);
  await yeniTop(id);
  return id;
}

async function yonleri(customerId: string, branchId?: string) {
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { defaultDestination: true } });
  const b = branchId ? await prisma.customerBranch.findUnique({ where: { id: branchId }, select: { defaultDestination: true } }) : null;
  return { cari: c?.defaultDestination ?? null, sube: b?.defaultDestination ?? null };
}

async function sevkYonu(id: string) {
  return (await prisma.shipment.findUnique({ where: { id }, select: { destination: true } }))?.destination;
}

async function hataYakala(fn: () => Promise<unknown>): Promise<AppError | null> {
  try { await fn(); return null; } catch (e) { return e instanceof AppError ? e : null; }
}

function kod(e: AppError | null): unknown {
  return (e?.details as { code?: unknown } | undefined)?.code;
}

type Sonuc = { success: boolean; data: { id: string }; warnings?: string[] };

async function main() {
  warehouseId = await fixtureWarehouseId();
  const item = await prisma.item.create({
    data: { code: `TEST-YK-I-${TS}`, name: `TEST Kumaş Yön ${TS}`, itemType: "FABRIC" },
    select: { id: true },
  });
  made.itemId = item.id;
  confirmBefore = await prisma.systemSetting.findUnique({ where: { key: CONFIRM_KEY }, select: { value: true } });
  await prisma.systemSetting.upsert({ where: { key: CONFIRM_KEY }, create: { key: CONFIRM_KEY, value: true }, update: { value: true } });

  // 1) kilitli + farklı istek (eski tablet)
  const c1 = await yeniCari("DOMESTIC");
  // Tartısız çuval BİLEREK: kilit istek yönüne düşerse ihracat tartısı 1a'yı reddeder.
  const cuval1 = await doluCuval(c1, null, false);
  let yanit1: Sonuc | null = null;
  const e1 = await hataYakala(async () => { yanit1 = (await shipping.createShipment({ sackIds: [cuval1], customerId: c1, destination: "EXPORT" })) as Sonuc; });
  check("1a kilitli DOMESTIC + istek EXPORT (tartısız) → reddedilmedi", e1 === null, e1?.message ?? "");
  if (e1) throw new Error("1a düştü — kalan adımlar bu sevkiyata dayanıyor");
  const r1 = (await prisma.shipment.findFirstOrThrow({ where: { customerId: c1 }, select: { id: true } })) as { id: string };
  const r1Sonuc = yanit1 as unknown as Sonuc;
  check("1a' sevkiyat DOMESTIC", (await sevkYonu(r1.id)) === "DOMESTIC");
  const w1 = (r1Sonuc.warnings ?? []).find((w) => w.includes("kilitli"));
  check("1b uyarı Türkçe ve kaynağı söylüyor", !!w1 && w1.includes("bu cari") && w1.includes("yurtiçi kullanıldı"), w1 ?? JSON.stringify(r1Sonuc.warnings));
  check("1c cari kartı değişmedi", (await yonleri(c1)).cari === "DOMESTIC");
  const r1b = (await shipping.createShipment({ sackIds: [await doluCuval(c1, null, false)], customerId: c1, destination: "DOMESTIC" })) as Sonuc;
  check("1d aynı değer → uyarı yok", !(r1b.warnings ?? []).some((w) => w.includes("kilitli")), JSON.stringify(r1b.warnings));

  // 2) kilitli EXPORT + tartı
  const c2 = await yeniCari("EXPORT");
  const tartisiz = await doluCuval(c2, null, false);
  const e2a = await hataYakala(() => shipping.createShipment({ sackIds: [tartisiz], customerId: c2, destination: "DOMESTIC" }));
  check("2a kilitli EXPORT + tartısız çuval → 400 WEIGH_REQUIRED", e2a?.statusCode === 400 && kod(e2a) === "WEIGH_REQUIRED", e2a?.message ?? "hata yok");
  const r2 = (await shipping.createShipment({ sackIds: [await doluCuval(c2, null, true)], customerId: c2, destination: "DOMESTIC" })) as Sonuc;
  check("2b tartılı → EXPORT + uyarı", (await sevkYonu(r2.data.id)) === "EXPORT" && (r2.warnings ?? []).some((w) => w.includes("yurtdışı kullanıldı")), JSON.stringify(r2.warnings));

  // 3) ilk sevk → cariye
  const c3 = await yeniCari();
  const r3 = (await shipping.createShipment({ sackIds: [await doluCuval(c3, null, true)], customerId: c3, destination: "EXPORT" })) as Sonuc;
  check("3a ilk sevk (şubesiz) → sevkiyat EXPORT", (await sevkYonu(r3.data.id)) === "EXPORT");
  check("3b yön CARİYE yazıldı", (await yonleri(c3)).cari === "EXPORT");
  const log3 = await prisma.systemLog.findFirst({ where: { tableName: "CUSTOMER", recordId: c3, action: "UPDATE" }, orderBy: { createdAt: "desc" }, select: { newData: true } });
  check("3c karta yazım audit'te", JSON.stringify(log3?.newData ?? null).includes("FIRST_SHIPMENT_DESTINATION"), JSON.stringify(log3?.newData ?? null));

  // 4) ilk sevk → şubeye, cariye dokunma
  const c4 = await yeniCari();
  const b4 = await yeniSube(c4);
  const r4 = (await shipping.createShipment({ sackIds: [await doluCuval(c4, b4, false)], customerId: c4, branchId: b4, destination: "DOMESTIC" })) as Sonuc;
  const y4 = await yonleri(c4, b4);
  check("4a ilk sevk (şubeli) → ŞUBEYE yazıldı", y4.sube === "DOMESTIC" && (await sevkYonu(r4.data.id)) === "DOMESTIC", JSON.stringify(y4));
  check("4b cariye DOKUNULMADI", y4.cari === null, JSON.stringify(y4));

  // 5) şube boş + cari dolu → miras, yazım yok
  const c5 = await yeniCari("DOMESTIC");
  const b5 = await yeniSube(c5);
  const r5 = (await shipping.createShipment({ sackIds: [await doluCuval(c5, b5, false)], customerId: c5, branchId: b5, destination: "EXPORT" })) as Sonuc;
  const y5 = await yonleri(c5, b5);
  check("5a şube boş + cari DOMESTIC → sevkiyat DOMESTIC (miras)", (await sevkYonu(r5.data.id)) === "DOMESTIC");
  check("5b şubeye yazım YOK", y5.sube === null, JSON.stringify(y5));
  check("5c uyarı kaynağı 'bu cari'", (r5.warnings ?? []).some((w) => w.includes("bu cari")), JSON.stringify(r5.warnings));

  // 6) istek yok + zincir boş
  const c6 = await yeniCari();
  const r6 = (await shipping.createShipment({ sackIds: [await doluCuval(c6, null, false)], customerId: c6 })) as Sonuc;
  check("6a istek yok → DOMESTIC", (await sevkYonu(r6.data.id)) === "DOMESTIC");
  check("6b kart BOŞ kaldı (örtük seçim yazılmaz)", (await yonleri(c6)).cari === null);

  // 7) Hızlı Sevk
  const c7 = await yeniCari();
  const r7 = (await shipping.createShipmentFromRolls({ rollIds: [await yeniTop(null)], customerId: c7 })) as Sonuc;
  check("7a hızlı sevk, zincir boş → DOMESTIC", (await sevkYonu(r7.data.id)) === "DOMESTIC");
  check("7b hızlı sevk kartı BOŞ bıraktı", (await yonleri(c7)).cari === null);
  const r7s = await prisma.shipment.findUnique({ where: { id: r7.data.id }, select: { sacks: { select: { id: true } } } });
  for (const s of r7s?.sacks ?? []) made.sackIds.push(s.id);
  const c7e = await yeniCari("EXPORT");
  const e7b = await hataYakala(async () => shipping.createShipmentFromRolls({ rollIds: [await yeniTop(null)], customerId: c7e }));
  check(
    "7c kilitli EXPORT carinin hızlı sevki → 400 QUICK_SHIP_EXPORT_UNSUPPORTED, kaynak adıyla",
    e7b?.statusCode === 400 && kod(e7b) === "QUICK_SHIP_EXPORT_UNSUPPORTED" && e7b.message.startsWith("Bu cari ihracat olarak kilitli"),
    e7b?.message ?? "hata yok",
  );

  // 8) eşzamanlı iki ilk sevk
  for (const [etiket, rakip, istek, beklenen] of [
    ["8a farklı seçim", "EXPORT", "DOMESTIC", "409"],
    ["8b aynı seçim", "DOMESTIC", "DOMESTIC", "ok"],
  ] as const) {
    const c8 = await yeniCari();
    const cuval = await doluCuval(c8, null, true);
    let birak!: () => void;
    const kapi = new Promise<void>((r) => { birak = r; });
    let rakipYazdi!: () => void;
    const yazdi = new Promise<void>((r) => { rakipYazdi = r; });
    const txA = prisma.$transaction(async (tx) => {
      await tx.customer.updateMany({ where: { id: c8, defaultDestination: null }, data: { defaultDestination: rakip } });
      rakipYazdi();
      await kapi;
    }, { timeout: 20_000 });
    await yazdi;
    const bSonuc = shipping.createShipment({ sackIds: [cuval], customerId: c8, destination: istek }).then(
      (r) => ({ ok: r as Sonuc, err: null as AppError | null }),
      (e) => ({ ok: null, err: e instanceof AppError ? e : null }),
    );
    await new Promise((r) => setTimeout(r, 400));
    birak();
    await txA;
    const b = await bSonuc;
    if (beklenen === "409") {
      const d = b.err?.details as { code?: string; destination?: string; source?: string } | undefined;
      check(`${etiket} → 409 + kazanan değer`, b.err?.statusCode === 409 && d?.code === "SHIPMENT_DESTINATION_LOCKED" && d?.destination === "EXPORT" && d?.source === "CUSTOMER", b.err ? `${b.err.message} ${JSON.stringify(d)}` : "başarılı döndü");
    } else {
      check(`${etiket} → başarı, yön DOMESTIC`, !!b.ok && (await sevkYonu(b.ok.data.id)) === "DOMESTIC", b.err?.message ?? "");
      const loglar = await prisma.systemLog.count({ where: { tableName: "CUSTOMER", recordId: c8, action: "UPDATE" } });
      check(`${etiket} → kaybeden karta ikinci kez YAZMADI (audit 0)`, loglar === 0, String(loglar));
    }
    check(`${etiket} → kartta rakibin değeri`, (await yonleri(c8)).cari === rakip);
  }

  // 9) cari sonradan değişti → eski sevkiyat değişmez
  await customers.update(c3, { defaultDestination: "DOMESTIC" }, undefined);
  check("9 cari değişti → eski sevkiyat hâlâ EXPORT", (await sevkYonu(r3.data.id)) === "EXPORT");

  // 10) setDestination
  const e10 = await hataYakala(() => shipping.setDestination(r1.id, "EXPORT"));
  const d10 = e10?.details as { code?: string; source?: string } | undefined;
  check("10a kilitliyken farklı değer → 409 + kaynak", e10?.statusCode === 409 && d10?.code === "SHIPMENT_DESTINATION_LOCKED" && d10?.source === "CUSTOMER", e10?.message ?? "hata yok");
  check("10b 409 sonrası sevkiyat değişmedi", (await sevkYonu(r1.id)) === "DOMESTIC");
  // karta hizalama: kart EXPORT'a çevrilir, PLANNED sevkiyat eski değeri taşır → kilitli değere eşitlenir
  await customers.update(c1, { defaultDestination: "EXPORT" }, undefined);
  const ok10 = await hataYakala(() => shipping.setDestination(r1.id, "EXPORT"));
  check("10c kilitli değere eşitleme kabul", ok10 === null && (await sevkYonu(r1.id)) === "EXPORT", ok10?.message ?? "");
  const ok10d = await hataYakala(() => shipping.setDestination(r6.data.id, "EXPORT"));
  check("10d zincir boşken serbest", ok10d === null && (await sevkYonu(r6.data.id)) === "EXPORT", ok10d?.message ?? "");
  check("10e zincir boşken karta YAZMAZ", (await yonleri(c6)).cari === null);
}

async function temizlik(): Promise<void> {
  const sevkler = await prisma.shipment.findMany({ where: { customerId: { in: made.customerIds } }, select: { id: true } });
  const sevkIds = sevkler.map((s) => s.id);
  const cuvallar = await prisma.sack.findMany({ where: { OR: [{ id: { in: made.sackIds } }, { shipmentId: { in: sevkIds } }] }, select: { id: true } });
  const cuvalIds = cuvallar.map((s) => s.id);
  await prisma.roll.deleteMany({ where: { OR: [{ id: { in: made.rollIds } }, { sackId: { in: cuvalIds } }] } });
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: cuvalIds } } });
  await prisma.sackWeighing.deleteMany({ where: { sackId: { in: cuvalIds } } });
  await prisma.sack.deleteMany({ where: { id: { in: cuvalIds } } });
  await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: sevkIds } } });
  await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: sevkIds } } });
  await prisma.shipment.deleteMany({ where: { id: { in: sevkIds } } });
  if (made.itemId) await prisma.item.deleteMany({ where: { id: made.itemId } });
  await cleanupTestCustomers(made.customerIds);
  if (confirmBefore) await prisma.systemSetting.update({ where: { key: CONFIRM_KEY }, data: { value: confirmBefore.value as never } });
  else if (confirmBefore === null) await prisma.systemSetting.deleteMany({ where: { key: CONFIRM_KEY } });
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    try { await temizlik(); } catch (e) { console.error("❌ temizlik düştü:", e); fail++; }
    console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
