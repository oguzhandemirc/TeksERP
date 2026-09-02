// =============================================================================
// BEKÇİ — KALEM FİYATI: kart varsayılanı + müşteri istisnası (Paket D · D2)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_item_price.ts
//
// NEDEN: Fiyat, faturanın TUTARINI belirleyen tek girdidir ve buradaki her hata
// SESSİZDİR — yanlış fiyat bir istisna fırlatmaz, yalnız yanlış para tahsil
// edilir. Üç sessiz arıza sınıfı ölçülüyor:
//
//   ① ÇÖZÜM SIRASI KAYARSA: müşteriye özel anlaşmalı fiyat yerine liste fiyatı
//      (ya da tersi) uygulanır. Kimse fark etmez; müşteri fark eder.
//   ② "FİYAT YOK" SIFIRA DÖNÜŞÜRSE: `null` ("bilinmiyor") ile `0` ("bedava")
//      arasındaki fark yok olur ve fatura sıfır tutarla onaylanabilir hale
//      gelir — `InvoiceService.confirm`in sıfır-fiyat seddi tam da bu yüzden
//      var, buradan sıfır uydurmak o seddi anlamsızlaştırır.
//   ③ İKİ PARTIAL UNIQUE ÇALIŞMAZSA: aynı kaleme İKİ "kart varsayılanı" doğar
//      (Postgres NULL'ları eşit saymaz!) ve hangisinin uygulandığı sorusunun
//      cevabı YOKTUR — fatura bazen biriyle bazen diğeriyle açılır.
//
// ÖLÇÜLENLER:
//   §0 KÖRLÜK ZEMİNİ — fixture gerçekten kuruldu mu (yoksa her şey vakumen yeşil)
//   §1 Çözüm sırası: müşteri istisnası > kart varsayılanı > null
//   §2 İki partial unique GERÇEKTEN çakışmayı engelliyor + farklı müşteriye
//      ikinci istisna serbest + upsert ikinci satır DOĞURMUYOR
//   §3 Negatif fiyat: serviste 400, DB CHECK'inde de red (servisi atlayan yol)
//      · SIFIR fiyat MEŞRU ve `null`dan ayırt edilebiliyor
//   §4 ⭐ PRISMA COMPOUND UNIQUE TUZAĞI — bu servisin var oluş sebebi
//   §5 Silme: istisna kalkınca varsayılana dönülüyor, varsayılan da kalkınca null
//   §6 Dış referans doğrulaması (yok / pasif kalem / pasif cari)
//   §7 Rejim kapısı + izin kodları + yol sırası (kaynak taraması)
//   §8 Tüketici ÖN-DOLUMU: mal kabul + alış faturası taslağı; ve ÖN-DOLUM EZMEZ
//   §9 Liste yüzeyi: `filter[customerId]=null`, CSV id, Türkçe arama, sıra
// =============================================================================
import { ItemType, PriceKind, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import {
  itemPriceService,
  resolveItemPrice,
  resolveItemPricesFor,
} from "../src/services/item-price.service";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import { invoiceService } from "../src/services/invoice.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";

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

async function expectError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return (e as Error).message || "(mesajsız hata)";
  }
}

/**
 * Kaynak taramasından ÖNCE yorumları söker.
 *
 * ⚠️ Naif ama bu dosya için yeterli: taranan route dosyasında `//` içeren string
 * literali YOK (URL yok). Yeni bir dosyayı taramaya başlarsan bu varsayımı
 * doğrula — aksi halde string ortadan kesilir ve tarama sessizce eksik ölçer.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const TAG = `TEST-IP-${Date.now()}`;
const itemIds: string[] = [];
const customerIds: string[] = [];
const receiptIds: string[] = [];
const invoiceIds: string[] = [];
const cariIds: string[] = [];

/** Ham INSERT — servisi ATLAYAN yol (DB seddi gerçekten var mı ölçmek için). */
async function rawInsert(
  itemId: string,
  customerId: string | null,
  kind: PriceKind,
  currency: string,
  price: string,
): Promise<string> {
  return expectError(async () => {
    if (customerId) {
      await prisma.$executeRaw`
        -- tz-ok: createdAt/updatedAt timestamptz (migration 20260814072115).
        INSERT INTO "item_prices" ("id","itemId","customerId","kind","currency","price","createdAt","updatedAt")
        VALUES (${randomUUID()}::uuid, ${itemId}::uuid, ${customerId}::uuid,
                ${kind}::text::"PriceKind", ${currency}::text::"Currency", ${price}::numeric, now(), now())`;
    } else {
      await prisma.$executeRaw`
        -- tz-ok: createdAt/updatedAt timestamptz (migration 20260814072115).
        INSERT INTO "item_prices" ("id","itemId","customerId","kind","currency","price","createdAt","updatedAt")
        VALUES (${randomUUID()}::uuid, ${itemId}::uuid, NULL,
                ${kind}::text::"PriceKind", ${currency}::text::"Currency", ${price}::numeric, now(), now())`;
    }
  });
}

async function main(): Promise<void> {
  console.log("=== Kalem fiyatı bekçisi ===\n");

  // ── FİXTURE — testin KENDİSİ yaratır (ortamdaki veriye bağımlı olma) ──────
  const item = await prisma.item.create({
    // ⚠️ Ad BÜYÜK ve Türkçe karakterli: §9f'nin ölçtüğü şey tam olarak
    // "küçük harfle aranan Türkçe terim BÜYÜK saklanan adı buluyor mu"dur —
    // düz ILIKE (C-locale) `ş`/`ı` çiftlerini KATLAMAZ ve liste sessizce boş
    // dönerdi. Adı ASCII yapmak bu kontrolü vakumen yeşile çevirir.
    data: { code: `${TAG}-K1`, name: `${TAG} ŞIK KUMAŞ`, itemType: ItemType.FABRIC },
    select: { id: true },
  });
  itemIds.push(item.id);
  const itemNoPrice = await prisma.item.create({
    data: { code: `${TAG}-K2`, name: `${TAG} Fiyatsız Kumaş`, itemType: ItemType.FABRIC },
    select: { id: true },
  });
  itemIds.push(itemNoPrice.id);
  const passiveItem = await prisma.item.create({
    data: { code: `${TAG}-K3`, name: `${TAG} Pasif Kumaş`, itemType: ItemType.FABRIC, isActive: false },
    select: { id: true },
  });
  itemIds.push(passiveItem.id);

  const c1 = await prisma.customer.create({
    data: { code: `${TAG}-C1`, name: `${TAG} Müşteri 1`, type: "SUPPLIER" },
    select: { id: true },
  });
  const c2 = await prisma.customer.create({
    data: { code: `${TAG}-C2`, name: `${TAG} Müşteri 2`, type: "SUPPLIER" },
    select: { id: true },
  });
  const cPassive = await prisma.customer.create({
    data: { code: `${TAG}-C3`, name: `${TAG} Pasif Cari`, type: "SUPPLIER", isActive: false },
    select: { id: true },
  });
  customerIds.push(c1.id, c2.id, cPassive.id);

  // ── §0 KÖRLÜK ZEMİNİ ─────────────────────────────────────────────────────
  // "Hiç satır bulunamadı" ile "ihlal yok" AYNI yeşile çıkmamalı: aşağıdaki
  // bölümlerin çoğu boş bir fixture'da da geçerdi (her sorgu null döner ve
  // "null bekliyordum" kontrolleri yeşil kalır).
  check("§0a Fixture kuruldu (3 kalem + 3 cari)", itemIds.length === 3 && customerIds.length === 3);
  const startRows = await prisma.itemPrice.count({ where: { itemId: { in: itemIds } } });
  check("§0b Başlangıçta bu kalemlerin HİÇ fiyat satırı yok", startRows === 0, `satır=${startRows}`);

  // ── §1 ÇÖZÜM SIRASI ──────────────────────────────────────────────────────
  const none = await resolveItemPrice({ itemId: item.id, kind: PriceKind.SALE, currency: "TRY", customerId: c1.id });
  check("§1a Fiyat yokken NULL döner", none === null, `dönen=${JSON.stringify(none)}`);
  // ⭐ Bu satır ②'nin bekçisi: `null` sessizce `0`a çevrilirse burada patlar.
  check(
    "§1a2 ⭐ NULL SIFIRA ÇEVRİLMEDİ (bilinmiyor ≠ bedava)",
    none === null && (none as unknown) !== 0,
  );

  await itemPriceService.upsert({ itemId: item.id, kind: PriceKind.SALE, currency: "TRY", price: 10 });
  const def = await resolveItemPrice({ itemId: item.id, kind: PriceKind.SALE, currency: "TRY", customerId: c1.id });
  check("§1b Kart varsayılanı uygulandı", def?.source === "DEFAULT" && def.price.equals(10), `${def?.source}/${def?.price}`);

  await itemPriceService.upsert({ itemId: item.id, customerId: c1.id, kind: PriceKind.SALE, currency: "TRY", price: 8.5 });
  const exc = await resolveItemPrice({ itemId: item.id, kind: PriceKind.SALE, currency: "TRY", customerId: c1.id });
  check("§1c ⭐ Müşteri istisnası varsayılanı EZER", exc?.source === "CUSTOMER" && exc.price.equals(8.5), `${exc?.source}/${exc?.price}`);

  const other = await resolveItemPrice({ itemId: item.id, kind: PriceKind.SALE, currency: "TRY", customerId: c2.id });
  check("§1d İstisnası olmayan müşteri VARSAYILANI alır", other?.source === "DEFAULT" && other.price.equals(10), `${other?.source}/${other?.price}`);

  const bare = await resolveItemPrice({ itemId: item.id, kind: PriceKind.SALE, currency: "TRY" });
  check("§1e Müşterisiz çözüm VARSAYILANI alır (istisna sızmaz)", bare?.source === "DEFAULT" && bare.price.equals(10));

  // ⭐ SIZINTI TESTİ — varsayılanı OLMAYAN, yalnız c1 istisnası olan kalem.
  // c2 için doğru cevap NULL'dır: başka müşterinin anlaşmalı fiyatını ona
  // uygulamak, gizli bir indirimi yanlış cariye taşımaktır.
  // ⚠️ Bu iki KATMANLA korunuyor (sorgu süzgeci + `pickPrice` kimlik eşleşmesi)
  // ve ikisi birbirini maskeler: TEK katmanı bozan bir sonda YEŞİL kalır ve bu
  // bir kusur DEĞİL, bilinçli derinlik savunmasıdır. Kırmızı görmek için ikisini
  // birden körleştir (2026-08-14'te ölçüldü).
  await itemPriceService.upsert({ itemId: itemNoPrice.id, customerId: c1.id, kind: PriceKind.SALE, currency: "EUR", price: 6 });
  const leak = await resolveItemPrice({ itemId: itemNoPrice.id, kind: PriceKind.SALE, currency: "EUR", customerId: c2.id });
  check("§1e2 ⭐ Başka müşterinin istisnası SIZMIYOR (varsayılan yoksa null)", leak === null, `dönen=${JSON.stringify(leak)}`);

  const wrongKind = await resolveItemPrice({ itemId: item.id, kind: PriceKind.PURCHASE, currency: "TRY", customerId: c1.id });
  check("§1f Yön (PURCHASE/SALE) karışmıyor", wrongKind === null);
  const wrongCur = await resolveItemPrice({ itemId: item.id, kind: PriceKind.SALE, currency: "USD", customerId: c1.id });
  check("§1g Para birimi karışmıyor", wrongCur === null);

  // TEK KAYNAK kanıtı: toplu çözümleyici tekil ile BİREBİR aynı cevabı verir.
  // Ayrışırlarsa "panelde 8,5 görünüyor, faturaya 10 giriyor" sınıfı doğar.
  const bulk = await resolveItemPricesFor({
    itemIds: [item.id, itemNoPrice.id],
    kind: PriceKind.SALE,
    currency: "TRY",
    customerId: c1.id,
  });
  check(
    "§1h Toplu çözümleyici tekil ile AYNI (tek kaynak)",
    bulk.get(item.id)?.price.equals(8.5) === true && bulk.get(item.id)?.source === "CUSTOMER",
  );
  check("§1i Fiyatsız kalem haritada HİÇ YER ALMAZ (0 ile doldurulmaz)", !bulk.has(itemNoPrice.id));

  // ── §2 PARTIAL UNIQUE ────────────────────────────────────────────────────
  const dupDefault = await rawInsert(item.id, null, PriceKind.SALE, "TRY", "99");
  check(
    "§2a ⭐ İKİNCİ kart varsayılanı REDDEDİLDİ (NULL'lar çakışmaz sanılırsa buradan sızardı)",
    /item_price_default_uq|duplicate key|unique/i.test(dupDefault),
    dupDefault.slice(0, 80),
  );

  const dupCustomer = await rawInsert(item.id, c1.id, PriceKind.SALE, "TRY", "99");
  check(
    "§2b İKİNCİ müşteri istisnası (aynı müşteri) REDDEDİLDİ",
    /item_price_customer_uq|duplicate key|unique/i.test(dupCustomer),
    dupCustomer.slice(0, 80),
  );

  const secondCustomer = await itemPriceService.upsert({
    itemId: item.id,
    customerId: c2.id,
    kind: PriceKind.SALE,
    currency: "TRY",
    price: 9,
  });
  check("§2c FARKLI müşteriye ikinci istisna SERBEST (kısıt aşırı sıkı değil)", secondCustomer.data.created === true);

  const again = await itemPriceService.upsert({ itemId: item.id, kind: PriceKind.SALE, currency: "TRY", price: 11 });
  check("§2d Aynı anahtarla ikinci yazım GÜNCELLER (created=false)", again.data.created === false);
  const defaultRows = await prisma.itemPrice.count({
    where: { itemId: item.id, customerId: null, kind: PriceKind.SALE, currency: "TRY" },
  });
  check("§2e Varsayılan satır sayısı hâlâ 1 (upsert ikinci satır doğurmadı)", defaultRows === 1, `satır=${defaultRows}`);
  const afterUpdate = await resolveItemPrice({ itemId: item.id, kind: PriceKind.SALE, currency: "TRY", customerId: cPassive.id });
  check("§2f Güncellenen fiyat okunuyor", afterUpdate?.price.equals(11) === true, `${afterUpdate?.price}`);

  // Audit: güncelleme CREATE olarak yazılmamalı (xmax kararı doğru mu).
  const auditRows = await prisma.systemLog.findMany({
    where: { tableName: "ITEM_PRICE", recordId: afterUpdate?.id ?? "" },
    select: { action: true },
    orderBy: { createdAt: "asc" },
  });
  check(
    "§2g Audit: ilk yazım CREATE, ikincisi UPDATE",
    auditRows.length >= 2 && auditRows[0]?.action === "CREATE" && auditRows[auditRows.length - 1]?.action === "UPDATE",
    auditRows.map((a) => a.action).join(","),
  );

  // ── §3 NEGATİF / SIFIR FİYAT ─────────────────────────────────────────────
  const negErr = await expectError(() =>
    itemPriceService.upsert({ itemId: item.id, kind: PriceKind.PURCHASE, currency: "TRY", price: -1 }),
  );
  check("§3a Servis negatif fiyatı REDDETTİ", /negatif/i.test(negErr), negErr.slice(0, 60));

  const negRaw = await rawInsert(itemNoPrice.id, null, PriceKind.PURCHASE, "TRY", "-1");
  check(
    "§3b ⭐ DB CHECK de reddediyor (servisi atlayan yol açık kalmasın)",
    /item_prices_price_nonneg|violates check/i.test(negRaw),
    negRaw.slice(0, 80),
  );

  await itemPriceService.upsert({ itemId: item.id, kind: PriceKind.PURCHASE, currency: "TRY", price: 0 });
  const zero = await resolveItemPrice({ itemId: item.id, kind: PriceKind.PURCHASE, currency: "TRY" });
  check("§3c SIFIR fiyat MEŞRU (promosyon/numune) ve saklandı", zero !== null && zero.price.equals(0), `${zero?.price}`);
  check("§3d ⭐ SIFIR ile NULL ayırt edilebiliyor", zero !== null && wrongCur === null);

  const bigErr = await expectError(() =>
    itemPriceService.upsert({ itemId: item.id, kind: PriceKind.SALE, currency: "EUR", price: 1e12 }),
  );
  check("§3e Kolon hassasiyetini aşan fiyat anlamlı 400 veriyor", /çok büyük/i.test(bigErr), bigErr.slice(0, 60));

  // ⚠️ SINIRIN "ÇOK BÜYÜK" TARAFI KADAR "SIĞIYOR" TARAFI DA ÖLÇÜLÜR. Guard'ın
  // işi DB'nin `numeric field overflow` mesajını engellemektir; kolonun KABUL
  // ETTİĞİ bir değeri reddederse sahte bir 400 üretir ve kullanıcıya sebebi
  // hiçbir yerde yazmayan bir duvar çıkarır. (İlk yazımda sabit bir hane eksikti
  // — `999999999.9999` — ve bu satır tam o regresyonu kilitler; §3e tek başına
  // yeşil kalıyordu çünkü 1e12 iki sınırın da üstünde.)
  // ⚠️ Hata YUTULMADAN yakalanır ki tek bir regresyon kalan bölümleri (§4-§9)
  // düşürmesin — sonuç yine KIRMIZI, ama bekçi geri kalanı da ölçmeye devam eder.
  const edge = "9999999999.9999"; // Decimal(14,4)'ün gerçek tavanı
  let edgeWritten: Prisma.Decimal | null = null;
  const edgeErr = await expectError(async () => {
    const r = await itemPriceService.upsert({
      itemId: itemNoPrice.id,
      kind: PriceKind.PURCHASE,
      currency: "RUB",
      price: edge,
    });
    edgeWritten = r.data.price;
  });
  check(
    "§3f ⭐ Kolonun KABUL ETTİĞİ tavan değer reddedilmiyor (sahte 400 yok)",
    edgeErr === "" && edgeWritten !== null && (edgeWritten as Prisma.Decimal).equals(new Prisma.Decimal(edge)),
    edgeErr || `${edgeWritten}`,
  );
  const edgeRead = await resolveItemPrice({ itemId: itemNoPrice.id, kind: PriceKind.PURCHASE, currency: "RUB" });
  check("§3g Tavan değer DB'ye kayıpsız yazıldı", edgeRead?.price.equals(new Prisma.Decimal(edge)) === true, `${edgeRead?.price}`);

  // ── §4 ⭐ PRISMA COMPOUND UNIQUE TUZAĞI ──────────────────────────────────
  // `itemId_kind_currency` DB'de PARTIAL'dır (WHERE customerId IS NULL) ama
  // Prisma predicate'i bilmez. Yalnız MÜŞTERİ istisnası olan bir anahtarda
  // `findUnique` onu DÖNER — yani "kart varsayılanı var mı" sorusuna YANLIŞ
  // cevap verir. Servis bu yüzden `customerId`i açıkça yazar ve yazımı ham
  // `ON CONFLICT ... WHERE` ile yapar. Bu bölüm o tuzağın CANLI kanıtıdır.
  await itemPriceService.upsert({ itemId: itemNoPrice.id, customerId: c1.id, kind: PriceKind.SALE, currency: "GBP", price: 7 });
  const trap = await prisma.itemPrice.findUnique({
    where: { itemId_kind_currency: { itemId: itemNoPrice.id, kind: PriceKind.SALE, currency: "GBP" } },
    select: { id: true, customerId: true },
  });
  check(
    "§4a ⭐ Prisma'nın unique lookup'ı MÜŞTERİ satırını eşliyor (tuzak gerçek)",
    trap !== null && trap.customerId !== null,
    `customerId=${trap?.customerId ?? "null"}`,
  );
  const trapSafe = await resolveItemPrice({ itemId: itemNoPrice.id, kind: PriceKind.SALE, currency: "GBP" });
  check(
    "§4b ⭐ Servis AYNI durumda doğru cevabı veriyor: kart varsayılanı YOK → null",
    trapSafe === null,
    `dönen=${JSON.stringify(trapSafe)}`,
  );

  // ── §5 SİLME ─────────────────────────────────────────────────────────────
  const excRow = await prisma.itemPrice.findFirst({
    where: { itemId: item.id, customerId: c1.id, kind: PriceKind.SALE, currency: "TRY" },
    select: { id: true },
  });
  await itemPriceService.remove(excRow?.id ?? "");
  const afterRemoveExc = await resolveItemPrice({ itemId: item.id, kind: PriceKind.SALE, currency: "TRY", customerId: c1.id });
  check(
    "§5a İstisna kalkınca müşteri KART VARSAYILANINA döner",
    afterRemoveExc?.source === "DEFAULT" && afterRemoveExc.price.equals(11),
    `${afterRemoveExc?.source}/${afterRemoveExc?.price}`,
  );

  const defRow = await prisma.itemPrice.findFirst({
    where: { itemId: item.id, customerId: null, kind: PriceKind.SALE, currency: "TRY" },
    select: { id: true },
  });
  await itemPriceService.remove(defRow?.id ?? "");
  const afterRemoveDef = await resolveItemPrice({ itemId: item.id, kind: PriceKind.SALE, currency: "TRY", customerId: c1.id });
  check("§5b Varsayılan da kalkınca NULL (sıfıra düşmez)", afterRemoveDef === null, `dönen=${JSON.stringify(afterRemoveDef)}`);
  const removeMissing = await expectError(() => itemPriceService.remove(randomUUID()));
  check("§5c Olmayan satırın silinmesi 404", /bulunamadı/i.test(removeMissing), removeMissing.slice(0, 60));

  // ── §6 DIŞ REFERANS ──────────────────────────────────────────────────────
  const ghostItem = await expectError(() =>
    itemPriceService.upsert({ itemId: randomUUID(), kind: PriceKind.SALE, currency: "TRY", price: 1 }),
  );
  check("§6a Olmayan kalem REDDEDİLDİ", /kalem bulunamadı/i.test(ghostItem), ghostItem.slice(0, 60));
  const passiveErr = await expectError(() =>
    itemPriceService.upsert({ itemId: passiveItem.id, kind: PriceKind.SALE, currency: "TRY", price: 1 }),
  );
  check("§6b PASİF kalem REDDEDİLDİ", /pasif/i.test(passiveErr), passiveErr.slice(0, 60));
  const passiveCust = await expectError(() =>
    itemPriceService.upsert({ itemId: item.id, customerId: cPassive.id, kind: PriceKind.SALE, currency: "TRY", price: 1 }),
  );
  check("§6c PASİF cari REDDEDİLDİ", /pasif/i.test(passiveCust), passiveCust.slice(0, 60));

  // ── §7 REJİM KAPISI + İZİN + YOL SIRASI (kaynak taraması) ────────────────
  // ⚠️ YORUMLAR SÖKÜLÜR. İlk yazımda sökülmüyordu ve bekçi KÖRDÜ: dosyanın
  // başlık yorumu `router.use(verifyToken, requireFinanceEnabled)` cümlesini
  // ÖRNEK olarak içeriyor, yani kapı koddan silinse bile regex YORUMDA eşleşip
  // yeşil kalıyordu (2026-08-14 negatif sondasıyla ölçüldü). Bir kaynak
  // taraması dokümantasyonu değil KODU ölçmelidir.
  const src = stripComments(readFileSync(join(__dirname, "..", "src", "routes", "item-price.routes.ts"), "utf8"));
  const routeDefs = [...src.matchAll(/router\.(get|post|delete|patch|put)\(\s*"([^"]+)"/g)].map((m) => ({
    method: m[1] as string,
    path: m[2] as string,
    at: m.index ?? 0,
  }));
  // KÖRLÜK ZEMİNİ: regex bozulursa aşağıdaki kontroller "ihlal yok" diye yeşil kalırdı.
  check("§7a Kaynak taraması gerçekten uç buldu (körlük zemini)", routeDefs.length >= 4, `uç=${routeDefs.length}`);
  // ⚠️ 2026-09-02: kapı `requireTicaretEnabled`e taşındı (fiyat listesi MAL
  // tarafıdır, cari defteri değil). Yorum sökme (`stripComments`) hâlâ
  // load-bearing: dosya başlığı kapı satırını ÖRNEK olarak içeriyor.
  check(
    "§7b ⭐ Rejim kapısı router seviyesinde (fabrikada sıfır-fark)",
    /router\.use\(\s*verifyToken\s*,\s*requireTicaretEnabled\s*\)/.test(src),
  );
  // ⚠️ SEGMENT SINIRI "BİR SONRAKİ UÇ"TUR, sabit karakter penceresi DEĞİL.
  // İlk yazımda pencere `r.at + 400` idi ve bekçi KÖRDÜ (2026-08-14 sondasıyla
  // ölçüldü): izinsiz bir uç, izinli bir ucun HEMEN ÖNÜNE yazıldığında pencere
  // KOMŞUNUN `requirePermission`ına taşıyor ve satır yeşil kalıyordu — yani
  // bekçi tam da korumak için var olduğu vakayı (yeni uç eklenirken guard'ın
  // unutulması) göremiyordu. §7d'nin sayaçları o vakayı ancak izin kodu
  // SAYISI değişirse yakalar; guard'ı hiç olmayan uçta sayaç değişmez.
  const segFor = (i: number): string => src.slice(routeDefs[i]!.at, routeDefs[i + 1]?.at ?? src.length);
  check(
    "§7c HER uç requirePermission taşıyor",
    routeDefs.every((_, i) => /requirePermission\(/.test(segFor(i))),
    routeDefs
      .map((r, i) => `${r.method} ${r.path}:${/requirePermission\(/.test(segFor(i)) ? "✓" : "YOK"}`)
      .join(" "),
  );
  check(
    "§7d Okuma `item:read`, yazma `price:write` (uydurma kod yok)",
    (src.match(/requirePermission\("item:read"\)/g) ?? []).length === 2 &&
      (src.match(/requirePermission\("price:write"\)/g) ?? []).length === 2 &&
      !/requirePermission\("price:read"\)/.test(src),
  );
  const resolveAt = routeDefs.findIndex((r) => r.path === "/resolve");
  const idAt = routeDefs.findIndex((r) => r.path.includes(":id"));
  check(
    "§7e `/resolve` `/:id`ten ÖNCE tanımlı (yoksa UUID param'ı gibi eşleşir)",
    resolveAt >= 0 && idAt >= 0 && resolveAt < idAt,
    `resolve=${resolveAt} id=${idAt}`,
  );

  // ── §8 TÜKETİCİ ÖN-DOLUMU ────────────────────────────────────────────────
  const wh = await ensureDefaultWarehouse();
  // Alış fiyatları: kalem kartı 4,00 · c1 istisnası 3,25
  await itemPriceService.upsert({ itemId: item.id, kind: PriceKind.PURCHASE, currency: "USD", price: 4 });
  await itemPriceService.upsert({ itemId: item.id, customerId: c1.id, kind: PriceKind.PURCHASE, currency: "USD", price: 3.25 });

  const rc = await goodsReceiptService.create({
    warehouseId: wh.id,
    supplierId: c1.id,
    currency: "USD",
    lines: [
      // Fiyat GÖNDERİLMEDİ → tedarikçi istisnası (3,25) ön-dolmalı.
      { itemId: item.id, initialQty: 100, clientToken: randomUUID() },
      // Fiyat GÖNDERİLDİ → ASLA EZİLMEMELİ.
      { itemId: item.id, initialQty: 50, unitPrice: 9.99, clientToken: randomUUID() },
      // Fiyatı tanımsız kalem → NULL kalmalı (sıfıra düşmemeli).
      { itemId: itemNoPrice.id, initialQty: 30, clientToken: randomUUID() },
    ],
  });
  const receipt = rc.data as { id: string; receiptNo: string };
  receiptIds.push(receipt.id);

  const rolls = await prisma.roll.findMany({
    where: { goodsReceiptId: receipt.id },
    select: { itemId: true, initialQty: true, purchasePrice: true },
  });
  check("§8a Fişte üç top doğdu (körlük zemini)", rolls.length === 3, `top=${rolls.length}`);
  const prefilled = rolls.find((r) => Number(r.initialQty) === 100);
  check(
    "§8b ⭐ Fiyatsız satıra TEDARİKÇİ İSTİSNASI ön-dolduruldu",
    prefilled?.purchasePrice != null && new Prisma.Decimal(prefilled.purchasePrice).equals(3.25),
    `${prefilled?.purchasePrice}`,
  );
  const explicit = rolls.find((r) => Number(r.initialQty) === 50);
  check(
    "§8c ⭐ ÖN-DOLUM EZMEZ: satırda girilen fiyat korundu",
    explicit?.purchasePrice != null && new Prisma.Decimal(explicit.purchasePrice).equals(9.99),
    `${explicit?.purchasePrice}`,
  );
  const unpriced = rolls.find((r) => r.itemId === itemNoPrice.id);
  check(
    "§8d ⭐ Fiyatı tanımsız kalem NULL kaldı (sıfıra düşmedi)",
    unpriced?.purchasePrice === null,
    `${unpriced?.purchasePrice}`,
  );

  // Alış faturası taslağı: fişte fiyat YOKKEN kart fiyatının satıra taşındığı yol.
  // (Bu fişte fiyat zaten topa yazıldı; ikinci fiş fiyat ön-dolumu KAPALI bir
  // yoldan gelen topu taklit eder — `purchasePrice` elle NULL'lanır.)
  const rc2 = await goodsReceiptService.create({
    warehouseId: wh.id,
    supplierId: c1.id,
    currency: "USD",
    lines: [{ itemId: item.id, initialQty: 200, unitPrice: 5, clientToken: randomUUID() }],
  });
  const receipt2 = (rc2.data as { id: string }).id;
  receiptIds.push(receipt2);
  await prisma.roll.updateMany({ where: { goodsReceiptId: receipt2 }, data: { purchasePrice: null } });

  const rateDay = new Date();
  rateDay.setUTCHours(0, 0, 0, 0);
  const existingRate = await prisma.exchangeRate.findFirst({
    where: { rateDate: rateDay, currency: "USD" },
    select: { id: true },
  });
  let createdRateId: string | null = null;
  if (!existingRate) {
    // ⚠️ Var olan kuru EZMEZ — başka test/ekran onu okuyor olabilir.
    const r = await prisma.exchangeRate.create({
      data: { rateDate: rateDay, currency: "USD", rate: new Prisma.Decimal("40") },
      select: { id: true },
    });
    createdRateId = r.id;
  }

  const draft = await invoiceService.createDraftFromGoodsReceipt(receipt2);
  invoiceIds.push(draft.data.id);
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: draft.data.id },
    select: { cariId: true, lines: { select: { unitPrice: true } } },
  });
  cariIds.push(inv.cariId);
  check(
    "§8e ⭐ Fiyatsız fişten doğan ALIŞ FATURASI satırı kart fiyatıyla doldu",
    inv.lines.length === 1 && new Prisma.Decimal(inv.lines[0]?.unitPrice ?? 0).equals(3.25),
    `${inv.lines[0]?.unitPrice}`,
  );

  if (createdRateId) await prisma.exchangeRate.deleteMany({ where: { id: createdRateId } });

  // ── §9 LİSTE YÜZEYİ ──────────────────────────────────────────────────────
  // ⚠️ Buradaki filtrelerin hiçbiri "tip hatası" vermez, YANLIŞ LİSTE verir:
  // `filter[customerId]=null` jenerik yoldan geçseydi "null" METNİ uuid kolonuna
  // gider ve P2007/400 üretirdi (2026-08-06 CSV dersinin ikizi); Türkçe arama
  // düz ILIKE ile yapılsaydı "şık" araması BÜYÜK saklanan adı bulamaz ve liste
  // sessizce boş dönerdi.
  const listAll = await itemPriceService.list({ page: 1, pageSize: 20, filters: { itemId: item.id } });
  check("§9a Liste satır döndürüyor (körlük zemini)", listAll.total > 0, `total=${listAll.total}`);
  const listRows = listAll.rows as Array<{ customerId: string | null; item?: { code: string } }>;
  check(
    "§9b Sıra: KART VARSAYILANI önce (nulls-first), sonra istisnalar",
    listRows.length > 1 ? listRows[0]?.customerId === null : true,
    `ilk=${listRows[0]?.customerId ?? "null"}`,
  );
  check("§9c Kalem ilişkisi taşınıyor (panel kod/ad basabilsin)", Boolean(listRows[0]?.item?.code));
  const listDefaults = await itemPriceService.list({
    page: 1,
    pageSize: 20,
    filters: { itemId: item.id, customerId: "null" },
  });
  check(
    "§9d ⭐ `filter[customerId]=null` YALNIZ varsayılanları getiriyor (400 üretmiyor)",
    listDefaults.total > 0 &&
      (listDefaults.rows as Array<{ customerId: string | null }>).every((r) => r.customerId === null),
    `total=${listDefaults.total}`,
  );
  const listCsv = await itemPriceService.list({
    page: 1,
    pageSize: 20,
    filters: { itemId: `${item.id},${itemNoPrice.id}` },
  });
  check("§9e CSV id filtresi `in`e çevriliyor (ham CSV uuid kolonuna gitmiyor)", listCsv.total >= listAll.total);
  const listSearch = await itemPriceService.list({ page: 1, pageSize: 20, filters: { itemId: item.id }, search: "şık" });
  check("§9f Türkçe arama BÜYÜK saklanan adı buluyor", listSearch.total === listAll.total, `total=${listSearch.total}`);

  // §9g ⭐⭐ PROTOTİP ANAHTARI — `kind`/`currency` bir ALLOWLIST'ten geçiyor ve
  // o allowlist `deger in PriceKind` ile kurulmuştu. `in` prototip zincirini de
  // tarar (`"toString" in PriceKind` → TRUE, ölçüldü), yani
  // `filter[kind]=toString` allowlist'i GEÇER ve `where.kind = "toString"`
  // Prisma'ya gider → ham doğrulama hatası. Doğru davranış: değer enum üyesi
  // olmadığı için filtre HİÇ uygulanmaz (liste süzülmemiş hâliyle döner),
  // çağrı ÇÖKMEZ.
  for (const proto of ["toString", "__proto__", "constructor"]) {
    let protoTotal = -1;
    let protoErr = "";
    try {
      protoTotal = (await itemPriceService.list({ page: 1, pageSize: 20, filters: { itemId: item.id, kind: proto } })).total;
    } catch (e) {
      protoErr = (e as Error).message.replace(/\s+/g, " ").slice(0, 90);
    }
    check(
      `§9g ⭐ \`filter[kind]=${proto}\` Prisma'ya SIZMIYOR (allowlist prototipi saymıyor)`,
      protoErr === "" && protoTotal === listAll.total,
      protoErr || `total=${protoTotal} (beklenen ${listAll.total})`,
    );
  }
  // Körlük zemini: kapı sıkılaştırıldı ama GERÇEK enum değeri hâlâ süzüyor.
  const listKind = await itemPriceService.list({ page: 1, pageSize: 20, filters: { itemId: item.id, kind: "SALE" } });
  check(
    "§9h Körlük zemini: geçerli `kind=SALE` filtresi hâlâ uygulanıyor",
    listKind.total > 0 && listKind.total <= listAll.total &&
      (listKind.rows as Array<{ kind: string }>).every((r) => r.kind === "SALE"),
    `total=${listKind.total}/${listAll.total}`,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    // Sıra ÖNEMLİ: FK'lar RESTRICT (rollVariance → roll, cariTransaction → invoice).
    if (invoiceIds.length > 0) {
      await prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.printedDocument.deleteMany({ where: { sourceId: { in: invoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    }
    if (cariIds.length > 0) {
      await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
    }
    if (receiptIds.length > 0) {
      const rolls = await prisma.roll.findMany({ where: { goodsReceiptId: { in: receiptIds } }, select: { id: true } });
      const rollIds = rolls.map((r) => r.id);
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      await prisma.printedDocument.deleteMany({ where: { sourceId: { in: receiptIds } } });
      await prisma.goodsReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    }
    if (itemIds.length > 0) {
      await prisma.itemPrice.deleteMany({ where: { itemId: { in: itemIds } } });
      await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    }
    if (customerIds.length > 0) {
      await prisma.cariAccount.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    }
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
