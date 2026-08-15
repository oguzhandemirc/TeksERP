// =============================================================================
// BEKÇİ — TİCARET ARAMALARI TÜRKÇE-DUYARLI MI?
// =============================================================================
// Çalıştırma: npx tsx scripts/test_ticaret_turkish_search.ts
//
// NEDEN VAR (2026-08-15 saha taraması, "filtresiz-liste" merceği): sekiz
// ticaret servisi (yarn · cari · purchase-order · invoice · cheque ·
// cash-transaction · cheque-delivery-note · payment) aramayı düz
// `contains + mode:"insensitive"` ile kuruyordu. Projenin kendi kuralı bunun
// neden yanlış olduğunu yazıyor (`utils/query-parser.ts` Y-2/Y-3): PostgreSQL
// C-locale'de ILIKE YALNIZ ASCII a-z↔A-Z katlar, Türkçe çiftlerini
// (i↔İ, ı↔I, ç↔Ç, ğ↔Ğ, ö↔Ö, ş↔Ş, ü↔Ü) EŞLEMEZ.
//
// ⭐ EN KESİN KIRIK YARN: `Item.name` `normalizeItemName` ile tr-TR BÜYÜĞE
// çevrilerek saklanıyor ("İPLİK ÇEŞİDİ"), yani küçük harfle arayan kullanıcı
// kaydı HİÇBİR ZAMAN bulamazdı — hata yok, log yok, yalnız boş liste. Bu
// yüzden §1 ve §2 İŞLEVSELDİR (gerçek kayıt yaratıp gerçek sorgu koşar);
// kalan altı servis için kaynak taraması yapılır (§3), çünkü her biri için
// fatura/çek/kasa fixture'ı kurmak testin ölçtüğü şeyi (tek satırlık arama
// kurulumu) değiştirmez ama koşum süresini katlar.
//
// ⚠️ KÖRLÜK ZEMİNİ: §3 taradığı dosya sayısını ve `buildTurkishSearch`
// çağrısı bulduğu dosya sayısını AYRICA doğrular — dosya yolu değişirse
// "ihlal bulunamadı" ile "hiçbir şeye bakılmadı" aynı yeşile çıkmasın.
//
// ⚠️⚠️ §4 NEDEN EKLENDİ (2026-08-15, ikinci tur). Bu bekçinin İLK hâli
// düzeltmenin YALNIZ ÇALIŞAN YARISINI ölçüyordu: fixture'ları toptan BÜYÜK ad
// kuruyordu ve o hâl tr-BÜYÜK varyantıyla zaten bulunuyordu. DB collation'ı
// `en_US.UTF-8` (C DEĞİL — psql ile ölçüldü), yani ILIKE ş/ğ/ö/ü/ç çiftlerini
// ZATEN katlıyor; katlamadığı TEK aile noktalı/noktasız i'dir ve düzeltmenin
// açıkta bıraktığı çift tam olarak oydu. Başlık düzeninde saklanan değerler
// (Customer.name — bu DB'de 49 müşterinin 22'si —, çek keşideci/banka adı,
// kasa açıklaması) hiçbir yaprakla eşleşmiyordu.
//
// İKİ KATMAN VE HER BİRİNİN KENDİ FİXTURE'I (biri diğerini maskelemesin):
//   §4b BAŞLIK DÜZENİ  → "İş Bankası Kumaşçılık"  (kanonik yazım katmanı)
//   §4d KARIŞIK YAZIM  → "AKİF ticaret"           (i-ailesi çarpımı katmanı)
// §4d olmadan çarpım katmanı BEKÇİSİZ kalır: başlık düzeni yaprağı §4b'yi tek
// başına yeşile çıkarır (ölçüldü). §5 aynı kuralları saf üreteçle kilitler ve
// desen SAYISINI da sınırlar (her yaprak ilişki aramasında bir EXISTS demek).
//
// NEGATİF SONDALAR (2026-08-15 — koşuldu, kırmızı GÖRÜLDÜ, dosyalar shasum ile
// birebir geri yüklendi):
//   • `yarn.service.ts`in araması eski hâline (düz contains+insensitive)
//     çevrildi → §1b KIRMIZI (küçük harfle arayan 0 satır aldı) ve §3
//     "yarn.service" satırı KIRMIZI.
//   • `cari.service.ts` aynı şekilde çevrildi → §2b KIRMIZI.
//   • BAŞLIK DÜZENİ yaprağı (`push(trTitleCase(term))`) kaldırıldı → §4b'nin
//     dört-i satırı + §5f + §5e KIRMIZI (3 kontrol).
//   • i-ailesi çarpımı kapatıldı → §4d + §5a KIRMIZI (2 kontrol).
//   • ⚠️ İKİ SONDADA DA §1/§2 (BÜYÜK saklanan adlar) YEŞİL KALDI — ilk hâlin
//     kör noktasının kanıtı; bu bekçiyi budarken o iki bölüme bakıp
//     "kapsanıyor" DEME.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { yarnService } from "../src/services/yarn.service";
import { cariService } from "../src/services/cari.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { normalizeItemName } from "../src/services/helpers/name-normalize.helper";
import { turkishSearchPatterns } from "../src/utils/query-parser";

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

const TAG = `TEST-TRS-${Date.now()}`;
// Türkçe'ye özgü harfler: ASCII fold ile İ→i, Ş→s, Ğ→g eşlenmez.
const TR_NAME = `${TAG} İPLİK ŞİŞE ÇÖZGÜ`;
const cleanup: { itemIds: string[]; stockIds: string[]; cariIds: string[]; customerIds: string[] } = {
  itemIds: [],
  stockIds: [],
  cariIds: [],
  customerIds: [],
};

/** Servis dosyalarında düz `contains + insensitive` kaldı mı? */
const SERVICES = [
  "yarn.service.ts",
  "cari.service.ts",
  "purchase-order.service.ts",
  "invoice.service.ts",
  "cheque.service.ts",
  "cash-transaction.service.ts",
  "cheque-delivery-note.service.ts",
  "payment.service.ts",
] as const;

async function main(): Promise<void> {
  console.log("=== Ticaret aramaları — Türkçe duyarlılık bekçisi ===\n");

  // ── §1 YARN: ad tr-BÜYÜK saklanıyor, küçük harfle aranıyor ───────────────
  const wh = await ensureDefaultWarehouse();
  if (!wh) throw new Error("Varsayılan depo yok.");
  const item = await prisma.item.create({
    data: {
      code: `${TAG}-ITM`,
      // Servisin kendi normalizasyonu ile AYNI fonksiyon: testin fixture'ı
      // "adlar büyük saklanıyor" varsayımını taklit etmez, ÜRETİR.
      name: normalizeItemName(TR_NAME),
      itemType: "YARN",
      unit: "KG",
    },
    select: { id: true, name: true },
  });
  cleanup.itemIds.push(item.id);
  check("§1a Fixture: kalem adı tr-BÜYÜK saklandı", item.name === TR_NAME.toLocaleUpperCase("tr-TR"), item.name);

  const stock = await prisma.yarnStock.create({
    data: { itemId: item.id, warehouseId: wh.id, balanceKg: "125.500" },
    select: { id: true },
  });
  cleanup.stockIds.push(stock.id);

  // ⭐ ASIL ÖLÇÜM: kullanıcının yazdığı gibi — KÜÇÜK harf, Türkçe karakterli.
  const lower = "iplik şişe";
  const found = await yarnService.listStocks({ page: 1, pageSize: 50, search: lower });
  const hit = found.data.some((r) => r.item.id === item.id);
  check(`§1b ⭐ İplik stoğu küçük harfle bulundu ("${lower}")`, hit, `${found.data.length} satır döndü`);

  // Kontrol grubu: BÜYÜK harfle de bulunmalı (regresyon — Türkçe varyant
  // eklerken ASCII yolu bozulmasın).
  const upperFound = await yarnService.listStocks({ page: 1, pageSize: 50, search: TR_NAME.slice(0, 24) });
  check(
    "§1c Kontrol: aynı kayıt BÜYÜK harfle de bulunuyor",
    upperFound.data.some((r) => r.item.id === item.id),
    `${upperFound.data.length} satır`,
  );

  // Kontrol grubu: alakasız terim EŞLEŞMEMELİ (arama gerçekten süzüyor mu —
  // "hep true dönen" bir OR ifadesi §1b'yi sahte yeşile çıkarırdı).
  const noise = await yarnService.listStocks({ page: 1, pageSize: 50, search: `${TAG}-YOKBOYLEBIRSEY` });
  check("§1d Kontrol: alakasız terim 0 satır (arama gerçekten süzüyor)", noise.data.length === 0, `${noise.data.length} satır`);

  // ── §2 CARİ: müşteri adı Türkçe harfli ──────────────────────────────────
  const customer = await prisma.customer.create({
    data: { code: `${TAG}-CST`, name: `${TAG} ŞAHİN TEKSTİL`, type: "CUSTOMER" },
    select: { id: true },
  });
  cleanup.customerIds.push(customer.id);
  const cari = await prisma.cariAccount.create({
    data: { kind: "CUSTOMER", customerId: customer.id },
    select: { id: true },
  });
  cleanup.cariIds.push(cari.id);

  const cariHit = await cariService.list({ page: 1, pageSize: 50, search: "şahin tekstil" });
  check(
    '§2a ⭐ Cari küçük harfle bulundu ("şahin tekstil")',
    cariHit.data.some((r) => r.id === cari.id),
    `${cariHit.data.length} satır`,
  );
  const cariNoise = await cariService.list({ page: 1, pageSize: 50, search: `${TAG}-YOKBOYLEBIRCARI` });
  check("§2b Kontrol: alakasız terim 0 satır", cariNoise.data.length === 0, `${cariNoise.data.length} satır`);

  // ── §4 ⭐⭐ BAŞLIK DÜZENİNDE SAKLANAN AD (i ↔ İ) ─────────────────────────
  // ⚠️ BU BÖLÜM BEKÇİNİN İLK YAZIMINDAKİ KÖR NOKTAYI KAPATIR. §1/§2 fixture'ları
  // adı TOPTAN BÜYÜK kuruyordu (`İPLİK ŞİŞE ÇÖZGÜ`, `ŞAHİN TEKSTİL`) ve o hâl
  // tr-BÜYÜK varyantıyla zaten bulunuyordu — yani bekçi düzeltmenin ÇALIŞAN
  // yarısını ölçüyor, kırık yarısını görmüyordu.
  //
  // Sistemin yarısı BÜYÜK saklanmaz: `Customer.name` normalize EDİLMEZ (49
  // müşterinin 22'si başlık düzeninde), çek keşideci/banka adı ve kasa
  // açıklaması serbest metindir. Ölçülen gerçek (psql, en_US.UTF-8):
  //     'T. İş Bankası' ILIKE '%iş bankası%'  → f
  //                      LIKE '%İŞ BANKASI%'  → f
  //                      LIKE '%iş bankası%'  → f
  //                     ILIKE '%İş bankası%'  → t   ← yalnız i-ailesi çarpımı
  // Yani muhasebeci "işçi avansı" arayınca 0 satır alıyor ve gideri İKİNCİ KEZ
  // giriyordu. Fixture bilerek BAŞLIK DÜZENİNDE ve i-ailesini KARIŞIK taşır
  // (İ...i...ı); toptan büyük/küçük bir ad bu tuzağı ölçemez.
  const titleName = `${TAG} İş Bankası Kumaşçılık`;
  const titleCustomer = await prisma.customer.create({
    data: { code: `${TAG}-CST2`, name: titleName, type: "CUSTOMER" },
    select: { id: true, name: true },
  });
  cleanup.customerIds.push(titleCustomer.id);
  const titleCari = await prisma.cariAccount.create({
    data: { kind: "CUSTOMER", customerId: titleCustomer.id },
    select: { id: true },
  });
  cleanup.cariIds.push(titleCari.id);
  check("§4a Fixture: ad BAŞLIK düzeninde saklandı (BÜYÜK değil)", titleCustomer.name === titleName, titleCustomer.name);

  for (const [label, term] of [
    ["küçük harf, noktalı i", "iş bankası"],
    ["BÜYÜK harf", "İŞ BANKASI"],
    // ⭐ DÖRT i-ailesi konumu (i · ı · ı · ı) → çarpım TAVANI AŞILIR ve
    // devreye BAŞLIK DÜZENİ yaprağı girer ("İş Bankası Kumaşçılık"). Yani bu
    // satır aynı zamanda "tavan aşılınca kapsam kaybolmuyor" kanıtıdır.
    ["tüm terim (çarpım tavanı aşılır → başlık düzeni yakalar)", "iş bankası kumaşçılık"],
  ] as const) {
    const hit = await cariService.list({ page: 1, pageSize: 50, search: `${TAG} ${term}` });
    check(
      `§4b ⭐ Başlık düzenli ad bulundu — ${label} ("${term}")`,
      hit.data.some((r) => r.id === titleCari.id),
      `${hit.data.length} satır`,
    );
  }
  const titleNoise = await cariService.list({ page: 1, pageSize: 50, search: `${TAG} işbankasıX` });
  check("§4c Kontrol: yakın ama yanlış terim 0 satır (çarpım her şeyi eşlemiyor)", titleNoise.data.length === 0, `${titleNoise.data.length} satır`);

  // ── §4d ⭐ KARIŞIK YAZIM — yalnız i-AİLESİ ÇARPIMI yakalar ───────────────
  // ⚠️ BU FİXTURE ÇARPIM KATMANININ TEK KANITI. Kanonik yazımların (BÜYÜK /
  // küçük / BAŞLIK) HİÇBİRİ bu değeri bulamaz: i-ailesi karakteri kelime
  // ORTASINDA BÜYÜK ama gerisi küçük. Fixture'ı "düzeltip" düzgün bir yazıma
  // çevirirsen çarpım katmanı bekçisiz kalır (ölçüldü: çarpım kapatıldığında
  // yalnız bu kontrol kırmızı verir).
  const mixedName = `${TAG} AKİF ticaret`;
  const mixedCustomer = await prisma.customer.create({
    data: { code: `${TAG}-CST3`, name: mixedName, type: "CUSTOMER" },
    select: { id: true },
  });
  cleanup.customerIds.push(mixedCustomer.id);
  const mixedCari = await prisma.cariAccount.create({
    data: { kind: "CUSTOMER", customerId: mixedCustomer.id },
    select: { id: true },
  });
  cleanup.cariIds.push(mixedCari.id);
  const mixedHit = await cariService.list({ page: 1, pageSize: 50, search: `${TAG} akif ticaret` });
  check(
    '§4d ⭐ KARIŞIK yazım bulundu ("AKİF ticaret" ← "akif ticaret") — çarpım katmanı',
    mixedHit.data.some((r) => r.id === mixedCari.id),
    `${mixedHit.data.length} satır`,
  );

  // ── §5 DESEN ÜRETECİ — saf katman (DB'siz, kural doğrudan ölçülür) ───────
  const pats = turkishSearchPatterns("işçi");
  check("§5a i-ailesi çarpımı üretildi (tüm konum kombinasyonları)", pats.includes("İşçi") && pats.includes("işçİ") && pats.includes("İşçİ"), pats.join("|"));
  check("§5b tr-BÜYÜK / tr-küçük varyantları KORUNDU", pats.includes("İŞÇİ") && pats.includes("işçi"), pats.join("|"));
  check("§5c Tekilleştirilmiş (aynı desen iki kez üretilmiyor)", new Set(pats).size === pats.length, `${pats.length} desen`);
  check(
    "§5d i-ailesi TAŞIMAYAN terim tek desen üretir (ASCII sorgusu bayt-bayt aynı)",
    turkishSearchPatterns("kumas").length === 1,
    turkishSearchPatterns("kumas").join("|"),
  );
  // ⭐ BAŞLIK DÜZENİ — sistemin normalize EDİLMEYEN yarısının olağan yazımı.
  // ⚠️ tr-BÜYÜK zorunlu: ASCII `toUpperCase` "işçi"yi "Işçi" (NOKTASIZ I) yapar
  // ve düzeltilen hata aynen geri gelir.
  const bank = turkishSearchPatterns("iş bankası");
  check("§5f ⭐ BAŞLIK DÜZENİ yaprağı üretiliyor", bank.includes("İş Bankası"), bank.join("|"));
  check("§5g Başlık düzeni tr-BÜYÜK kullanıyor (noktasız 'Iş' DEĞİL)", !bank.includes("Iş Bankası"), bank.join("|"));
  const cap = turkishSearchPatterns("iş bankası kumaşçılık");
  check(
    "§5e ÜSTEL PATLAMA TAVANI: 4+ i-ailesi karakterinde çarpım atlanır, kanonik yazımlar KALIR",
    cap.length === 3 && cap.includes("İş Bankası Kumaşçılık"),
    `${cap.length} desen: ${cap.join("|")}`,
  );
  check(
    "§5h Toplam yaprak sayısı SINIRLI (ilişki üzerinden arayan servislerde her yaprak bir EXISTS)",
    Math.max(...["işçi", "iş bankası", "işçi avansı", "iş bankası kumaşçılık"].map((t) => turkishSearchPatterns(t).length)) <= 12,
  );

  // ── §3 KAYNAK TARAMASI — sekiz servisin hepsi ────────────────────────────
  // ⚠️ NEDEN KAYNAK TARAMASI: kalan altı serviste (fatura/çek/kasa/bordro/
  // tahsilat/alış siparişi) aynı tek satırlık kurulum var; her biri için tam
  // fixture kurmak ölçülen ŞEYİ değiştirmez. Tarama iki yönlü: (a) düz
  // `contains + insensitive` KALMAMIŞ, (b) `buildTurkishSearch` GERÇEKTEN
  // çağrılıyor — yalnız (a) ölçülseydi aramayı tamamen SİLEN bir değişiklik
  // de yeşil kalırdı.
  const svcDir = path.resolve(__dirname, "../src/services");
  let scanned = 0;
  let withHelper = 0;
  for (const f of SERVICES) {
    const p = path.join(svcDir, f);
    if (!fs.existsSync(p)) {
      check(`§3 ${f} — DOSYA YOK (yol değişmiş olabilir)`, false, p);
      continue;
    }
    scanned++;
    const src = fs.readFileSync(p, "utf8");
    // Yorum satırları hariç tut: bu dosyalardaki açıklamalar deseni ANLATIYOR.
    const code = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    const rawIlike = /contains:\s*[^,}]+,\s*mode:\s*"insensitive"/.test(code);
    const usesHelper = /buildTurkishSearch\(/.test(code);
    if (usesHelper) withHelper++;
    check(`§3 ${f}: düz contains+insensitive YOK`, !rawIlike);
    check(`§3 ${f}: buildTurkishSearch kullanılıyor`, usesHelper);
  }
  // KÖRLÜK ZEMİNİ — "hiç dosya taranmadı" ile "ihlal yok" aynı yeşile çıkmasın.
  check("§3z Körlük zemini: sekiz servisin hepsi tarandı", scanned === SERVICES.length, `${scanned}/${SERVICES.length}`);
  check("§3y Körlük zemini: hepsinde yardımcı bulundu", withHelper === SERVICES.length, `${withHelper}/${SERVICES.length}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("PATLADI:", e);
    fail++;
  })
  .finally(async () => {
    try {
      if (cleanup.stockIds.length) await prisma.yarnStock.deleteMany({ where: { id: { in: cleanup.stockIds } } });
      if (cleanup.itemIds.length) await prisma.item.deleteMany({ where: { id: { in: cleanup.itemIds } } });
      if (cleanup.cariIds.length) await prisma.cariAccount.deleteMany({ where: { id: { in: cleanup.cariIds } } });
      if (cleanup.customerIds.length) await prisma.customer.deleteMany({ where: { id: { in: cleanup.customerIds } } });
    } catch (e) {
      console.warn("Temizlik uyarısı:", (e as Error).message);
    }
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
