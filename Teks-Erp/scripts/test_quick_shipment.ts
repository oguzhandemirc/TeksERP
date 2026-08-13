// =============================================================================
// BEKÇİ — HIZLI SEVK (topları doğrudan sevk et, çuval görünmez)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_quick_shipment.ts
//
// NEDEN: Alım-satım firmasının EN SIK işi "depodan N top seç → müşteriye
// gönder". Bu yol çuvalı gizler ama çuval hâlâ irsaliyenin, tahsisin ve iade
// zincirinin taşıyıcısıdır — yani gizleme YALNIZ yüzeyde olmalı, altta hiçbir
// şey değişmemeli. Bu bekçinin ASIL iddiası budur: hızlı sevk ile normal sevk
// AYNI çekirdekten geçer ve BİREBİR aynı sonucu üretir.
//
// ÖLÇÜLENLER:
//   §1 Topla sevk: çuval otomatik doğar, toplar bağlanır, sevkiyat DISPATCHED
//   §2 ⭐ EŞDEĞERLİK: aynı içerik normal yolla sevk edilince tahsis/statü/
//      irsaliye kaydı BİREBİR aynı (çekirdek gerçekten paylaşılıyor mu)
//   §3 ⭐ ATOMİKLİK: uygun olmayan top varsa HİÇBİR şey yazılmaz — artık çuval
//      da kalmaz (yarım kalan zincirin izi olmamalı)
//   §4 Guard'lar SOMUT top söyler: çuvaldaki · sevkiyattaki · uygunsuz statü ·
//      farklı depo
//   §5 BARKOD İSTEMEZ — barkodsuz top (etiket basılmamış) da sevk edilebilir
//   §6 İhracat bu yoldan REDDEDİLİR (çuval tartısı ister) — sessizce yurtiçi
//      sayılmaz
//   §7 İdempotency: aynı clientToken ikinci sevkiyat açmaz
// =============================================================================
import { RollStatus, ShipmentStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { shippingService } from "../src/services/shipping.service";
import { InventoryService } from "../src/services/inventory.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";

const inventory = new InventoryService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TAG = `TEST-QS-${Date.now()}`;
const rollIds: string[] = [];
const sackIds: string[] = [];
const shipmentIds: string[] = [];
const warehouseIds: string[] = [];
let customerId: string | null = null;

async function expectError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

async function makeRoll(itemId: string, qty: number, warehouseId?: string): Promise<string> {
  const res = await inventory.createInitialEntry({ itemId, initialQty: qty }, undefined, undefined, false, {
    forcedStatus: RollStatus.WAREHOUSE,
    ...(warehouseId ? { warehouseId } : {}),
  });
  const id = (res.data as { id: string }).id;
  rollIds.push(id);
  return id;
}

async function main(): Promise<void> {
  console.log("=== Hızlı sevk bekçisi ===\n");

  await ensureDefaultWarehouse();
  const item = await prisma.item.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
  const customer = await prisma.customer.create({
    data: { code: TAG, name: `${TAG} Müşteri` },
    select: { id: true },
  });
  customerId = customer.id;

  // ── §1 TOPLA SEVK ───────────────────────────────────────────────────────
  const a1 = await makeRoll(item.id, 120);
  const a2 = await makeRoll(item.id, 80);
  const quick = await shippingService.createShipmentFromRolls({
    rollIds: [a1, a2],
    customerId: customer.id,
    clientToken: crypto.randomUUID(),
  });
  const qd = quick.data as { id: string; shipmentNo: string; status: string; dispatched: boolean; rollCount: number };
  shipmentIds.push(qd.id);

  check("§1a Sevkiyat kuruldu", /^SVK/.test(qd.shipmentNo), qd.shipmentNo);
  check("§1b Top sayısı yanıtta", qd.rollCount === 2, `rollCount=${qd.rollCount}`);
  const qRolls = await prisma.roll.findMany({
    where: { id: { in: [a1, a2] } },
    select: { sackId: true, shipmentId: true, status: true },
  });
  check("§1c ⭐ Toplar OTOMATİK çuvala bağlandı", qRolls.every((r) => r.sackId !== null));
  check("§1d Toplar sevkiyata bağlandı", qRolls.every((r) => r.shipmentId === qd.id));
  const qSackId = qRolls[0]?.sackId as string;
  sackIds.push(qSackId);
  const qSack = await prisma.sack.findUniqueOrThrow({
    where: { id: qSackId },
    select: { sackNo: true, customerId: true, shipmentId: true, warehouseId: true },
  });
  check("§1e Çuval CV kodlu ve müşteriye bağlı", /^CV/.test(qSack.sackNo) && qSack.customerId === customer.id, qSack.sackNo);
  check("§1f Çuval konumu topların deposundan geldi", qSack.warehouseId !== null);
  check(
    "§1g Onay kapalıysa doğrudan DISPATCHED",
    qd.dispatched ? qd.status === ShipmentStatus.DISPATCHED : qd.status === ShipmentStatus.PLANNED,
    `status=${qd.status}`,
  );
  if (qd.dispatched) {
    check("§1h Toplar SHIPPED statüsüne geçti", qRolls.every((r) => r.status === RollStatus.SHIPPED));
  }

  // ── §2 EŞDEĞERLİK ───────────────────────────────────────────────────────
  // Aynı içeriği NORMAL yolla sevk et; iki sevkiyatın gözlemlenebilir sonucu
  // birebir aynı olmalı (çekirdek gerçekten paylaşılıyor mu).
  const b1 = await makeRoll(item.id, 120);
  const b2 = await makeRoll(item.id, 80);
  const opened = await shippingService.openSack({ customerId: customer.id, clientToken: crypto.randomUUID() });
  const nSackId = (opened.data as { id: string }).id;
  sackIds.push(nSackId);
  for (const id of [b1, b2]) {
    const bc = await prisma.roll.findUniqueOrThrow({ where: { id }, select: { barcode: true } });
    await shippingService.scanIntoSack({ sackId: nSackId, barcode: bc.barcode as string });
  }
  const normal = await shippingService.createShipment({
    sackIds: [nSackId],
    customerId: customer.id,
    clientToken: crypto.randomUUID(),
  });
  const nd = normal.data as { id: string; status: string; dispatched: boolean };
  shipmentIds.push(nd.id);

  const shape = async (shipmentId: string) => {
    const s = await prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      select: {
        status: true,
        destination: true,
        customerId: true,
        _count: { select: { sacks: true, rolls: true } },
      },
    });
    const docs = await prisma.printedDocument.count({ where: { sourceId: shipmentId } });
    // Tahsis çuval üzerinden bağlı (SackAllocation.sackId) — sevkiyatın
    // çuvalları üzerinden sayılır.
    const allocations = await prisma.sackAllocation.count({ where: { sack: { shipmentId } } });
    const rolls = await prisma.roll.findMany({ where: { shipmentId }, select: { status: true } });
    return {
      status: s.status,
      destination: s.destination,
      sacks: s._count.sacks,
      rolls: s._count.rolls,
      allocations,
      docs,
      rollStatuses: [...new Set(rolls.map((r) => r.status))].sort().join(","),
    };
  };
  const qShape = await shape(qd.id);
  const nShape = await shape(nd.id);
  check(
    "§2 ⭐ EŞDEĞERLİK: hızlı sevk ile normal sevk BİREBİR aynı sonuç",
    JSON.stringify(qShape) === JSON.stringify(nShape),
    `hızlı=${JSON.stringify(qShape)} normal=${JSON.stringify(nShape)}`,
  );

  // ── §3 ATOMİKLİK ────────────────────────────────────────────────────────
  const sackCountBefore = await prisma.sack.count();
  const shipCountBefore = await prisma.shipment.count();
  const ok1 = await makeRoll(item.id, 50);
  const bad = await makeRoll(item.id, 50);
  await prisma.roll.update({ where: { id: bad }, data: { status: RollStatus.SCRAP } });
  const atomicErr = await expectError(() =>
    shippingService.createShipmentFromRolls({ rollIds: [ok1, bad], customerId: customer.id }),
  );
  check("§3a Uygunsuz top varsa TÜM sevk düşer", atomicErr.length > 0, atomicErr.slice(0, 70));
  check(
    "§3b ⭐ ARTIK ÇUVAL KALMADI (yarım zincirin izi yok)",
    (await prisma.sack.count()) === sackCountBefore,
    `öncesi=${sackCountBefore} sonrası=${await prisma.sack.count()}`,
  );
  check("§3c Sevkiyat da doğmadı", (await prisma.shipment.count()) === shipCountBefore);
  const okRoll = await prisma.roll.findUniqueOrThrow({ where: { id: ok1 }, select: { sackId: true, shipmentId: true } });
  check("§3d UYGUN top da bağlanmadı (yarım transfer yok)", okRoll.sackId === null && okRoll.shipmentId === null);

  // ── §3e ⭐ GERÇEK YARIŞ — atomikliğin ÖLÇÜLEBİLİR hâli ──────────────────
  // ⚠️ Yukarıdaki §3a-d, hatayı tx'e HİÇ ULAŞMADAN (tx öncesi ön kontrolde)
  // yakalıyor; yani tek başlarına "tx atomik mi" sorusunu ÖLÇMÜYORLAR — iki
  // negatif sonda (claim kontrolünü kaldırma, çuvalı tx dışına alma) yeşil
  // kaldığı için bu ölçüldü ve fixture eklendi. Ön kontrolü GEÇEN ama tx'te
  // düşen tek gerçekçi durum YARIŞTIR: iki istek aynı topları aynı anda ister,
  // biri claim'i kaybeder ve o dalın açtığı çuval GERİ SARILMALIDIR.
  //
  // `Promise.allSettled` burada MEŞRU (perf kuralı 11 tek tx client'ı
  // paylaşmaya ilişkindir; burada iki ayrı tx var) — sıralı hale getirilirse
  // bekçi sessizce ölür.
  const raceRoll = await makeRoll(item.id, 70);
  const sacksBeforeRace = await prisma.sack.count();
  const raceResults = await Promise.allSettled([
    shippingService.createShipmentFromRolls({ rollIds: [raceRoll], customerId: customer.id }),
    shippingService.createShipmentFromRolls({ rollIds: [raceRoll], customerId: customer.id }),
  ]);
  const won = raceResults.filter((r) => r.status === "fulfilled");
  for (const w of won) {
    const d = (w as PromiseFulfilledResult<{ data: unknown }>).value.data as { id: string };
    shipmentIds.push(d.id);
  }
  const raceSack = await prisma.roll.findUniqueOrThrow({ where: { id: raceRoll }, select: { sackId: true } });
  if (raceSack.sackId) sackIds.push(raceSack.sackId);
  check("§3e ⭐ Eşzamanlı iki istekten YALNIZ BİRİ kazandı", won.length === 1, `kazanan=${won.length}/2`);
  check(
    "§3f ⭐ Kaybeden dalın çuvalı GERİ SARILDI (tek çuval doğdu, iki değil)",
    (await prisma.sack.count()) === sacksBeforeRace + 1,
    `öncesi=${sacksBeforeRace} sonrası=${await prisma.sack.count()} (beklenen +1)`,
  );

  // ── §4 GUARD MESAJLARI ──────────────────────────────────────────────────
  check("§4a Uygunsuz statü SOMUT söyleniyor", /durumu uygun değil/i.test(atomicErr), atomicErr.slice(0, 60));

  const inSack = await makeRoll(item.id, 30);
  const holder = await shippingService.openSack({ clientToken: crypto.randomUUID() });
  const holderId = (holder.data as { id: string }).id;
  sackIds.push(holderId);
  await prisma.roll.update({ where: { id: inSack }, data: { sackId: holderId } });
  const sackErr = await expectError(() =>
    shippingService.createShipmentFromRolls({ rollIds: [inSack], customerId: customer.id }),
  );
  check("§4b Çuvaldaki top yol gösteren mesajla reddedildi", /çuvalın içinde/i.test(sackErr), sackErr.slice(0, 70));

  const other = await prisma.warehouse.create({
    data: { code: `${TAG}-W`, name: `${TAG} Depo` },
    select: { id: true },
  });
  warehouseIds.push(other.id);
  const w1 = await makeRoll(item.id, 40);
  const w2 = await makeRoll(item.id, 40, other.id);
  const whErr = await expectError(() =>
    shippingService.createShipmentFromRolls({ rollIds: [w1, w2], customerId: customer.id }),
  );
  check("§4c Farklı depolardan top REDDEDİLDİ", /farklı depolarda/i.test(whErr), whErr.slice(0, 70));

  // ── §5 BARKODSUZ TOP ────────────────────────────────────────────────────
  // Etiket basmayan kullanıcının topu barkodsuz olabilir; hızlı sevk barkod
  // İSTEMEDİĞİ için bu meşru bir akıştır (scanIntoSack yolu barkod ister).
  const noBarcode = await makeRoll(item.id, 25);
  await prisma.roll.update({ where: { id: noBarcode }, data: { barcode: null } });
  const nb = await shippingService.createShipmentFromRolls({ rollIds: [noBarcode], customerId: customer.id });
  const nbd = nb.data as { id: string };
  shipmentIds.push(nbd.id);
  const nbRoll = await prisma.roll.findUniqueOrThrow({ where: { id: noBarcode }, select: { shipmentId: true, sackId: true } });
  if (nbRoll.sackId) sackIds.push(nbRoll.sackId);
  check("§5 ⭐ BARKODSUZ top sevk edilebildi (etiket zorunlu değil)", nbRoll.shipmentId === nbd.id);

  // ── §6 İHRACAT ──────────────────────────────────────────────────────────
  const e1 = await makeRoll(item.id, 60);
  const expErr = await expectError(() =>
    shippingService.createShipmentFromRolls({ rollIds: [e1], customerId: customer.id, destination: "EXPORT" }),
  );
  check("§6 İhracat bu yoldan reddedildi (tartı ister)", /tart/i.test(expErr), expErr.slice(0, 80));

  // ── §7 İDEMPOTENCY ──────────────────────────────────────────────────────
  const token = crypto.randomUUID();
  const t1 = await makeRoll(item.id, 15);
  const first = await shippingService.createShipmentFromRolls({ rollIds: [t1], customerId: customer.id, clientToken: token });
  const fd = first.data as { id: string; shipmentNo: string };
  shipmentIds.push(fd.id);
  const firstRoll = await prisma.roll.findUniqueOrThrow({ where: { id: t1 }, select: { sackId: true } });
  if (firstRoll.sackId) sackIds.push(firstRoll.sackId);
  const second = await shippingService.createShipmentFromRolls({ rollIds: [t1], customerId: customer.id, clientToken: token });
  const sd = second.data as { id: string };
  check("§7 Aynı token ikinci sevkiyat AÇMADI", sd.id === fd.id, `${fd.shipmentNo}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    if (shipmentIds.length > 0) {
      await prisma.sackAllocation.deleteMany({ where: { sack: { shipmentId: { in: shipmentIds } } } });
      await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.printedDocument.deleteMany({ where: { sourceId: { in: shipmentIds } } });
    }
    if (rollIds.length > 0) {
      await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null } });
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (shipmentIds.length > 0) await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    if (sackIds.length > 0) await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    // ⚠️ SÜPÜRME: id listesi yetmez. Bu bekçi atomikliği ölçtüğü için, kod
    // bozukken koşturulduğunda (negatif sonda) geri sarılmayan çuvallar
    // listeye HİÇ girmez ve DB'de kalır — sonraki test_consistency §6'yı
    // (seq var, shipmentId yok) kırmızıya düşürür. Test müşterisine bağlı her
    // çuval silinir; müşteri de bu bekçinin kendi fixture'ı.
    if (customerId) await prisma.sack.deleteMany({ where: { customerId } });
    if (warehouseIds.length > 0) await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
