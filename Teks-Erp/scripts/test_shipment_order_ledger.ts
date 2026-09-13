// =============================================================================
// BEKÇİ — SEVKİYAT ↔ SİPARİŞ DEFTERİ (2026-08-29 / BULGU-T1-010 + T3-003)
// Çalıştır: npx tsx scripts/test_shipment_order_ledger.ts
// =============================================================================
//   §1 AŞIRI SEVK (ardışık, YARIŞ DEĞİL) — sevk onayı AÇIKKEN pazartesi kurulan
//      PLANNED sevkiyat 500 m'lik kalemi ayırır; salı kurulan ikinci sevkiyat
//      `shippedQty` hâlâ 0 olduğu için AYNI 500 m'yi bir daha ayırır. İkisi de
//      sevk edilince kalem 1000 m sevk edilmiş olur: sipariş COMPLETED, "Açık
//      0", hiçbir uyarı yok ve 500 m fazla mal müşteriye çıkmıştır.
//      Düzeltme: kalan kapasite artık DİĞER sevkiyatların PLANNED tahsislerini
//      de düşer. Hiçbir RAKAM değişmez (shippedQty / İstenen|Sevk|Açık aynı) —
//      yalnız "bu kaleme daha ne kadar tahsis edilebilir" doğrulanır.
//
//   §2 İPTAL EDİLMİŞ SİPARİŞE SEVK — `assertOrdersBelong` sipariş DURUMUNU
//      seçmiyordu bile. Ön kontrol artık okunaklı 400 verir.
//
//   §2b AYNI ŞEYİN YARIŞI — "Sevkiyat Kur" diyaloğu dakikalarca açık kalır,
//      arada satış siparişi iptal eder. Ön kontrol o an temiz görür; yakalayan
//      şey KİLİT ALTINDAKİ taze doğrulamadır (409). İki katman ayrı iş görür:
//      biri anlaşılır cevap verir, diğeri yarışı kapatır. Sonda ön kontrolün
//      okumasını kandırarak pencereyi açar.
//
//   §4 TAHSİSSİZ SEVK GÖRÜNÜR — tablet ekranı `orderIds` GÖNDERMİYOR (sabit
//      undefined), yani oradan çıkan HER sevkiyat sipariş defterine yazılmadan
//      çıkıyordu ve hiçbir yerde iz bırakmıyordu. Artık yanıt uyarı taşır;
//      `orderless: true` diyen istemci (niyet beyanı) uyarı almaz. 400 DEĞİL:
//      backend önce deploy edilir, sert red tüm tabletleri kilitlerdi.
//
//   §5 ONARIM YOLU — sevk EDİLMİŞ sevkiyat sonradan siparişe bağlanabiliyor.
//      Eskiden hiçbir yol yoktu (`setShipmentOrdersTx` yalnız createShipment'tan
//      çağrılıyordu, add-sacks/remove-sack PLANNED istiyordu) → tek çıkış storno
//      + yeniden kurmaktı, faturalanmışsa o da reddediliyordu.
//
//   §3 PROTOKOL SIRASI — kalem kilidi kapasite okumasından ÖNCE alınmalı (fason
//      `directShip` ile aynı). Bu bir SIRA invariantıdır; davranışla ölçmek
//      güvenilmez, çünkü `shipmentNo` çakışma-retry'si yarışı maskeler (ölçüldü:
//      sıra bozulunca da sonuç doğru çıkıyordu). O yüzden metin olarak ölçülür —
//      `test_dispatch_without_color` §1 emsali.
// =============================================================================
// ⭐ NEGATİF SONDA (2026-09-06, ölçüldü): `performDispatchTx`ta `sackAllocation.createMany` girdisi boş diziye
//    çevrildi (tahsis defteri hiç yazılmadı) -> 5 kontrol KIRMIZI. Sınıf: sipariş
//    "Açık" görünmeye devam eder, mal çıkmış olmasına rağmen.
//    Geri alındığında yeşil.
import prisma, { pool } from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";
import { OrderStatus, RollStatus, ShipmentStatus } from "@prisma/client";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { readFileSync } from "fs";
import { join } from "path";
import { fixtureWarehouseId } from "./fixture-warehouse";

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

const ts = Date.now();
const svc = new ShippingService();
const sackIds: string[] = [];
const rollIds: string[] = [];
const shipmentIds: string[] = [];
let customerId = "";
let itemId = "";
let onayEskiDeger: string | null = null;

/** Depoda, sevkiyata bağlanmamış, tek toplu bir çuval kurar. */
async function makeSack(tag: string, qty: number): Promise<string> {
  const sack = await prisma.sack.create({
    data: { sackNo: `TST-SOL-${tag}-${ts}`, customerId },
    select: { id: true },
  });
  sackIds.push(sack.id);
  const roll = await prisma.roll.create({
    data: {
        // Sevk edilebilmek icin deposu DOLU olmali: deposuz bir top stok
        // kumesinden cikamaz (`assertRollsHaveWarehouse`, 409). Uretimde
        // deposuz top dogamaz, fikstur de uretmemeli.
        warehouseId: await fixtureWarehouseId(),
      barcode: `TST-SOL-${tag}-${ts}`,
      itemId,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.WAREHOUSE,
      sackId: sack.id,
    },
    select: { id: true },
  });
  rollIds.push(roll.id);
  return sack.id;
}

async function kur(sackId: string, orderIds: string[]): Promise<string> {
  const r = await svc.createShipment({ sackIds: [sackId], customerId, orderIds }, undefined);
  const id = (r.data as { id: string }).id;
  shipmentIds.push(id);
  return id;
}

async function tahsis(lineId: string): Promise<number> {
  const a = await prisma.sackAllocation.aggregate({ where: { orderLineId: lineId }, _sum: { qty: true } });
  return Number(a._sum.qty ?? 0);
}

async function shippedOf(lineId: string): Promise<number> {
  const l = await prisma.orderLine.findUnique({ where: { id: lineId }, select: { shippedQty: true } });
  return Number(l?.shippedQty ?? 0);
}

type Hata = { message: string; code?: string; statusCode?: number } | null;
async function hataOf(fn: () => Promise<unknown>): Promise<Hata> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { message: string; statusCode?: number; details?: { code?: string } };
    return { message: err.message, code: err.details?.code, statusCode: err.statusCode };
  }
}

async function main(): Promise<void> {
  const customer = await prisma.customer.create({
    data: { code: `TST-SOL-CUS-${ts}`, name: `Test Sevk Defteri ${ts}` },
    select: { id: true },
  });
  customerId = customer.id;
  const item = await prisma.item.create({
    data: { code: `TST-SOL-ITM-${ts}`, name: `Test Sevk Defteri Kumaş ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  itemId = item.id;

  // ═══ §1 — sevk onayı AÇIK: ardışık iki sevkiyat aynı talebi ayıramaz ═══
  console.log("\n=== §1: onay AÇIK — 500 m'lik kaleme ardışık iki sevkiyat ===");
  const eski = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED },
    select: { value: true },
  });
  onayEskiDeger = eski ? JSON.stringify(eski.value) : null;
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED },
    create: { key: SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED, value: true },
    update: { value: true },
  });

  const order = await prisma.order.create({
    data: { orderNumber: `TEST-SOL-${ts}`, customerId, lines: { create: [{ itemId, quantity: 500 }] } },
    select: { id: true, lines: { select: { id: true } } },
  });
  const lineId = order.lines[0].id;

  const sh1 = await kur(await makeSack("A", 300), [order.id]);
  const t1 = await tahsis(lineId);
  check("§1: ilk sevkiyat 300 m ayırdı", t1 === 300, `Σ tahsis ${t1}`);
  const durum1 = await prisma.shipment.findUnique({ where: { id: sh1 }, select: { status: true } });
  check("§1: onay AÇIK → sevkiyat PLANNED doğdu (rejim doğru kuruldu)", durum1?.status === ShipmentStatus.PLANNED, durum1?.status ?? "");

  await kur(await makeSack("B", 300), [order.id]);
  const t2 = await tahsis(lineId);
  check(
    "§1: ikinci sevkiyat AYNI talebi bir daha ayırmadı (kalan 200 m)",
    t2 === 500,
    `Σ tahsis ${t2} / istenen 500`,
  );

  // İkisini de sevk et → defter aşmamalı.
  for (const id of [sh1, shipmentIds[shipmentIds.length - 1]]) {
    await svc.dispatchShipment(id, {}, undefined);
  }
  const shipped = await shippedOf(lineId);
  check("§1: sevk sonrası defter siparişi AŞMADI", shipped <= 500, `shippedQty ${shipped} / istenen 500`);

  // Rejimi geri al — kalan bölümler saha varsayılanında (onay KAPALI) koşsun.
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED },
    create: { key: SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED, value: false },
    update: { value: false },
  });

  // ═══ §2 — iptal edilmiş siparişe sevkiyat (ön kontrol) ═══
  console.log("\n=== §2: iptal edilmiş siparişe sevkiyat ===");
  const iptalOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-SOL-C-${ts}`,
      customerId,
      status: OrderStatus.CANCELLED,
      lines: { create: [{ itemId, quantity: 400 }] },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  const iptalLineId = iptalOrder.lines[0].id;
  const sackC = await makeSack("C", 200);
  const onErr = await hataOf(() => kur(sackC, [iptalOrder.id]));
  check("§2: iptal edilmiş siparişe sevkiyat REDDEDİLDİ", onErr !== null, onErr?.message?.slice(0, 70) ?? "");
  check(
    "§2: TX'E GİRMEDEN reddedildi (ön kontrol 400, kilit-altı 409 DEĞİL)",
    onErr?.statusCode === 400,
    `statusCode ${onErr?.statusCode ?? "—"}`,
  );
  check(
    "§2: mesaj sipariş numarasını söylüyor (operatör hangisi olduğunu görsün)",
    Boolean(onErr?.message.includes(`TEST-SOL-C-${ts}`)),
    onErr?.message?.slice(0, 55) ?? "",
  );
  check("§2: iptal kaleme tahsis YAZILMADI", (await tahsis(iptalLineId)) === 0);

  // ═══ §2b — diyalog açıkken iptal edildi (kilit altında yakalanır) ═══
  console.log("\n=== §2b: diyalog açıkken iptal (kilit altında taze doğrulama) ===");
  const yarisOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-SOL-R-${ts}`,
      customerId,
      status: OrderStatus.CANCELLED,
      lines: { create: [{ itemId, quantity: 400 }] },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  const yarisLineId = yarisOrder.lines[0].id;
  const sackD = await makeSack("D", 200);

  // Ön kontrolün okuması KANDIRILIR: sipariş ona CANLI görünür (diyalog o anda
  // açılmıştı). tx içindeki taze okuma dokunulmaz — gerçeği o görecek.
  type FindManyFn = (args: unknown) => Promise<unknown>;
  const gercekFindMany = prisma.order.findMany.bind(prisma.order) as unknown as FindManyFn;
  let kandirildi = false;
  (prisma.order as unknown as { findMany: FindManyFn }).findMany = async (args: unknown) => {
    const rows = (await gercekFindMany(args)) as Array<{ id: string; status?: OrderStatus }>;
    if (!kandirildi && Array.isArray(rows) && rows.some((r) => r.id === yarisOrder.id)) {
      kandirildi = true;
      return rows.map((r) => (r.id === yarisOrder.id ? { ...r, status: OrderStatus.PENDING } : r));
    }
    return rows;
  };
  const yarisErr = await hataOf(() => kur(sackD, [yarisOrder.id]));
  (prisma.order as unknown as { findMany: FindManyFn }).findMany = gercekFindMany;

  check("§2b: sonda ön kontrolü gerçekten kandırdı (yarış penceresi açıldı)", kandirildi);
  check("§2b: kilit ALTINDAKİ taze doğrulama yakaladı", yarisErr !== null, yarisErr?.message?.slice(0, 60) ?? "");
  check(
    "§2b: MAKİNE-OKUR kod + 409 (ön kontrol DEĞİL, kilit altı)",
    yarisErr?.code === "ORDER_CANCELLED_DURING_SHIPMENT" && yarisErr?.statusCode === 409,
    `${yarisErr?.code ?? "—"} / ${yarisErr?.statusCode ?? "—"}`,
  );
  check("§2b: iptal kaleme tahsis YAZILMADI", (await tahsis(yarisLineId)) === 0);
  check(
    "§2b: yarım sevkiyat kaydı kalmadı (tx geri sarıldı)",
    (await prisma.shipment.count({ where: { sacks: { some: { id: sackD } } } })) === 0,
  );

  // ═══ §4 — tahsissiz sevk UYARI üretir, niyet beyanı susturur ═══
  console.log("\n=== §4: siparişsiz sevkiyat uyarısı ===");
  const sackE = await makeSack("E", 150);
  const r4 = await svc.createShipment({ sackIds: [sackE], customerId }, undefined);
  shipmentIds.push((r4.data as { id: string }).id);
  check(
    "§4: sipariş seçilmeden kurulan sevkiyat UYARI döndürdü",
    (r4.warnings?.length ?? 0) > 0,
    r4.warnings?.[0]?.slice(0, 60) ?? "uyarı yok",
  );
  check(
    "§4: uyarı ne yapılacağını söylüyor (Siparişe Bağla)",
    Boolean(r4.warnings?.[0]?.includes("Siparişe Bağla")),
  );
  const sackF = await makeSack("F", 150);
  const r5 = await svc.createShipment({ sackIds: [sackF], customerId, orderless: true }, undefined);
  shipmentIds.push((r5.data as { id: string }).id);
  check(
    "§4: NİYET beyan edilince (orderless) uyarı YOK — meşru siparişsiz sevk susturulabiliyor",
    (r5.warnings?.length ?? 0) === 0,
    r5.warnings?.[0]?.slice(0, 40) ?? "—",
  );

  // ═══ §5 — sevk EDİLMİŞ sevkiyatı sonradan siparişe bağla ═══
  console.log("\n=== §5: onarım — sevk edilmiş sevkiyatı siparişe bağla ===");
  const onarimOrder = await prisma.order.create({
    data: { orderNumber: `TEST-SOL-F-${ts}`, customerId, lines: { create: [{ itemId, quantity: 200 }] } },
    select: { id: true, lines: { select: { id: true } } },
  });
  const onarimLineId = onarimOrder.lines[0].id;
  const bozukSh = (r4.data as { id: string }).id;
  const bozukDurum = await prisma.shipment.findUnique({ where: { id: bozukSh }, select: { status: true } });
  check("§5: onarılacak sevkiyat SEVK EDİLMİŞ durumda", bozukDurum?.status === ShipmentStatus.DISPATCHED, bozukDurum?.status ?? "");
  check("§5: kurulumda defter BOŞ (hata durumunun kendisi)", (await shippedOf(onarimLineId)) === 0);

  await svc.setShipmentOrders(bozukSh, [onarimOrder.id], undefined);
  check("§5: bağlandıktan sonra tahsis yazıldı", (await tahsis(onarimLineId)) === 150, `Σ tahsis ${await tahsis(onarimLineId)}`);
  check(
    "§5: sipariş defteri güncellendi (shippedQty terfi etti)",
    (await shippedOf(onarimLineId)) === 150,
    `shippedQty ${await shippedOf(onarimLineId)}`,
  );
  const bag = await prisma.shipmentOrder.findMany({ where: { shipmentId: bozukSh }, select: { orderId: true, isActive: true } });
  check("§5: bağ satırı yazıldı", bag.length === 1 && bag[0].orderId === onarimOrder.id);
  check("§5: sevk edilmiş sevkiyatta bağ PASİF doğdu (dispatch semantiği korunuyor)", bag[0]?.isActive === false);
  const belgeler = await prisma.printedDocument.findMany({
    where: { sourceId: bozukSh, docType: "SHIPMENT_DISPATCH" },
    select: { version: true },
    orderBy: { version: "desc" },
  });
  check("§5: irsaliye yeni sipariş kümesiyle yeniden donduruldu (v+1)", (belgeler[0]?.version ?? 0) >= 2, `v${belgeler[0]?.version ?? 0}`);

  // AYNI bağı tekrar yazmak tahsisi KÜÇÜLTMEMELİ: eski tahsis silindikten sonra
  // defter ONSUZ yeniden hesaplanmazsa `shippedQty` hâlâ silineni sayar ve kalan
  // kapasite EKSİK çıkar (200 − 150 = 50 m). Sıranın ölçüldüğü yer burası.
  await svc.setShipmentOrders(bozukSh, [onarimOrder.id], undefined);
  check(
    "§5: aynı bağ tekrar yazılınca tahsis KÜÇÜLMEDİ (defter önce sıfırlanıyor)",
    (await tahsis(onarimLineId)) === 150,
    `Σ tahsis ${await tahsis(onarimLineId)}`,
  );

  // Bağı kaldırma da çalışmalı — defter geri düşer.
  await svc.setShipmentOrders(bozukSh, [], undefined);
  check("§5: bağ kaldırılınca defter geri düştü", (await shippedOf(onarimLineId)) === 0, `shippedQty ${await shippedOf(onarimLineId)}`);

  // İptal edilmiş sevkiyat bağlanamaz.
  const iptalSh = await prisma.shipment.create({
    data: { shipmentNo: `TST-SOL-X-${ts}`, customerId, status: ShipmentStatus.CANCELLED },
    select: { id: true },
  });
  shipmentIds.push(iptalSh.id);
  const iptalErr = await hataOf(() => svc.setShipmentOrders(iptalSh.id, [onarimOrder.id], undefined));
  check("§5: İPTAL edilmiş sevkiyat siparişe bağlanamıyor", iptalErr?.statusCode === 409, `${iptalErr?.statusCode ?? "—"}`);

  // ═══ §6 — SEVK DEFTERİNİN İZİ (T2-003) ═══
  // `SackAllocation` mali etkisi olan tek defterdir ve değişim geçmişi HİÇ
  // yoktu: "sipariş 'Açık 1000 m' görünüyor ama operatör sevk ettim diyor"
  // sorusunda destek, tahsisin HİÇ yazılmadığını mı yoksa yazılıp SİLİNDİĞİNİ
  // mi ayırt edemiyordu (bu denetimde birebir yaşandı).
  console.log("\n=== §6: sevk defterinin izi ===");
  const izler = await prisma.systemLog.findMany({
    where: { tableName: "SACK_ALLOCATION", recordId: { in: shipmentIds } },
    select: { newData: true },
  });
  check("§6: tahsis yazımı audit'e düştü", izler.length > 0, `${izler.length} satır`);
  const ornek = izler[0]?.newData as { yazilan?: unknown[]; atlanan?: unknown[] } | null;
  check("§6: YAZILAN kalemler kayıtlı", Array.isArray(ornek?.yazilan), JSON.stringify(ornek?.yazilan)?.slice(0, 50) ?? "—");
  // ⚠️ ASIL DEĞER BURADA: "şu satıra neden yazılmadı" sorusunu tek satırda
  // cevaplar. Yalnız yazılanı görmek yarım cevaptır.
  check("§6: ATLANAN kalemler de kayıtlı (asıl teşhis alanı)", Array.isArray(ornek?.atlanan));

  // ═══ §3 — protokol sırası (metin) ═══
  console.log("\n=== §3: kalem kilidi kapasite okumasından ÖNCE mi ===");
  const src = readFileSync(join(__dirname, "../src/services/shipping.service.ts"), "utf8");
  const basla = src.indexOf("private async writeShipmentAllocationsTx");
  const bitis = basla >= 0 ? src.indexOf("\n  }", basla) : -1;
  // KÖRLÜK ZEMİNİ: fonksiyon bulunamazsa "ihlal yok" ile "hiçbir şeye bakılmadı"
  // aynı yeşile çıkardı. Yeniden adlandırılırsa bu kontrol KIRMIZI vermeli.
  check("§3: writeShipmentAllocationsTx gövdesi bulundu (körlük zemini)", basla >= 0 && bitis > basla);
  if (basla >= 0 && bitis > basla) {
    const govde = src.slice(basla, bitis);
    // ⚠️ ÇAĞRI BİÇİMİ aranır, çıplak ad DEĞİL: gövdedeki açıklama satırı da
    // `touchOrderLinesTx` yazıyor ve ilk yazımda kontrol tam da onu buluyordu →
    // çağrı aşağı taşındığı hâlde bekçi YEŞİL kalmıştı (ölçüldü). Bekçinin kör
    // noktası, tam da ölçmesi gereken şeyin üstündeydi.
    const kilit = govde.indexOf("await touchOrderLinesTx(");
    const okuma = govde.indexOf("this.computeSackAllocations(");
    check("§3: gövde her iki çağrıyı da içeriyor", kilit >= 0 && okuma >= 0, `kilit@${kilit} okuma@${okuma}`);
    check(
      "§3: KİLİT kapasite okumasından ÖNCE (fason directShip protokolü)",
      kilit >= 0 && okuma >= 0 && kilit < okuma,
      `kilit@${kilit} < okuma@${okuma}`,
    );
  }
}

async function cleanup(): Promise<void> {
  if (onayEskiDeger !== null) {
    await prisma.systemSetting
      .update({
        where: { key: SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED },
        data: { value: JSON.parse(onayEskiDeger) as boolean },
      })
      .catch(() => {});
  } else {
    await prisma.systemSetting
      .deleteMany({ where: { key: SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED } })
      .catch(() => {});
  }
  const allSacks = await prisma.sack.findMany({
    where: { sackNo: { startsWith: "TST-SOL-" } },
    select: { id: true, shipmentId: true },
  });
  const sids = [...new Set([...shipmentIds, ...allSacks.map((s) => s.shipmentId).filter((x): x is string => !!x)])];
  const sackAll = [...new Set([...sackIds, ...allSacks.map((s) => s.id)])];
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackAll } } }).catch(() => {});
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: sids } } }).catch(() => {});
  await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: sids } } }).catch(() => {});
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
  await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
  await prisma.sack.deleteMany({ where: { id: { in: sackAll } } }).catch(() => {});
  await prisma.shipment.deleteMany({ where: { id: { in: sids } } }).catch(() => {});
  await prisma.orderLine.deleteMany({ where: { order: { orderNumber: { startsWith: "TEST-SOL-" } } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { orderNumber: { startsWith: "TEST-SOL-" } } }).catch(() => {});
  if (itemId) await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
  if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => {});
}

main()
  .catch((err) => {
    console.error("Beklenmeyen hata:", err);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
