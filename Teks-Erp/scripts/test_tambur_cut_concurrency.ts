// =============================================================================
// BEKÇİ — EŞZAMANLI AŞIM KESİMİ (2026-08-29 / BULGU-T1-002)
// Çalıştır: npx tsx scripts/test_tambur_cut_concurrency.ts
// =============================================================================
// Aşım kararı tx'ten ÖNCE, havuz bağlantısıyla okunan metrajdan veriliyordu ve
// aşım dalının WHERE'inde METRAJ ŞARTI YOKTU. İki tablet 100 m'lik topu aynı
// anda 120 m okutup keserse:
//   • ikisi de "aşım" der, ikisi de WHERE'e uyar, ikisi de commit eder,
//   • 240 m çocuk doğar (yoktan 140 m kumaş envantere girer),
//   • sapma defterine gerçek 140 m yerine 2×20 = 40 m yazılır,
//   • iki barkodlu top da sevk edilebilir.
// Üstelik hata KENDİ İZİNİ SİLER: parent 0/0'a indiği için orijinal metraj
// geriye doğru kurulamaz (saha kopyasında 37 OVERAGE satırı / 382,1 m vardı ve
// hangisinin bu yüzden doğduğu AYIRT EDİLEMEDİ).
//
// §1 EŞZAMANLI AŞIM  — iki paralel 120 m kesim: biri geçer, diğeri 409 alır
// §2 DEFTER          — yazılan aşım GERÇEK aşımdır (bayat değerden değil)
// §3 REGRESYON       — ARDIŞIK aşım kesimi hâlâ serbest (2026-08-12 saha kuralı:
//                      fazlalık tek kesimde bitmeyebilir; 0'daki topta ikinci
//                      aşım kesimi MEŞRU, yarış değil)
// §4 REGRESYON       — normal (aşımsız) eşzamanlı kesimler stok aşırtmıyor
// §5 DEĞİŞMEZ        — Σçocuk + kalan − Σaşım = giriş metrajı (zamanlamadan
//                      bağımsız; defter payı bayat metrajdan yazılırsa bozulur)
// §6 BAYAT OKUMA     — pencere elle açılır: karar + defter payı TAZE metrajdan
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { RollStatus, RollVarianceKind } from "@prisma/client";
import { SETTING_KEYS } from "../src/services/system-setting.service";

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
const tambur = new TamburService();
const rollIds: string[] = [];
let itemId = "";
let userId = "";
let bayrakEski: unknown = undefined;

async function depoTopu(tag: string, qty: number): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: `TST-TCC-${tag}-${ts}`,
      itemId,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.WAREHOUSE,
      finalizedAt: new Date(),
    },
    select: { id: true },
  });
  rollIds.push(r.id);
  return r.id;
}

async function cocuklar(parentId: string): Promise<number> {
  const rows = await prisma.roll.findMany({ where: { parentRollId: parentId }, select: { id: true, currentQty: true } });
  rows.forEach((r) => rollIds.push(r.id));
  return rows.reduce((t, r) => t + Number(r.currentQty), 0);
}

async function main(): Promise<void> {
  const item = await prisma.item.create({
    data: { code: `TST-TCC-${ts}`, name: `Test Kesim Eşzamanlılık ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  itemId = item.id;
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  check("fixture hazır (admin)", Boolean(admin));
  if (!admin) return;
  userId = admin.id;

  // Aşım bayrağı AÇIK olmalı — bu bekçinin konusu aşım dalı.
  const eski = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TAMBUR_OVER_QUANTITY_ENABLED },
    select: { value: true },
  });
  bayrakEski = eski ? eski.value : undefined;
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEYS.TAMBUR_OVER_QUANTITY_ENABLED },
    create: { key: SETTING_KEYS.TAMBUR_OVER_QUANTITY_ENABLED, value: true },
    update: { value: true },
  });

  // ═══ §1 — iki paralel aşım kesimi ═══
  console.log("\n=== §1: 100 m'lik top, iki tablet aynı anda 120 m kesiyor ===");
  const p1 = await depoTopu("A", 100);
  const sonuc = await Promise.allSettled([
    tambur.cutWarehouseRoll(p1, { cutLength: 120 }, userId),
    tambur.cutWarehouseRoll(p1, { cutLength: 120 }, userId),
  ]);
  const basarili = sonuc.filter((r) => r.status === "fulfilled").length;
  const reddedilen = sonuc.filter((r) => r.status === "rejected");
  check("§1: YALNIZ BİRİ geçti", basarili === 1, `${basarili} başarılı / ${reddedilen.length} red`);
  check(
    "§1: kaybeden 409 aldı (sessiz başarı değil)",
    reddedilen.every((r) => (r as PromiseRejectedResult).reason?.statusCode === 409),
    reddedilen.map((r) => String((r as PromiseRejectedResult).reason?.statusCode)).join(",") || "—",
  );
  const toplamCocuk = await cocuklar(p1);
  check("§1: YOKTAN KUMAŞ DOĞMADI (çocuk toplamı 120 m)", toplamCocuk === 120, `${toplamCocuk} m çocuk`);

  // ═══ §2 — defter gerçek aşımı yazdı ═══
  const sapmalar = await prisma.rollVariance.findMany({
    where: { rollId: p1, kind: RollVarianceKind.OVERAGE },
    select: { qty: true },
  });
  const toplamAsim = sapmalar.reduce((t, v) => t + Number(v.qty), 0);
  check(
    "§2: sapma defteri GERÇEK aşımı yazdı (20 m), bayat değerden çift değil",
    Math.abs(toplamAsim - 20) < 0.001,
    `defterde ${toplamAsim} m / ${sapmalar.length} satır`,
  );

  // ═══ §3 — ARDIŞIK aşım kesimi hâlâ serbest ═══
  console.log("\n=== §3: regresyon — fazlalık tek kesimde bitmeyebilir ===");
  const p2 = await depoTopu("B", 100);
  await tambur.cutWarehouseRoll(p2, { cutLength: 120 }, userId); // 100 → 0, aşım 20
  let ikinciHata: number | undefined;
  try {
    await tambur.cutWarehouseRoll(p2, { cutLength: 30 }, userId); // 0'daki topta ek kesim
  } catch (e) {
    ikinciHata = (e as { statusCode?: number }).statusCode;
  }
  check(
    "§3: 0'a inmiş topta İKİNCİ aşım kesimi hâlâ kabul ediliyor",
    ikinciHata === undefined,
    ikinciHata ? `statusCode ${ikinciHata}` : "kabul edildi",
  );
  const toplam2 = await cocuklar(p2);
  check("§3: iki kesimin çocukları da doğdu (150 m)", toplam2 === 150, `${toplam2} m`);
  const sapma2 = await prisma.rollVariance.aggregate({
    where: { rollId: p2, kind: RollVarianceKind.OVERAGE },
    _sum: { qty: true },
  });
  check(
    "§3: defter iki aşımı da yazdı (20 + 30 = 50 m)",
    Math.abs(Number(sapma2._sum.qty ?? 0) - 50) < 0.001,
    `${Number(sapma2._sum.qty ?? 0)} m`,
  );

  // ═══ §4 — normal eşzamanlı kesimler ═══
  console.log("\n=== §4: regresyon — aşımsız eşzamanlı kesimler ===");
  const p3 = await depoTopu("C", 100);
  const s4 = await Promise.allSettled([
    tambur.cutWarehouseRoll(p3, { cutLength: 60 }, userId),
    tambur.cutWarehouseRoll(p3, { cutLength: 60 }, userId),
  ]);
  const ok4 = s4.filter((r) => r.status === "fulfilled").length;
  const toplam3 = await cocuklar(p3);
  const kalan3 = await prisma.roll.findUnique({ where: { id: p3 }, select: { currentQty: true } });
  check("§4: ikisi birden 60+60=120 m ÜRETMEDİ", toplam3 <= 100, `${ok4} başarılı, ${toplam3} m çocuk`);
  check(
    "§4: kaynak + çocuklar = 100 m (metraj korundu)",
    Math.abs(toplam3 + Number(kalan3?.currentQty ?? 0) - 100) < 0.001,
    `${toplam3} + ${kalan3?.currentQty} m`,
  );

  // ═══ §5 — DEĞİŞMEZ: metraj yoktan var olamaz, fark DEFTERDE açıklanır ═══
  // Karışık çift: biri normal (60 m), biri bayat okumayla normal görünen ama
  // TAZE metraja göre aşım olan (80 m) kesim. Sonuç zamanlamaya bağlı (kaybeden
  // ya 409 alır ya aşım olarak kabul edilir) — o yüzden SONUÇ değil DEĞİŞMEZ
  // ölçülür:  Σçocuk + kalan − Σaşım = giriş metrajı.
  // Bu denklem defter payı BAYAT metrajdan yazılırsa da bozulur; §1/§2'nin
  // ölçemediği tam olarak buydu (ilk yazımda "bayat pay" sondası yeşil kalmıştı).
  console.log("\n=== §5: değişmez — metraj yoktan var olmaz ===");
  const p4 = await depoTopu("D", 100);
  await Promise.allSettled([
    tambur.cutWarehouseRoll(p4, { cutLength: 60 }, userId),
    tambur.cutWarehouseRoll(p4, { cutLength: 80 }, userId),
  ]);
  const cocuk4 = await cocuklar(p4);
  const kalan4 = Number(
    (await prisma.roll.findUnique({ where: { id: p4 }, select: { currentQty: true } }))?.currentQty ?? 0,
  );
  const asim4 = Number(
    (
      await prisma.rollVariance.aggregate({
        where: { rollId: p4, kind: RollVarianceKind.OVERAGE },
        _sum: { qty: true },
      })
    )._sum.qty ?? 0,
  );
  check(
    "§5: Σçocuk + kalan − Σaşım = 100 (fark defterde açıklanıyor)",
    Math.abs(cocuk4 + kalan4 - asim4 - 100) < 0.001,
    `${cocuk4} + ${kalan4} − ${asim4} = ${cocuk4 + kalan4 - asim4}`,
  );

  // Aynı değişmez §1'in topunda da tutmalı.
  const asim1 = Number(
    (
      await prisma.rollVariance.aggregate({
        where: { rollId: p1, kind: RollVarianceKind.OVERAGE },
        _sum: { qty: true },
      })
    )._sum.qty ?? 0,
  );
  const kalan1 = Number(
    (await prisma.roll.findUnique({ where: { id: p1 }, select: { currentQty: true } }))?.currentQty ?? 0,
  );
  check(
    "§5: aynı değişmez §1 topunda da tutuyor",
    Math.abs(toplamCocuk + kalan1 - asim1 - 100) < 0.001,
    `${toplamCocuk} + ${kalan1} − ${asim1} = ${toplamCocuk + kalan1 - asim1}`,
  );

  // ═══ §6 — BAYAT OKUMA: karar ve defter payı TAZE metrajdan gelmeli ═══
  // İyimser guard, bayat değerle yazan yolu pratikte erişilemez kılıyor — yani
  // "taze okuma" tek başına ölçülemiyor (ölçüldü: sondası yeşil kalıyor). Bu
  // yüzden pencere ELLE açılır: tx ÖNCESİ okuma kandırılır (ekran bayat), tx
  // İÇİNDEKİ okuma gerçeği görür. Doğru davranış: karar da defter payı da TAZE
  // metrajdan verilir. Bayat mantıkta bu kesim ya yanlış dala gider ya da aşımı
  // 0 yazar — iki durumda da §5'in değişmezi bozulur.
  console.log("\n=== §6: bayat ekran okuması (pencere elle açıldı) ===");
  const p5 = await depoTopu("E", 100);
  await tambur.cutWarehouseRoll(p5, { cutLength: 60 }, userId); // gerçek kalan: 40
  type FindUniqueFn = (args: unknown) => Promise<unknown>;
  const gercek = prisma.roll.findUnique.bind(prisma.roll) as unknown as FindUniqueFn;
  let kandirildi = false;
  (prisma.roll as unknown as { findUnique: FindUniqueFn }).findUnique = async (args: unknown) => {
    const row = (await gercek(args)) as { id?: string; currentQty?: unknown } | null;
    const w = (args as { where?: { id?: string } })?.where;
    if (!kandirildi && row && w?.id === p5) {
      kandirildi = true;
      return { ...row, currentQty: 100 }; // ekran hâlâ 100 m gösteriyor
    }
    return row;
  };
  try {
    await tambur.cutWarehouseRoll(p5, { cutLength: 80 }, userId);
  } finally {
    (prisma.roll as unknown as { findUnique: FindUniqueFn }).findUnique = gercek;
  }
  check("§6: sonda bayat okumayı gerçekten enjekte etti", kandirildi);
  const cocuk5 = await cocuklar(p5);
  const kalan5 = Number(
    (await prisma.roll.findUnique({ where: { id: p5 }, select: { currentQty: true } }))?.currentQty ?? 0,
  );
  const asim5 = Number(
    (
      await prisma.rollVariance.aggregate({
        where: { rollId: p5, kind: RollVarianceKind.OVERAGE },
        _sum: { qty: true },
      })
    )._sum.qty ?? 0,
  );
  check(
    "§6: aşım TAZE kalandan hesaplandı (80 − 40 = 40 m)",
    Math.abs(asim5 - 40) < 0.001,
    `defterde ${asim5} m`,
  );
  check(
    "§6: değişmez korundu — Σçocuk + kalan − Σaşım = 100",
    Math.abs(cocuk5 + kalan5 - asim5 - 100) < 0.001,
    `${cocuk5} + ${kalan5} − ${asim5} = ${cocuk5 + kalan5 - asim5}`,
  );
}

async function cleanup(): Promise<void> {
  if (bayrakEski === undefined) {
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.TAMBUR_OVER_QUANTITY_ENABLED } }).catch(() => {});
  } else {
    await prisma.systemSetting
      .update({ where: { key: SETTING_KEYS.TAMBUR_OVER_QUANTITY_ENABLED }, data: { value: bayrakEski as boolean } })
      .catch(() => {});
  }
  const hepsi = await prisma.roll.findMany({ where: { itemId }, select: { id: true } }).catch(() => []);
  const ids = [...new Set([...rollIds, ...hepsi.map((r) => r.id)])];
  // ⚠️ RESTRICT FK: sapma defteri topu kilitler.
  await prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { parentRollId: { in: ids } } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  if (itemId) await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
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
