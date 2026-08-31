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
//   §8 ⭐ FIFO ÖNERİSİ: en eski RAF BEKLEMESİ önce (doğuş tarihi DEĞİL),
//      deterministik sıra, ve önerinin sevk claim'iyle AYNI yüklemi okuduğu
//      (sistem kendi önerdiği topu reddedemez)
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

  // ── §8 FIFO ÖNERİSİ ─────────────────────────────────────────────────────
  // "3 top patos sattım, hangileri umurumda değil" akışı. Öneri iki şeyi
  // vaat eder: (a) en eski raf beklemesi önce, (b) önerilen top SEVK EDİLEBİLİR.
  // (b) bu bölümün ⭐'lı kontrolü — sistemin kendi önerdiği topu reddetmesi,
  // kullanıcıyı kendi hatası sanacağı bir çıkmaza sokar.
  const fifoItem = await prisma.item.create({
    data: { code: `${TAG}-FIFO`, name: `${TAG} FIFO Kumaş`, unit: "MT", itemType: "FABRIC" },
    select: { id: true },
  });
  const fifoColor = await prisma.color.create({
    data: { code: `${TAG}-C`, name: `${TAG} Renk` },
    select: { id: true },
  });
  // ⚠️ DOĞUŞ SIRASI, RAF SIRASININ TERSİ OLMAK ZORUNDA — yoksa bu bölüm KÖR olur.
  // İlk yazımda üçü de raf sırasıyla yaratılmıştı; `createdAt` ile `statusChangedAt`
  // aynı cevabı verdiği için "orderBy'ı createdAt'e çevir" sondası YEŞİL kaldı
  // (ölçüldü). En YENİ raf beklemesini taşıyan top ÖNCE doğar:
  const fYeni = await makeRoll(fifoItem.id, 30);
  const fOrta = await makeRoll(fifoItem.id, 20);
  const fEski = await makeRoll(fifoItem.id, 10);
  const stamp = async (id: string, iso: string): Promise<void> => {
    // Statü DEĞİŞMEDİĞİ için trigger no-op — damga aynen kalır (UPDATE dalı
    // `IS DISTINCT FROM` ile korunuyor).
    await prisma.$executeRaw`UPDATE "rolls" SET "statusChangedAt" = ${new Date(iso)} WHERE "id"::text = ${id}`;
  };
  await stamp(fYeni, "2026-08-10T09:00:00Z");
  await stamp(fOrta, "2026-06-10T09:00:00Z");
  await stamp(fEski, "2026-02-10T09:00:00Z");

  const sug = async (limit: number, colorId?: string): Promise<string[]> => {
    const r = await shippingService.findShippableRolls({ itemId: fifoItem.id, limit, colorId: colorId ?? null });
    return (r.data as { id: string }[]).map((x) => x.id);
  };

  const fifo = await sug(10);
  check(
    "§8a ⭐ FIFO: en eski RAF BEKLEMESİ önce (createdAt sırası değil)",
    fifo[0] === fEski && fifo[1] === fOrta && fifo[2] === fYeni,
    `sıra=${fifo.map((id) => (id === fEski ? "eski" : id === fOrta ? "orta" : id === fYeni ? "yeni" : "?")).join(">")}`,
  );
  const fifo2 = await sug(10);
  check("§8b Öneri DETERMİNİSTİK (iki çağrı aynı sıra)", JSON.stringify(fifo) === JSON.stringify(fifo2));
  check("§8c Limit uygulanıyor", (await sug(2)).length === 2);

  // §8d — renk süzgeci. Renkli top EN ESKİ damgayı taşır ki süzgeç çalışmazsa
  // liste başında görünsün (süzgeç kaybolursa kontrol kırmızı verir).
  const fRenkli = await makeRoll(fifoItem.id, 40);
  await prisma.roll.update({ where: { id: fRenkli }, data: { colorId: fifoColor.id } });
  await stamp(fRenkli, "2026-01-01T09:00:00Z");
  const renkli = await sug(10, fifoColor.id);
  check("§8d Renk süzgeci daraltıyor", renkli.length === 1 && renkli[0] === fRenkli, `n=${renkli.length}`);

  // §8e ⭐ EŞDEĞERLİK — öneri ile sevk claim'i AYNI yüklemi okuyor mu?
  // `SHIPPABLE_ROLL_WHERE` kopyalanırsa burada ayrışır: çuvaldaki top önerilmeye
  // devam eder ve kullanıcı "Sevk Et"e basınca sistem KENDİ ÖNERDİĞİ topu 400 ile
  // reddeder.
  //
  // ⚠️ ÖLÇÜM ARACI ÇUVALDAKİ TOP OLMAK ZORUNDA, sevk EDİLMİŞ top DEĞİL.
  // İlk yazımda sevk edilmiş top kullanılmıştı ve kontrol KÖRDÜ (ölçüldü):
  // sevk sonrası statü `SHIPPED` oluyor, o da zaten `NON_SACKABLE_STATUSES`'ta →
  // yüklemin `sackId`/`shipmentId` ayağı silinse bile süzgeç statüden çalışıyordu.
  // Çuvaldaki topun statüsü hâlâ `WAREHOUSE`'tur; onu YALNIZ `sackId: null` eler.
  const fCuvalda = await makeRoll(fifoItem.id, 50);
  await stamp(fCuvalda, "2026-01-05T09:00:00Z"); // en eskilerden → süzülmezse listenin başında olur
  const fSack = await shippingService.openSack({ clientToken: crypto.randomUUID() });
  const fSackId = (fSack.data as { id: string }).id;
  sackIds.push(fSackId);
  await prisma.roll.update({ where: { id: fCuvalda }, data: { sackId: fSackId } });
  const sonrasi = await sug(10);
  check(
    "§8e ⭐ Çuvaldaki top (statüsü hâlâ WAREHOUSE) ÖNERİLMİYOR (öneri↔claim tek yüklem)",
    !sonrasi.includes(fCuvalda),
    `öneri=${sonrasi.length} top`,
  );
  // Aynı topu sevk denemesi GERÇEKTEN reddediyor mu — öneri ile sevkin aynı
  // cevabı verdiğinin ikinci ucu (biri elense diğeri elemese fark buradan çıkar).
  const cuvaldaErr = await expectError(() =>
    shippingService.createShipmentFromRolls({ rollIds: [fCuvalda], customerId: customer.id }),
  );
  check("§8e2 ⭐ Ve sevk de aynı topu reddediyor (iki uç aynı cevap)", cuvaldaErr.length > 0, cuvaldaErr.slice(0, 50));
  // Ve önerilenlerin HEPSİ gerçekten sevk edilebilir olmalı — tersten kanıt.
  const halaUygun = await prisma.roll.findMany({
    where: { id: { in: sonrasi }, sackId: null, shipmentId: null },
    select: { id: true },
  });
  check("§8f ⭐ Önerilen HER top sevke uygun (sistem kendi önerisini reddetmez)", halaUygun.length === sonrasi.length);

  // §8g — damgasız top SONA düşer. "Yaşı bilinmiyor" ≠ "en eski": olmayan bir
  // bilgiyi iddia etmek, öneriyi sessizce yanlış yapar (nulls:"last" kararı).
  // ⚠️ `createdAt` de EN ESKİYE çekilir: aksi halde damgasız top zaten en son
  // doğduğu için her sıralamada sona düşer ve kontrol KÖR olur. Böyle kurulunca
  // "nulls:first" de, "createdAt'e düş" de listeyi BAŞTAN açardı — yalnız
  // bugünkü kural onu sona koyar.
  const fDamgasiz = await makeRoll(fifoItem.id, 60);
  await prisma.$executeRaw`
    UPDATE "rolls" SET "statusChangedAt" = NULL, "createdAt" = ${new Date("2020-01-01T00:00:00Z")}
    WHERE "id"::text = ${fDamgasiz}`;
  const ileDamgasiz = await sug(10);
  check(
    "§8g Damgasız top SONA düşer (öne değil)",
    ileDamgasiz[ileDamgasiz.length - 1] === fDamgasiz,
    `son=${ileDamgasiz[ileDamgasiz.length - 1] === fDamgasiz ? "damgasız" : "başka"}`,
  );

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
    // §8 fixture'ı (FIFO kumaşı + rengi) — topları silindikten SONRA.
    await prisma.color.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.item.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
