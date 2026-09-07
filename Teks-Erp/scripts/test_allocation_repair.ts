// =============================================================================
// BEKÇİ — DEFTER ONARIMI + EN TOLERANSI + FAZLA SEVK (2026-09-06)
// =============================================================================
// ÜÇ AYARIN DA VARSAYILANI BUGÜNKÜ DAVRANIŞTIR ve bu bekçinin en önemli işi
// bunu ölçmektir: `shipping.allocWidthToleranceEnabled` (kapalı = tam eşitlik),
// `shipping.allowOverAllocation` (kapalı = sipariş miktarı aşılamaz).
//
// ⭐ ÖLÇÜLEN ARIZA (fabrika yedeği 2026-09-05, `scripts/tahsis_teshis.ts`):
//    sevk edilmiş 89 sevkiyatın 42'sinde içerik sipariş defterine tam yazılmamış
//    (11.384,7 m) ve 42'sinde de sipariş SEÇİLİYDİ. Sebep sınıfları:
//      15.905 m  bugün YAZILABİLİRDİ (sevk anındaki durum — onarım bunu kurtarır)
//      15.723 m  kapasite dolu       (fazla sevk ayarı bunu kurtarır)
//         950 m  en tutmuyor         (en toleransı bunu kurtarır)
//         968 m  renk tutmuyor       (KURTARILMAZ — renk kesin eşleşir)
//
// ⭐ RENK PAZARLIK DIŞI: §3 renk toleransı OLMADIĞINI ölçer. Bir gün "renk de
//    esnesin" denirse bu kontrol kırmızı verir ve karar bilinçli alınır.
//
// ⭐ NEGATİF SONDA (2026-09-06): ① tolerans varsayılanı 5'e çekilirse §2 kırmızı
//    ② `specMatch`ten tolerans parametresi düşürülürse §2 kırmızı
//    ③ fazla sevk turu kaldırılırsa §4 kırmızı ④ onarım `setShipmentOrders`
//    çağırmazsa §5 kırmızı. Dördü de ölçüldü.
//    ⑥ (2026-09-07) `orders` alanı listeden düşerse §5 kırmızı (ölçüldü).
//    ⑤ (2026-09-07) önizleme motor yerine ayrı bir tahminle yazılırsa §5b
//    kırmızı — `distributeSacksToLines` çağrısı sabit diziyle değiştirildi.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { Prisma, RollStatus, ShipmentStatus } from "@prisma/client";
import { shippingService } from "../src/services/shipping.service";
import { specMatch } from "../src/services/helpers/allocation.helper";
import {
  SETTING_KEYS,
  readShippingAllocWidthToleranceCm,
  readShippingAllowOverAllocation,
} from "../src/services/system-setting.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

const TS = Date.now();
const P = `TEST-ALR-${TS}`;
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${detail ? ` — ${detail}` : ""}`); }
}

let ADMIN = "";
let CUSTOMER = "";
let ITEM = "";
let COLOR_A = "";
let COLOR_B = "";
const rollIds: string[] = [];
const sackIds: string[] = [];
const shipmentIds: string[] = [];
const orderIds: string[] = [];
/** Koşum öncesi ayar değerleri — finally'de BİREBİR geri yüklenir. */
const prevFlags = new Map<string, Prisma.JsonValue | undefined>();

async function setFlag(key: string, value: Prisma.InputJsonValue | null): Promise<void> {
  if (!prevFlags.has(key)) {
    const cur = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
    prevFlags.set(key, cur ? cur.value : undefined);
  }
  if (value === null) {
    await prisma.systemSetting.deleteMany({ where: { key } });
    return;
  }
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value, description: "test" },
    update: { value },
  });
}

async function topKur(width: number, qty: number, colorId: string | null): Promise<string> {
  const roll = await prisma.roll.create({
    data: {
      barcode: `${P}-R${rollIds.length}`,
      itemId: ITEM,
      colorId,
      initialQty: qty,
      currentQty: qty,
      qualityGrade: "1.KALITE",
      width,
      status: RollStatus.WAREHOUSE,
      entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true, barcode: true },
  });
  rollIds.push(roll.id);
  return roll.barcode as string;
}

async function cuvalKur(barkodlar: string[]): Promise<string> {
  const sack = (
    await shippingService.openSack({ customerId: CUSTOMER, sackNo: `${P}-S${sackIds.length}` }, ADMIN)
  ).data as { id: string };
  sackIds.push(sack.id);
  for (const b of barkodlar) await shippingService.scanIntoSack({ sackId: sack.id, barcode: b }, ADMIN);
  return sack.id;
}

async function siparisKur(lines: { colorId: string | null; width: number; qty: number }[]): Promise<string> {
  const o = await prisma.order.create({
    data: {
      orderNumber: `${P}-O${orderIds.length}`,
      customerId: CUSTOMER,
      orderDate: new Date(),
      lines: {
        create: lines.map((l) => ({
          itemId: ITEM,
          colorId: l.colorId,
          width: new Prisma.Decimal(l.width),
          quantity: new Prisma.Decimal(l.qty),
        })),
      },
    },
    select: { id: true },
  });
  orderIds.push(o.id);
  return o.id;
}

/** Sevkiyat kur ve tahsis edilen toplam metrajı döndür. */
async function sevkKur(sackId: string, orderId: string): Promise<{ id: string; tahsis: number }> {
  const res = await shippingService.createShipment(
    { sackIds: [sackId], customerId: CUSTOMER, orderIds: [orderId] },
    ADMIN,
  );
  const id = (res.data as { id: string }).id;
  shipmentIds.push(id);
  const agg = await prisma.sackAllocation.aggregate({ where: { sack: { shipmentId: id } }, _sum: { qty: true } });
  return { id, tahsis: Number(agg._sum.qty ?? 0) };
}

async function run(): Promise<void> {
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  ADMIN = admin?.id ?? "";
  CUSTOMER = (await prisma.customer.create({ data: { code: `${P}-C`, name: `${P} MUSTERI` }, select: { id: true } })).id;
  ITEM = (await prisma.item.create({ data: { code: `${P}-I`, name: `${P} KUMAS`, itemType: "FABRIC" }, select: { id: true } })).id;
  COLOR_A = (await prisma.color.create({ data: { code: `${P}-KA`, name: `${P} RENK A` }, select: { id: true } })).id;
  COLOR_B = (await prisma.color.create({ data: { code: `${P}-KB`, name: `${P} RENK B` }, select: { id: true } })).id;

  // ── §1 VARSAYILANLAR = BUGÜNKÜ DAVRANIŞ ───────────────────────────────────
  console.log("\n§1 — üç ayarın da varsayılanı BUGÜNKÜ davranış");
  await setFlag(SETTING_KEYS.SHIPPING_ALLOC_WIDTH_TOLERANCE_ENABLED, null);
  await setFlag(SETTING_KEYS.SHIPPING_ALLOC_WIDTH_TOLERANCE_CM, null);
  await setFlag(SETTING_KEYS.SHIPPING_ALLOW_OVER_ALLOCATION, null);
  check("kayıt yokken en toleransı 0 (tam eşitlik)", (await readShippingAllocWidthToleranceCm()) === 0);
  check("kayıt yokken fazla sevk KAPALI", (await readShippingAllowOverAllocation()) === false);
  check(
    "⭐ toleranssız `specMatch` en farkını REDDEDER (bugünkü davranış)",
    !specMatch(
      { itemId: ITEM, colorId: COLOR_A, width: new Prisma.Decimal(330) },
      { itemId: ITEM, colorId: COLOR_A, width: new Prisma.Decimal(330.1) },
    ),
  );

  // ── §2 EN TOLERANSI ───────────────────────────────────────────────────────
  console.log("\n§2 — EN toleransı: yalnız eni gevşetir");
  check(
    "⭐ tolerans 5 iken 0,1 cm fark KABUL",
    specMatch(
      { itemId: ITEM, colorId: COLOR_A, width: new Prisma.Decimal(330) },
      { itemId: ITEM, colorId: COLOR_A, width: new Prisma.Decimal(330.1) },
      5,
    ),
  );
  check(
    "⭐ tolerans 5 iken 5 cm fark KABUL (sınır dahil)",
    specMatch(
      { itemId: ITEM, colorId: COLOR_A, width: new Prisma.Decimal(330) },
      { itemId: ITEM, colorId: COLOR_A, width: new Prisma.Decimal(325) },
      5,
    ),
  );
  check(
    "⭐ tolerans 5 iken 6 cm fark RED (sınırın dışı gerçekten dışarıda)",
    !specMatch(
      { itemId: ITEM, colorId: COLOR_A, width: new Prisma.Decimal(330) },
      { itemId: ITEM, colorId: COLOR_A, width: new Prisma.Decimal(324) },
      5,
    ),
  );

  // ── §3 RENK PAZARLIK DIŞI ─────────────────────────────────────────────────
  console.log("\n§3 — RENK ve KUMAŞ toleranstan ETKİLENMEZ");
  check(
    "⭐ tolerans 999 olsa bile FARKLI RENK reddedilir",
    !specMatch(
      { itemId: ITEM, colorId: COLOR_A, width: new Prisma.Decimal(330) },
      { itemId: ITEM, colorId: COLOR_B, width: new Prisma.Decimal(330) },
      999,
    ),
  );
  check(
    "⭐ tolerans 999 olsa bile FARKLI KUMAŞ reddedilir",
    !specMatch(
      { itemId: ITEM, colorId: COLOR_A, width: new Prisma.Decimal(330) },
      { itemId: COLOR_B, colorId: COLOR_A, width: new Prisma.Decimal(330) },
      999,
    ),
  );

  // ── §4 FAZLA SEVK ─────────────────────────────────────────────────────────
  console.log("\n§4 — fazla sevk: kapalıyken yazılmaz, açıkken yazılır");
  const b1 = await topKur(150, 100, COLOR_A);
  const sack1 = await cuvalKur([b1]);
  const ord1 = await siparisKur([{ colorId: COLOR_A, width: 150, qty: 40 }]);
  const s1 = await sevkKur(sack1, ord1);
  check(
    "⭐ KAPALIYKEN tahsis sipariş miktarını AŞMAZ (40 m ısmarlanan → 40 m yazılır)",
    Math.abs(s1.tahsis - 40) < 0.01,
    `${s1.tahsis} m`,
  );

  await setFlag(SETTING_KEYS.SHIPPING_ALLOW_OVER_ALLOCATION, true);
  const b2 = await topKur(150, 100, COLOR_A);
  const sack2 = await cuvalKur([b2]);
  const ord2 = await siparisKur([{ colorId: COLOR_A, width: 150, qty: 40 }]);
  const s2 = await sevkKur(sack2, ord2);
  check(
    "⭐ AÇIKKEN fazlalık da yazılır (100 m çuval → 100 m yazılır)",
    Math.abs(s2.tahsis - 100) < 0.01,
    `${s2.tahsis} m`,
  );
  await setFlag(SETTING_KEYS.SHIPPING_ALLOW_OVER_ALLOCATION, null);

  // ── §5 ONARIM ─────────────────────────────────────────────────────────────
  console.log("\n§5 — defter onarımı: sipariş sonradan büyürse boşluk kapanır");
  const b3 = await topKur(150, 100, COLOR_A);
  const sack3 = await cuvalKur([b3]);
  const ord3 = await siparisKur([{ colorId: COLOR_A, width: 150, qty: 40 }]);
  const s3 = await sevkKur(sack3, ord3);
  check("kurulumda yalnız 40 m yazıldı (60 m boşluk)", Math.abs(s3.tahsis - 40) < 0.01, `${s3.tahsis} m`);

  const liste1 = (await shippingService.listRepairableShipments()).data as {
    shipmentId: string; bosluk: number; onarilabilirMetraj: number;
    orderNumbers: string[]; orders?: { id: string; orderNumber: string }[];
  }[];
  const kayit1 = liste1.find((x) => x.shipmentId === s3.id);
  check("⭐ boşluklu sevkiyat listede ve boşluk 60 m", !!kayit1 && Math.abs(kayit1.bosluk - 60) < 0.01, `${kayit1?.bosluk}`);

  // ⭐ 2026-09-07: sipariş numarası panelde TIKLANABİLİR olmalı ve bunun için id
  //    gerekir. Numaradan id'yi ARAYARAK bulmak ikinci bir okuma yoluydu ve
  //    mükerrer numarada YANLIŞ siparişi açardı. `orderNumbers` sahadaki panel
  //    okuduğu için KALDIRILMADI — iki alan aynı kümeyi göstermek zorunda.
  check(
    "⭐ liste sipariş id'sini de taşıyor (numara tıklanabilir olsun)",
    kayit1?.orders?.length === 1 && kayit1.orders[0]!.id === ord3,
    JSON.stringify(kayit1?.orders),
  );
  check(
    "⭐ `orders` ile `orderNumbers` AYNI kümeyi gösteriyor (ayrışan yüzey yok)",
    JSON.stringify(kayit1?.orders?.map((o) => o.orderNumber)) === JSON.stringify(kayit1?.orderNumbers),
    `${JSON.stringify(kayit1?.orderNumbers)}`,
  );
  check(
    "⭐ kapasite dolu olduğu için 'onarılabilir' 0 (kapı kör değil)",
    !!kayit1 && kayit1.onarilabilirMetraj < 0.01,
    `${kayit1?.onarilabilirMetraj}`,
  );

  // Sipariş sonradan büyüdü — sahadaki asıl senaryo.
  const line3 = await prisma.orderLine.findFirst({ where: { orderId: ord3 }, select: { id: true } });
  await prisma.orderLine.update({ where: { id: line3!.id }, data: { quantity: new Prisma.Decimal(100) } });
  const liste2 = (await shippingService.listRepairableShipments()).data as {
    shipmentId: string; onarilabilirMetraj: number;
  }[];
  const kayit2 = liste2.find((x) => x.shipmentId === s3.id);
  check(
    "⭐ sipariş büyüyünce 'onarılabilir' metraj DOLDU (teşhis zamanlamayı görüyor)",
    !!kayit2 && kayit2.onarilabilirMetraj > 0.01,
    `${kayit2?.onarilabilirMetraj} m`,
  );

  // ── §5b ÖNİZLEME YALAN SÖYLEMEZ (2026-09-07) ──────────────────────────────
  // ⭐ Bu bekçinin en önemli tek kontrolü burada: önizleme, ONARIMIN GERÇEKTEN
  //    YAZDIĞI metrajı söylemek zorunda. Önizleme ayrı bir "tahmin" fonksiyonu
  //    ile yazılsaydı ikisi sessizce ayrışırdı ve kullanıcı onaya bakarak yanlış
  //    karar verirdi ("ayrışan yüzey" sınıfı). Ölçüt: ön-izlemenin satır
  //    toplamı == onarımın kazancı.
  const onz = (await shippingService.previewRepairAllocation(s3.id)).data as {
    yazilacakMetraj: number;
    kalemler: { orderNumber: string; itemName: string; yazilacak: number; acikOnce: number; acikSonra: number }[];
  };
  check("⭐ önizleme SATIR bazlı döküm veriyor (soyut toplam değil)", onz.kalemler.length > 0,
    `${onz.kalemler.length} kalem`);
  check("önizleme kaleminde sipariş no + ürün adı var (tablo kolonları dolu)",
    !!onz.kalemler[0]?.orderNumber && !!onz.kalemler[0]?.itemName,
    JSON.stringify(onz.kalemler[0] ?? null));
  check(
    "kalem aritmetiği tutuyor: açıkÖnce − yazılacak = açıkSonra",
    onz.kalemler.every((k) => Math.abs(k.acikOnce - k.yazilacak - k.acikSonra) < 0.01),
  );
  const onzToplam = onz.kalemler.reduce((a2, k) => a2 + k.yazilacak, 0);
  check("önizleme toplamı kalemlerin toplamına eşit", Math.abs(onzToplam - onz.yazilacakMetraj) < 0.01,
    `${onzToplam} ↔ ${onz.yazilacakMetraj}`);

  const onarim = (await shippingService.repairShipmentAllocation(s3.id, ADMIN)).data as {
    oncesi: number; sonrasi: number; kazanc: number;
  };
  check(
    "⭐ ÖNİZLEME = SONUÇ — vaat edilen metraj gerçekten yazıldı",
    Math.abs(onz.yazilacakMetraj - onarim.kazanc) < 0.01,
    `önizleme ${onz.yazilacakMetraj} m ↔ onarım ${onarim.kazanc} m`,
  );
  check(
    "⭐ onarım defteri BÜYÜTTÜ (40 → 100)",
    Math.abs(onarim.sonrasi - 100) < 0.01 && onarim.kazanc > 0.01,
    JSON.stringify(onarim),
  );
  const liste3 = (await shippingService.listRepairableShipments()).data as { shipmentId: string }[];
  check(
    "⭐ onarımdan sonra sevkiyat listeden DÜŞTÜ (boşluk kapandı)",
    !liste3.some((x) => x.shipmentId === s3.id),
  );

  // ── §6 KAPI ───────────────────────────────────────────────────────────────
  console.log("\n§6 — onarım kapısı");
  let hata = false;
  try {
    await shippingService.repairShipmentAllocation("00000000-0000-0000-0000-000000000000", ADMIN);
  } catch { hata = true; }
  check("olmayan sevkiyat 404", hata);
}

async function teardown(): Promise<void> {
  for (const [k, v] of prevFlags) {
    if (v === undefined) await prisma.systemSetting.deleteMany({ where: { key: k } }).catch(() => {});
    else await prisma.systemSetting.update({ where: { key: k }, data: { value: v as Prisma.InputJsonValue } }).catch(() => {});
  }
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } }).catch(() => {});
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: shipmentIds } } }).catch(() => {});
  await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: shipmentIds } } }).catch(() => {});
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
  await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
  await prisma.sack.deleteMany({ where: { id: { in: sackIds } } }).catch(() => {});
  await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } }).catch(() => {});
  await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } }).catch(() => {});
  for (const c of [COLOR_A, COLOR_B]) if (c) await prisma.color.deleteMany({ where: { id: c } }).catch(() => {});
  if (ITEM) await prisma.item.deleteMany({ where: { id: ITEM } }).catch(() => {});
  if (CUSTOMER) await prisma.customer.deleteMany({ where: { id: CUSTOMER } }).catch(() => {});
}

run()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    await teardown().catch((e) => console.error("teardown hatası:", e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
