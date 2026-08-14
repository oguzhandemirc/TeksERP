// =============================================================================
// BEKÇİ — İPLİK KG-STOK DEFTERİ (Paket D1)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_yarn_stock.ts
//
// NEDEN: `YarnStock.balanceKg` DENORMALİZE bir alandır ve DB'de onu koruyan
// hiçbir sed YOKTUR (CHECK yok, trigger yok). Tek koruma "her bakiye yazımı
// aynı tx'te bir hareket satırı doğurur" kuralıdır — ve o kural kodda yaşar,
// yani sessizce kırılabilir. Kırıldığında hata da log da çıkmaz: yalnız depo
// sayımı tutmaz, aylar sonra, ne zaman saptığı bulunamadan. Bu dosya o kuralın
// TEK mekanik kanıtıdır.
//
// ÖLÇÜLENLER:
//   §1 Bakiye ↔ Σ(hareket) MUTABAKATI (dört yönde de)
//   §2 ⭐ NEGATİF bakiye GERÇEKTEN yazılır (reddedilmez, sıfıra kırpılmaz) ve
//      DB'den geri okunduğunda da eksidir — dönüş değerine değil KAYDA bakılır
//   §3 ⭐ EŞZAMANLI hareketler (paralel, AYRI tx) bakiyeyi DOĞRU toplar —
//      okuyup-yazan bir uygulama bu kontrolde birinin etkisini yutar
//   §4 DB CHECK'i sıfır/negatif miktarı reddeder (uygulama guard'ı devre dışı
//      bırakılsa bile ikinci hat duruyor)
//   §5 Dış referans doğrulaması: kumaş kalemi / pasif depo / pasif kalem
//   §6 ⭐ MAL KABUL: iplik satırı IN doğurur ve `Roll` DOĞURMAZ; iptal TERS
//      KAYIT yazar ve İDEMPOTENTTİR; KUMAŞ-only fiş hiç iplik satırı doğurmaz
//   §7 Liste yüzeyleri (bakiye filtresi + cursor sayfalama tutarlılığı)
//   §8 KÖRLÜK ZEMİNİ — "hiç satır yoktu" ile "ihlal yok" aynı yeşile çıkmasın
//   §9 ⭐ ROTA KAPISI (kaynak taraması): rejim bayrağı + izin guard'ı + SIRA
//
// Fixture'ı test KENDİSİ yaratır (ortam verisine bağımlı değil, hardcoded UUID
// yok); her şey `TEST-YRN-<damga>` önekiyle doğar ve finally'de silinir.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GoodsReceiptStatus, ItemType, ItemUnit, Prisma, RollStatus, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { yarnService, yarnMovementSign, reverseGoodsReceiptYarnTx } from "../src/services/yarn.service";
import { goodsReceiptService } from "../src/services/goods-receipt.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const TAG = `TEST-YRN-${Date.now()}`;
const itemIds: string[] = [];
const warehouseIds: string[] = [];
const receiptIds: string[] = [];

const D = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v);

/** Bakiyeyi DB'den okur — servisin dönüş değerine değil KAYDA bakılır. */
async function balanceOf(itemId: string, warehouseId: string): Promise<Prisma.Decimal> {
  const row = await prisma.yarnStock.findUnique({
    where: { itemId_warehouseId: { itemId, warehouseId } },
    select: { balanceKg: true },
  });
  return row ? D(row.balanceKg) : D(0);
}

/** Hareketlerin işaretli toplamı — mutabakatın karşı tarafı. */
async function ledgerSum(itemId: string, warehouseId: string): Promise<Prisma.Decimal> {
  const rows = await prisma.yarnMovement.findMany({
    where: { itemId, warehouseId },
    select: { kind: true, qtyKg: true },
  });
  return rows.reduce((s, r) => s.plus(D(r.qtyKg).mul(yarnMovementSign(r.kind))), D(0));
}

async function main(): Promise<void> {
  console.log("=== İplik kg-stok bekçisi ===\n");

  // ── FIXTURE ───────────────────────────────────────────────────────────────
  const wh = await prisma.warehouse.create({ data: { code: `${TAG}-D1`, name: `${TAG} Depo 1` }, select: { id: true } });
  const wh2 = await prisma.warehouse.create({ data: { code: `${TAG}-D2`, name: `${TAG} Depo 2` }, select: { id: true } });
  const whPassive = await prisma.warehouse.create({
    data: { code: `${TAG}-DP`, name: `${TAG} Pasif Depo`, isActive: false },
    select: { id: true },
  });
  warehouseIds.push(wh.id, wh2.id, whPassive.id);

  const yarn = await prisma.item.create({
    data: { code: `${TAG}-IP`, name: `${TAG} İplik`, itemType: ItemType.YARN, unit: ItemUnit.KG },
    select: { id: true },
  });
  const yarn2 = await prisma.item.create({
    data: { code: `${TAG}-IP2`, name: `${TAG} İplik 2`, itemType: ItemType.YARN, unit: ItemUnit.KG },
    select: { id: true },
  });
  const yarnPassive = await prisma.item.create({
    data: { code: `${TAG}-IPP`, name: `${TAG} İplik Pasif`, itemType: ItemType.YARN, unit: ItemUnit.KG, isActive: false },
    select: { id: true },
  });
  const fabric = await prisma.item.create({
    data: { code: `${TAG}-KM`, name: `${TAG} Kumaş`, itemType: ItemType.FABRIC, unit: ItemUnit.MT },
    select: { id: true },
  });
  itemIds.push(yarn.id, yarn2.id, yarnPassive.id, fabric.id);

  // ── §1 TEMEL DEFTER + MUTABAKAT ───────────────────────────────────────────
  await yarnService.createMovement({ itemId: yarn.id, warehouseId: wh.id, kind: YarnMovementKind.IN, qtyKg: 100 });
  check("1a) IN 100 → bakiye 100", (await balanceOf(yarn.id, wh.id)).equals(100), (await balanceOf(yarn.id, wh.id)).toString());

  await yarnService.createMovement({ itemId: yarn.id, warehouseId: wh.id, kind: YarnMovementKind.OUT, qtyKg: 30 });
  check("1b) OUT 30 → bakiye 70", (await balanceOf(yarn.id, wh.id)).equals(70), (await balanceOf(yarn.id, wh.id)).toString());

  await yarnService.createMovement({ itemId: yarn.id, warehouseId: wh.id, kind: YarnMovementKind.ADJUST_IN, qtyKg: 5.5 });
  await yarnService.createMovement({ itemId: yarn.id, warehouseId: wh.id, kind: YarnMovementKind.ADJUST_OUT, qtyKg: 0.5 });
  const bal1 = await balanceOf(yarn.id, wh.id);
  check("1c) ADJUST_IN 5.5 / ADJUST_OUT 0.5 → bakiye 75", bal1.equals(75), bal1.toString());

  const sum1 = await ledgerSum(yarn.id, wh.id);
  check("1d) ⭐ MUTABAKAT: bakiye = Σ(işaretli hareket)", bal1.equals(sum1), `bakiye=${bal1.toString()} Σ=${sum1.toString()}`);

  // Depo AYRIMI: aynı kalem başka depoda ayrı satır — bakiyeler karışmaz.
  await yarnService.createMovement({ itemId: yarn.id, warehouseId: wh2.id, kind: YarnMovementKind.IN, qtyKg: 40 });
  const balOther = await balanceOf(yarn.id, wh2.id);
  check(
    "1e) Aynı kalem ikinci depoda AYRI bakiye tutar",
    balOther.equals(40) && (await balanceOf(yarn.id, wh.id)).equals(75),
    `depo2=${balOther.toString()}`,
  );

  // ── §2 ⭐ NEGATİF BAKİYE GERÇEKTEN YAZILIR ────────────────────────────────
  // Bakiye HİÇ olmayan kalem/depo çiftinden çıkış: sayım girilmeden çıkış
  // yapılmışsa envanter GERÇEKTEN eksidir ve görünmelidir.
  const negRes = await yarnService.createMovement({
    itemId: yarn2.id,
    warehouseId: wh.id,
    kind: YarnMovementKind.OUT,
    qtyKg: 500,
  });
  const negBal = await balanceOf(yarn2.id, wh.id);
  check("2a) ⭐ Bakiyesiz kalemden ÇIKIŞ REDDEDİLMEDİ", negRes.success === true);
  check("2b) ⭐ Bakiye DB'de gerçekten EKSİ (sıfıra kırpılmadı)", negBal.equals(-500), negBal.toString());
  check("2c) Uyarı mesajı eksi bakiyeyi SÖYLÜYOR", (negRes.message ?? "").includes("EKSİDE"), (negRes.message ?? "").slice(0, 80));
  check("2d) Yanıt `negative` bayrağı taşıyor", negRes.data.negative === true);
  check("2e) Eksi bakiyede de mutabakat tutuyor", negBal.equals(await ledgerSum(yarn2.id, wh.id)));

  // ── §3 ⭐ EŞZAMANLILIK ───────────────────────────────────────────────────
  // ⚠️ `Promise.all` burada MEŞRUDUR: perf kuralı 11 TEK tx client'ını paylaşan
  // çağrılara ilişkindir; burada N ayrı üst düzey transaction var ve testin
  // ölçtüğü şey tam olarak onların yarışıdır (emsal: test_kk1_duplicate_guard).
  const PARALEL = 8;
  const concItem = await prisma.item.create({
    data: { code: `${TAG}-IPC`, name: `${TAG} İplik Eşzamanlı`, itemType: ItemType.YARN, unit: ItemUnit.KG },
    select: { id: true },
  });
  itemIds.push(concItem.id);
  const results = await Promise.allSettled(
    Array.from({ length: PARALEL }, () =>
      yarnService.createMovement({ itemId: concItem.id, warehouseId: wh.id, kind: YarnMovementKind.IN, qtyKg: 10 }),
    ),
  );
  const okCount = results.filter((r) => r.status === "fulfilled").length;
  const concBal = await balanceOf(concItem.id, wh.id);
  const concCount = await prisma.yarnMovement.count({ where: { itemId: concItem.id, warehouseId: wh.id } });
  check(
    `3a) ${PARALEL} paralel hareketin hepsi yazıldı`,
    okCount === PARALEL,
    results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => String(r.reason).slice(0, 60))
      .join(" | "),
  );
  check("3b) ⭐ Eşzamanlı hareketler bakiyeyi DOĞRU topladı (kayıp yok)", concBal.equals(PARALEL * 10), concBal.toString());
  check("3c) Hareket sayısı da tam", concCount === PARALEL, `${concCount}`);
  check("3d) ⭐ Eşzamanlılık sonrası mutabakat", concBal.equals(await ledgerSum(concItem.id, wh.id)));

  // ── §4 DB CHECK — sıfır/negatif miktar ───────────────────────────────────
  // Uygulama guard'ı silinse bile ikinci hat duruyor mu? Ham INSERT ile ölçülür
  // (servis üzerinden geçmek yalnız uygulama guard'ını ölçerdi).
  for (const [label, bad] of [
    ["4a) DB CHECK sıfır miktarı reddediyor", "0"],
    ["4b) DB CHECK negatif miktarı reddediyor", "-5"],
  ] as const) {
    let msg = "";
    try {
      await prisma.$executeRaw`
        INSERT INTO "yarn_movements" ("id", "itemId", "warehouseId", "kind", "qtyKg", "createdAt")
        VALUES (gen_random_uuid(), ${yarn.id}::uuid, ${wh.id}::uuid, 'IN', ${bad}::numeric, now())
      `;
    } catch (e) {
      msg = (e as Error).message;
    }
    check(label, msg.includes("yarn_movements_qty_positive") || msg.includes("23514"), msg.split("\n").pop()?.slice(0, 90) ?? "HATA YOK");
  }

  let zeroMsg = "";
  try {
    await yarnService.createMovement({ itemId: yarn.id, warehouseId: wh.id, kind: YarnMovementKind.OUT, qtyKg: 0 });
  } catch (e) {
    zeroMsg = (e as Error).message;
  }
  check("4c) Servis sıfır miktarı TÜRKÇE mesajla reddediyor", zeroMsg.includes("sıfırdan büyük"), zeroMsg.slice(0, 80));

  // ⚠️ SERBEST METİN MİKTAR — 400 mü 500 mü?
  // Panel input'u metin gönderir ve Türkçe klavyede ondalık ayırıcı VİRGÜLDÜR.
  // Ham `new Prisma.Decimal("12,5")` düz bir `Error` fırlatır (AppError DEĞİL)
  // → middleware onu 500 "Sunucu hatası oluştu." yapar; operatör yanlış yazdığını
  // ASLA öğrenemez. Burada `statusCode` de ölçülür: yalnız mesaja bakmak, hata
  // sınıfı geriye kayarsa (500'e dönerse) bunu göremezdi.
  const expectStatus = async (label: string, fn: () => Promise<unknown>, needle: string): Promise<void> => {
    let msg = "";
    let status: number | undefined;
    try {
      await fn();
    } catch (e) {
      msg = (e as Error).message;
      status = (e as { statusCode?: number }).statusCode;
    }
    check(label, status === 400 && msg.includes(needle), `status=${status ?? "YOK(→500)"} msg=${msg.slice(0, 70)}`);
  };

  await expectStatus(
    "4d) ⭐ Virgüllü miktar 400 + doğru yazımı SÖYLEYEN mesaj (500 değil)",
    () => yarnService.createMovement({ itemId: yarn.id, warehouseId: wh.id, kind: YarnMovementKind.IN, qtyKg: "12,5" }),
    "12.5",
  );
  await expectStatus(
    "4e) Sayı olmayan metin 400 ile reddediliyor",
    () => yarnService.createMovement({ itemId: yarn.id, warehouseId: wh.id, kind: YarnMovementKind.IN, qtyKg: "abc" }),
    "okunamadı",
  );
  await expectStatus(
    "4f) Kolon taşması (Decimal(14,3)) 400 ile reddediliyor — ham PG mesajı sızmıyor",
    () =>
      yarnService.createMovement({ itemId: yarn.id, warehouseId: wh.id, kind: YarnMovementKind.IN, qtyKg: "999999999999999" }),
    "çok büyük",
  );
  check("4g) Reddedilen metin girişleri deftere satır YAZMADI", (await balanceOf(yarn.id, wh.id)).equals(75), (await balanceOf(yarn.id, wh.id)).toString());

  // ── §5 DIŞ REFERANS DOĞRULAMASI ──────────────────────────────────────────
  const expectReject = async (label: string, fn: () => Promise<unknown>, needle: string): Promise<void> => {
    let m = "";
    try {
      await fn();
    } catch (e) {
      m = (e as Error).message;
    }
    check(label, m.includes(needle), m.slice(0, 90) || "HATA ÇIKMADI");
  };

  await expectReject(
    "5a) ⭐ KUMAŞ kalemi iplik defterine yazılamaz (aynı kalem için iki stok rakamı olmaz)",
    () => yarnService.createMovement({ itemId: fabric.id, warehouseId: wh.id, kind: YarnMovementKind.IN, qtyKg: 10 }),
    "iplik kalemi değil",
  );
  await expectReject(
    "5b) Pasif depoya hareket reddedilir",
    () => yarnService.createMovement({ itemId: yarn.id, warehouseId: whPassive.id, kind: YarnMovementKind.IN, qtyKg: 10 }),
    "pasif",
  );
  await expectReject(
    "5c) Pasif kaleme hareket reddedilir",
    () => yarnService.createMovement({ itemId: yarnPassive.id, warehouseId: wh.id, kind: YarnMovementKind.IN, qtyKg: 10 }),
    "pasif",
  );
  await expectReject(
    "5d) Olmayan kalem reddedilir",
    () =>
      yarnService.createMovement({
        itemId: "00000000-0000-4000-8000-000000000000",
        warehouseId: wh.id,
        kind: YarnMovementKind.IN,
        qtyKg: 10,
      }),
    "bulunamadı",
  );

  // ── §6 ⭐ MAL KABUL ENTEGRASYONU ─────────────────────────────────────────
  const grItem = await prisma.item.create({
    data: { code: `${TAG}-IPG`, name: `${TAG} İplik Kabul`, itemType: ItemType.YARN, unit: ItemUnit.KG },
    select: { id: true },
  });
  itemIds.push(grItem.id);

  const mixed = await goodsReceiptService.create({
    warehouseId: wh.id,
    deliveryNoteNo: `${TAG}-IRS`,
    lines: [
      { itemId: fabric.id, initialQty: 120 }, // kumaş → Roll
      { itemId: grItem.id, initialQty: 250 }, // iplik → YarnMovement (kg)
      { itemId: grItem.id, initialQty: 50 },
    ],
  });
  const mixedData = mixed.data as {
    id: string;
    receiptNo: string;
    rolls: Array<{ id: string }>;
    yarnMovements: Array<{ id: string; kind: string; qtyKg: unknown }>;
    totals: { rollCount: number; totalQty: number; yarnLineCount: number; totalYarnKg: number };
    failed: Array<{ reason: string }>;
  };
  receiptIds.push(mixedData.id);

  check("6a) Karışık fişte SADECE kumaş satırı Roll doğurdu", mixedData.rolls.length === 1, `top=${mixedData.rolls.length}`);
  const grMoves = await prisma.yarnMovement.findMany({
    where: { goodsReceiptId: mixedData.id },
    select: { id: true, kind: true, qtyKg: true, itemId: true, warehouseId: true },
  });
  check("6b) ⭐ İki iplik satırı IN hareketi doğurdu", grMoves.length === 2 && grMoves.every((m) => m.kind === YarnMovementKind.IN), `hareket=${grMoves.length}`);
  check("6c) ⭐ İplik satırı Roll DOĞURMADI (çift sayım yok)", mixedData.rolls.length === 1 && grMoves.length === 2);
  check("6d) Hareketler fişin deposunu taşıyor", grMoves.every((m) => m.warehouseId === wh.id));
  const grBal = await balanceOf(grItem.id, wh.id);
  check("6e) ⭐ Bakiye 300 kg oldu", grBal.equals(300), grBal.toString());
  check("6f) Fiş detayı iplik satırlarını GÖSTERİYOR (boş fiş yanılgısı yok)", mixedData.yarnMovements?.length === 2 && mixedData.totals.totalYarnKg === 300, `kg=${mixedData.totals?.totalYarnKg}`);
  check("6g) Mesaj iplik kalemini ayrıca sayıyor", (mixed.message ?? "").includes("iplik kalemi"), (mixed.message ?? "").slice(0, 90));

  // Kumaşa özgü alan taşıyan iplik satırı: SESSİZ düşürülmez, `failed[]`e düşer.
  const strayRes = await goodsReceiptService.addLines(mixedData.id, [
    { itemId: grItem.id, initialQty: 10, width: 150 },
  ]);
  check(
    "6h) ⭐ İplik satırındaki kumaş alanı (en) SESSİZCE yutulmadı",
    strayRes.failed.length === 1 && strayRes.failed[0]!.reason.includes("taşıyamaz"),
    strayRes.failed[0]?.reason.slice(0, 80),
  );
  const priceRes = await goodsReceiptService.addLines(mixedData.id, [
    { itemId: grItem.id, initialQty: 10, unitPrice: 42 },
  ]);
  check(
    "6i) İplik satırındaki birim fiyat sebebiyle reddedildi (sessizce düşürülmedi)",
    priceRes.failed.length === 1 && priceRes.failed[0]!.reason.includes("birim fiyat"),
    priceRes.failed[0]?.reason.slice(0, 80),
  );
  check("6j) Reddedilen satırlar bakiyeye DOKUNMADI", (await balanceOf(grItem.id, wh.id)).equals(300));

  // ⚠️ PASİF KALEM — İKİ KAPI AYNI CEVABI VERMELİ (2026-08-14 denetimi).
  // Kumaş yolunda `createInitialEntry` pasif kalemi reddediyor ve
  // `POST /api/yarn/movements` de reddediyor; mal kabulün iplik dalı ise
  // ATLIYORDU (ölçüldü: hareket=1, failed=[]). Aynı kalem bir kapıdan
  // reddedilip diğerinden sessizce deftere giriyorsa, "bu kalem kullanımdan
  // kaldırıldı" kararı fiilen uygulanmıyor demektir.
  const passiveRes = await goodsReceiptService.addLines(mixedData.id, [{ itemId: yarnPassive.id, initialQty: 40 }]);
  const passiveMoves = await prisma.yarnMovement.count({ where: { itemId: yarnPassive.id } });
  check(
    "6j2) ⭐ PASİF iplik kalemi mal kabulden GEÇMİYOR (kumaş yoluyla aynı sertlik)",
    passiveRes.createdYarn.length === 0 && passiveRes.failed.length === 1 && passiveRes.failed[0]!.reason.includes("pasif"),
    passiveRes.failed[0]?.reason.slice(0, 70) ?? `yazılan=${passiveRes.createdYarn.length}`,
  );
  check("6j3) ⭐ Pasif kalem deftere HİÇ satır yazmadı", passiveMoves === 0, `${passiveMoves}`);

  // İPTAL → ters kayıt
  const cancelRes = await goodsReceiptService.cancel(mixedData.id, `${TAG} iptal`);
  const afterCancelBal = await balanceOf(grItem.id, wh.id);
  const reverseMoves = await prisma.yarnMovement.findMany({
    where: { goodsReceiptId: mixedData.id, kind: YarnMovementKind.ADJUST_OUT },
    select: { qtyKg: true },
  });
  check("6k) ⭐ İptal TERS KAYIT yazdı (satır silinmedi)", reverseMoves.length === 1 && D(reverseMoves[0]!.qtyKg).equals(300), `ters=${reverseMoves.length}`);
  check("6l) ⭐ İptal sonrası bakiye başa döndü", afterCancelBal.equals(0), afterCancelBal.toString());
  check("6m) İptal sonrası mutabakat", afterCancelBal.equals(await ledgerSum(grItem.id, wh.id)));
  check("6n) Orijinal IN satırları HÂLÂ duruyor (defter append-only)", (await prisma.yarnMovement.count({ where: { goodsReceiptId: mixedData.id, kind: YarnMovementKind.IN } })) === 2);
  check("6o) İptal mesajı iplik tersini söylüyor", (cancelRes.message ?? "").includes("iplik kalemi"), (cancelRes.message ?? "").slice(0, 120));

  // İptal İDEMPOTENT — İKİ KATMAN, ikisi de ölçülür.
  const moveCountBefore = await prisma.yarnMovement.count({ where: { goodsReceiptId: mixedData.id } });
  await goodsReceiptService.cancel(mixedData.id, `${TAG} tekrar`);
  const moveCountAfter = await prisma.yarnMovement.count({ where: { goodsReceiptId: mixedData.id } });
  check("6p) İkinci iptal çağrısı EK hareket yazmadı (fiş statü kapısı)", moveCountBefore === moveCountAfter, `${moveCountBefore} → ${moveCountAfter}`);
  check("6q) İkinci iptalden sonra bakiye hâlâ 0", (await balanceOf(grItem.id, wh.id)).equals(0));

  // ⚠️ 6p KÖRDÜ ve bu satır onun için var (2026-08-14 denetimi).
  // `cancel()` ikinci çağrıda `status === CANCELLED` görüp ERKEN DÖNER, yani
  // ters kayıt fonksiyonuna HİÇ ULAŞMAZ: `reverseGoodsReceiptYarnTx`'in
  // net-sıfır guard'ı silinse bile 6p yeşil kalıyordu (ölçüldü — 52/0).
  // Oysa idempotentlik o fonksiyonun İLAN EDİLMİŞ özelliğidir ve onu doğrudan
  // çağıran ikinci bir yüzey (onarım script'i, fatura iptali, yeniden deneme)
  // yarın doğabilir. Bu yüzden fonksiyon DOĞRUDAN, ikinci kez çağrılır.
  // ⚠️ İstisna da BAŞARISIZLIKTIR, çökme değil: net-sıfır guard'ı düşünce
  // fonksiyon `qtyKg=0` ile `applyYarnMovementTx`'e girip fırlatıyor. Sarmadan
  // bırakılırsa `main()` abort olur ve KALAN ~15 kontrol hiç koşmaz — bekçi
  // "44 geçti, 1 başarısız" gibi okunamayan bir sonuç basar. Kırmızı, hangi
  // kuralın düştüğünü SÖYLEYEREK verilmeli.
  let directCount = -1;
  let directErr = "";
  try {
    directCount = (await prisma.$transaction((tx) => reverseGoodsReceiptYarnTx(tx, mixedData.id, `${TAG} doğrudan tekrar`))).length;
  } catch (e) {
    directErr = (e as Error).message;
  }
  const moveCountDirect = await prisma.yarnMovement.count({ where: { goodsReceiptId: mixedData.id } });
  check(
    "6p2) ⭐ Ters kayıt fonksiyonu DOĞRUDAN tekrar çağrıldığında satır YAZMIYOR (net=0 → idempotent)",
    directErr === "" && directCount === 0 && moveCountDirect === moveCountAfter,
    directErr ? `FIRLATTI: ${directErr.slice(0, 70)}` : `yazılan=${directCount} hareket ${moveCountAfter} → ${moveCountDirect}`,
  );
  check("6p3) ⭐ Doğrudan tekrar sonrası bakiye HÂLÂ 0 (mal iki kez düşülmedi)", (await balanceOf(grItem.id, wh.id)).equals(0), (await balanceOf(grItem.id, wh.id)).toString());

  // REGRESYON: KUMAŞ-ONLY fiş — iplik yolu hiç devreye girmemeli.
  const fabricOnly = await goodsReceiptService.create({ warehouseId: wh.id, lines: [{ itemId: fabric.id, initialQty: 77 }] });
  const fabricOnlyData = fabricOnly.data as { id: string; rolls: Array<{ id: string }> };
  receiptIds.push(fabricOnlyData.id);
  check("6r) Kumaş-only fiş: mesaj eskisiyle birebir (iplik ibaresi YOK)", !(fabricOnly.message ?? "").includes("iplik"), (fabricOnly.message ?? "").slice(0, 80));
  await goodsReceiptService.cancel(fabricOnlyData.id, `${TAG} kumaş iptali`);
  const strayYarn = await prisma.yarnMovement.count({ where: { goodsReceiptId: fabricOnlyData.id } });
  check("6s) ⭐ Kumaş-only fiş İPTALİ hiç iplik hareketi doğurmadı", strayYarn === 0, `${strayYarn}`);
  const fabricRollCancelled = await prisma.roll.count({
    where: { goodsReceiptId: fabricOnlyData.id, status: RollStatus.CANCELLED },
  });
  const fabricReceipt = await prisma.goodsReceipt.findUnique({ where: { id: fabricOnlyData.id }, select: { status: true } });
  check(
    "6t) Kumaş yolu bozulmadı: fiş CANCELLED + topu iptal edildi",
    fabricReceipt?.status === GoodsReceiptStatus.CANCELLED && fabricRollCancelled === 1,
    `top=${fabricRollCancelled}`,
  );

  // ── §7 LİSTE YÜZEYLERİ ───────────────────────────────────────────────────
  const stocks = await yarnService.listStocks({ warehouseId: wh.id, onlyNonZero: true, pageSize: 200 });
  const zeroRow = stocks.data.find((s) => s.item.id === grItem.id);
  check("7a) onlyNonZero sıfır bakiyeli satırı gizliyor", zeroRow === undefined);
  const allStocks = await yarnService.listStocks({ warehouseId: wh.id, pageSize: 200 });
  check("7b) Filtresiz listede sıfır bakiyeli satır GÖRÜNÜYOR", allStocks.data.some((s) => s.item.id === grItem.id));
  check("7c) Toplam FİLTRENİN toplamı (sayfanın değil)", D(allStocks.totals.balanceKg).equals(75 - 500 + 80 + 0), allStocks.totals.balanceKg);

  const page1 = await yarnService.listMovements({ itemId: yarn.id, warehouseId: wh.id, limit: 2 });
  check("7d) Cursor sayfası limit kadar satır döndü", page1.data.length === 2, `${page1.data.length}`);
  check("7e) Devamı varsa nextCursor doldu", typeof page1.nextCursor === "string" && page1.nextCursor.length > 0);
  const page2 = await yarnService.listMovements({ itemId: yarn.id, warehouseId: wh.id, limit: 2, cursor: page1.nextCursor ?? undefined });
  const ids1 = new Set((page1.data as Array<{ id: string }>).map((r) => r.id));
  const overlap = (page2.data as Array<{ id: string }>).filter((r) => ids1.has(r.id));
  check("7f) ⭐ İkinci sayfa birinciyle ÇAKIŞMIYOR (cursor tutarlı)", overlap.length === 0, `çakışan=${overlap.length}`);

  const outOnly = await yarnService.listMovements({ itemId: yarn.id, warehouseId: wh.id, kind: YarnMovementKind.OUT });
  check("7g) kind filtresi süzüyor", outOnly.data.length === 1, `${outOnly.data.length}`);

  // ── §8 KÖRLÜK ZEMİNİ ─────────────────────────────────────────────────────
  // "Hiç satır bulunamadı" ile "ihlal yok" aynı yeşile ÇIKMASIN: aşağıdaki
  // alt sınırlar düşerse yukarıdaki mutabakat kontrolleri boş kümeyi ölçüyor
  // demektir ve hepsi vakumen yeşil kalırdı.
  const totalMoves = await prisma.yarnMovement.count({ where: { itemId: { in: itemIds } } });
  const totalStocks = await prisma.yarnStock.count({ where: { itemId: { in: itemIds } } });
  const totalAbs = (
    await prisma.yarnMovement.aggregate({ where: { itemId: { in: itemIds } }, _sum: { qtyKg: true } })
  )._sum.qtyKg;
  check("8a) Körlük zemini: en az 15 hareket üretildi", totalMoves >= 15, `${totalMoves}`);
  check("8b) Körlük zemini: en az 4 stok satırı (kalem × depo) doğdu", totalStocks >= 4, `${totalStocks}`);
  check("8c) Körlük zemini: ölçülen hacim sıfır değil", D(totalAbs ?? 0).gt(0), `${totalAbs?.toString() ?? "0"} kg`);
  check("8d) Körlük zemini: en az 2 fiş üretildi", receiptIds.length >= 2, `${receiptIds.length}`);

  // ── §9 ⭐ ROTA KAPISI — KAYNAK TARAMASI ──────────────────────────────────
  // ⚠️ NEDEN BURADA: `test_finance_flag_off.ts` §4 aynı taramayı yapıyor ama
  // SABİT YOLLA yalnız `finance.routes.ts`'i okuyor — yeni ticaret router'ları
  // onun kapsamına GİRMİYOR. `test_route_auth_coverage.ts` ise CANLI Express
  // yığınını yürüyor, yani router MOUNT EDİLENE KADAR bu uçları hiç görmüyor.
  // İkisinin arasında kalan boşluk tam olarak "yazıldı, kapısı var mı kimse
  // ölçmedi" boşluğudur ve fabrikanın sıfır-fark garantisi oradan sızar.
  const routeSrc = readFileSync(join(__dirname, "..", "src", "routes", "yarn.routes.ts"), "utf8");
  const routeLines = routeSrc.split("\n");
  const gateIdx = routeLines.findIndex((l) => /router\.use\(\s*verifyToken\s*,\s*requireFinanceEnabled\s*\)/.test(l));
  const endpointIdx = routeLines
    .map((l, i) => (/^\s*router\.(get|post|patch|put|delete)\(/.test(l) ? i : -1))
    .filter((i) => i >= 0);

  check("9a) Router seviyesinde rejim kapısı var", gateIdx >= 0, gateIdx >= 0 ? `satır ${gateIdx + 1}` : "YOK");
  check("9b) KÖRLÜK ZEMİNİ: taramada uç bulundu", endpointIdx.length >= 3, `uç=${endpointIdx.length}`);
  // ⚠️ SIRA LOAD-BEARING: Express middleware'i KAYIT SIRASINA göre uygular.
  // `router.use`tan ÖNCE tanımlanan bir uç kapıyı HİÇ görmez — ve bu, hata da
  // log da üretmeyen bir sızıntıdır: uç çalışır, yalnız bayrak kapalıyken de
  // çalışır. Yeni uç dosyanın başına eklenirse tam bu olur.
  check(
    "9c) ⭐ HER uç rejim kapısından SONRA tanımlı (sıra load-bearing)",
    gateIdx >= 0 && endpointIdx.every((i) => i > gateIdx),
    `kapı=${gateIdx + 1} ilk uç=${(endpointIdx[0] ?? -1) + 1}`,
  );
  const guardless = endpointIdx.filter((i) => !/requirePermission\(/.test(routeLines[i]!));
  check(
    "9d) Her uç ayrıca izin guard'ı taşıyor (bayrak 'kurulum', izin 'kişi')",
    guardless.length === 0,
    guardless.map((i) => routeLines[i]!.trim().slice(0, 46)).join(" | ") || "guard'sız uç yok",
  );
  // ⚠️ UYDURMA İZİN KODU KATALOGDA OLMAZ → Admin dışı HERKES 403 alır ve sebep
  // ekranda yazmaz. Kod bir yazım hatasıyla ("warehouse:reed") sessizce ölür.
  const ALLOWED_CODES = new Set(["warehouse:read", "yarn:write"]);
  const usedCodes = [...routeSrc.matchAll(/requirePermission\("([^"]+)"\)/g)].map((m) => m[1]!);
  const unknown = usedCodes.filter((c) => !ALLOWED_CODES.has(c));
  check(
    "9e) ⭐ Kullanılan izin kodları sabit listeyle birebir (uydurma kod yok)",
    usedCodes.length === endpointIdx.length && unknown.length === 0,
    unknown.length > 0 ? `TANINMAYAN: ${unknown.join(", ")}` : usedCodes.join(", "),
  );
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    try {
      const rolls = await prisma.roll.findMany({ where: { goodsReceiptId: { in: receiptIds } }, select: { id: true } });
      const rollIds = rolls.map((r) => r.id);
      if (rollIds.length) {
        // ⚠️ `RollVariance` FK'sı RESTRICT — silinmezse top silinemez ve temizlik
        // sessizce yarım kalır (fixture artığı dev DB'sinde birikir).
        await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      }
      await prisma.yarnMovement.deleteMany({ where: { itemId: { in: itemIds } } });
      await prisma.yarnStock.deleteMany({ where: { itemId: { in: itemIds } } });
      if (receiptIds.length) {
        await prisma.printedDocument.deleteMany({ where: { sourceId: { in: receiptIds } } });
        await prisma.goodsReceipt.deleteMany({ where: { id: { in: receiptIds } } });
      }
      await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
    } catch (e) {
      console.warn("Temizlik uyarısı:", (e as Error).message.slice(0, 300));
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
