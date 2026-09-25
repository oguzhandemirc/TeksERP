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
// §1 EŞZAMANLI AŞIM  — iki paralel 120 m kesim: biri geçer, diğeri 409 alır.
//                      PENCERE gate-tx satır kilidiyle KURULUR ve kurulduğu
//                      ÖLÇÜLÜR; kurulamazsa kalem "yarış ölçülmedi" der (2026-09-13)
// §2 DEFTER          — yazılan aşım GERÇEK aşımdır (bayat değerden değil)
// §3 REGRESYON       — ARDIŞIK aşım kesimi hâlâ serbest (2026-08-12 saha kuralı:
//                      fazlalık tek kesimde bitmeyebilir; 0'daki topta ikinci
//                      aşım kesimi MEŞRU, yarış değil)
// §4 REGRESYON       — normal (aşımsız) eşzamanlı kesimler stok aşırtmıyor
// §5 DEĞİŞMEZ        — Σçocuk + kalan − Σaşım = giriş metrajı (zamanlamadan
//                      bağımsız; defter payı bayat metrajdan yazılırsa bozulur)
// §6 BAYAT OKUMA     — pencere elle açılır: ön okuma bayat (100), kilit altındaki kalan
//                      40 → normal niyetli 80 m kesim AŞIMA DÖNMEZ, 409 alır
// §7 AÇIK KUMAŞ      — cutOpenFabric aynı niyet kuralı: eşzamanlı 60+60 → biri 409 ·
//                      eşzamanlı aşım 120+120 → biri 409 (240 m yok) · 0'da ardışık aşım serbest.
//                      Orijinal kod (tren 8 tabanı, S5 tetikleyicisiyle): §7a 20/20 ve §7b
//                      20/20 KIRMIZI — iş emri kilidi kesimleri sıraladığı için DETERMİNİSTİK.
//                      Negatif sonda: niyet kuralı kaldırılınca §7a/§7b 20/20 kırmızı.
//
// ⭐ NİYET KORUNUR (2026-09-25, 1e kararı (A); BULGU-T1-002'nin kapsamı DARALDI):
//    Eskiden karar tx içindeki KİLİTSİZ "taze okuma"dan veriliyordu ve §6 bayat ekranda
//    aşıma DÖNMEYİ bekliyordu. Oysa üretimde ön okuma isteğin başında yapılır; "bayat"
//    ancak istek sürerken başka bir yazım araya girerse doğar — yani yarışın TA KENDİSİ.
//    §4 aynı durumu (60+60, 100 m) 409 bekliyordu ve kilitsiz okumanın zamanlamasına göre
//    8 koşumda 2 kez kırmızıydı. Şimdi: ebeveyn `SELECT … FOR UPDATE` ile tx'in İLK
//    ifadesinde alınır; normal niyette kalan yetmiyorsa, aşım niyetinde kalan ön
//    okumadan farklıysa 409 ("Bu top siz keserken başka bir işlemle değişti"). İki
//    tablet aynı topu aynı anda kesemez; eşzamanlı eksilmeyi aşım yazmak yoktan kumaştır.
//    NEGATİF SONDA (2026-09-25, 20'şer koşum): düzeltmeyle 20/20 yeşil · N3 orijinal kod
//    §4'ü 4/20 kırdı (aralıklı) · N2 kilit VAR niyet kuralı YOK → 20/20 kırmızı (kilit
//    tek başına §4'ü kalıcı kırar: kilitten sonra da azalmış kalan okunur) · N1 niyet
//    kuralı VAR kilit YOK → 20/20 yeşil. ⇒ Taşıyıcı parça NİYET kuralıdır (+ iyimser WHERE
//    guard'ları); kilit okuma-karar-yazmayı atomik yapan savunma katmanıdır.
//
// ⚠️ §4 ve §5'e AYNI PENCEREYİ EKLEMEYİN: o ikisi SONUÇ değil DEĞİŞMEZ ölçüyor
// (`Σçocuk ≤ giriş`, `Σçocuk + kalan − Σaşım = giriş`) ve değişmez zamanlamadan
// bağımsızdır. Pencere yalnız SONUCU ölçen kalemde gereklidir — §1 tek örnekti.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { RollEntrySource, RollStatus, RollVarianceKind, StationKind, StationType, StepStatus } from "@prisma/client";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
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
const tambur = new TamburService();
const rollIds: string[] = [];
let itemId = "";
let userId = "";
let bayrakEski: unknown = undefined;
// §7 açık kumaş fikstürü — kendi iş emri/adımı; istasyon ve kalite yalnız YOKSA yaratılır.
const woIds: string[] = [];
let olusanIstasyon: string | null = null;
let olusanKalite: string | null = null;
let kaliteKodu = "";

async function depoTopu(tag: string, qty: number): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: `TST-TCC-${tag}-${ts}`,
      itemId,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.WAREHOUSE,
      finalizedAt: new Date(),
      // ⚠️ KALİTE FIXTURE'DA (2026-09-03): depo topu gerçekte kalitesiyle
      // depoya iner. Gradesiz fixture, `quality.gradeRequiredEnabled` AÇIK bir
      // kurulumda bu bekçiyi kendi konusundan (eşzamanlılık) değil D6
      // kapısından kırmızıya düşürüyordu — yarış guard'ı hiç ölçülmeden
      // 409 yerine 400 GRADE_REQUIRED dönüyordu.
      qualityGrade: "1.KALITE",
      // ⚠️ DEPO FIKSTÜRDE (2026-09-13): "depo topu"nun deposu olmak ZORUNDA —
      // deposuz stok topu K1 uç şeklini ihlal eder, hiçbir Σ'ya girmez ve
      // sevki/iadesi kapıda durur. Deposuz doğan bu fikstür `test_consistency §29`
      // ile `test_roll_warehouse_stamp`i kırmızı tutuyordu (ölçüldü: 88 top).
      // K7 4. adımı (`rolls_stock_requires_warehouse_ck`) bu şekli DB'de yasaklar.
      warehouseId: await fixtureWarehouseId(),
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

/** Açık kumaş (barkodsuz) — kendi iş emrinin Tambur adımında IN_PRODUCTION (cutOpenFabric). */
async function acikKumas(tag: string, qty: number): Promise<string> {
  let istasyon = await prisma.station.findFirst({ where: { kind: StationKind.TAMBUR }, select: { id: true } });
  if (!istasyon) {
    istasyon = await prisma.station.create({
      data: { code: `TST-TCC-TMB-${ts}`, name: "TST Tambur", type: StationType.INTERNAL, kind: StationKind.TAMBUR },
      select: { id: true },
    });
    olusanIstasyon = istasyon.id;
  }
  if (!kaliteKodu) {
    const k = await prisma.qualityGrade.findFirst({ where: { role: "FIRST", isActive: true }, select: { code: true } });
    if (k) kaliteKodu = k.code;
    else {
      const y = await prisma.qualityGrade.create({
        data: { code: `TST-TCC-K1-${ts}`, name: `TST-TCC 1. Kalite ${ts}`, role: "FIRST", targetStatus: RollStatus.WAREHOUSE },
        select: { id: true, code: true },
      });
      olusanKalite = y.id;
      kaliteKodu = y.code;
    }
  }
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `TST-TCC-WO-${tag}-${ts}`, status: "IN_PROGRESS" }, select: { id: true } });
  woIds.push(wo.id);
  const adim = await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId: istasyon.id, stepSequence: 1, status: StepStatus.ACTIVE },
    select: { id: true },
  });
  const r = await prisma.roll.create({
    data: {
      barcode: null, itemId, width: 150, initialQty: qty, currentQty: qty, status: RollStatus.IN_PRODUCTION,
      qualityGrade: kaliteKodu, entrySource: RollEntrySource.SUBCONTRACTOR_RETURN, currentStepId: adim.id,
    },
    select: { id: true },
  });
  rollIds.push(r.id);
  return r.id;
}

async function main(): Promise<void> {
  // ⚠️ İLK İFADE: bu bekçi global `SystemSetting` YAZIYOR (aşım bayrağı). Kapı
  // yoktu — ortak ağaçtaki `.env` fabrikanın canlı yedeğini gösterdiğinde bir
  // koşum oraya yazardı (1e'nin §8 bulgusu, 2026-09-13).
  const dbEngeli = hedefDbEngeli();
  if (dbEngeli) {
    console.error(`❌ DURDURULDU: ${dbEngeli}`);
    fail++;
    return;
  }
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
  //
  // ⚠️ PENCERE ELLE KURULUR VE KURULDUĞU ÖLÇÜLÜR (2026-09-13). İlk yazımda §1
  // yalnız `Promise.allSettled` ile iki çağrıyı başlatıyordu ve ÖRTÜŞMEYİ
  // garanti etmiyordu. İkinci çağrının taze okuması birincinin COMMIT'inden
  // SONRA düşerse `tazeKalan=0` olur, `0 < 120` aşım dalı EŞLEŞİR ve kesim
  // kabul edilir — ki bu §3'ün MEŞRU ilan ettiği sonuçtur (0'a inmiş topta
  // ikinci aşım kesimi serbest). Yani bekçi, ürün doğru çalışırken kırmızı
  // veriyordu ve teşhisi "atomik claim kaybı"na gönderiyordu.
  //
  // Ölçüldü (2026-09-13, aynı commit, aynı DB): ardışık koşum → 2 başarı /
  // 240 m çocuk / 140 m aşım 2 satır; gerçekten eşzamanlı koşum → 1 başarı +
  // 409 / 120 m / 20 m 1 satır. CI'ın kırmızısı birinci sütundu.
  //
  // Kural: bir eşzamanlılık bekçisi ÖNCE pencereyi kurduğunu kanıtlar; kuramadıysa
  // bu bir yüklem sonucu değil, ÖLÇÜM ARIZASIDIR. Pencere bir gate-tx'in topa
  // aldığı satır kilidiyle kurulur: iki çağrı da KİLİTSİZ taze okumasını yapar
  // (100 m görür), sonra ikisi de `updateMany`de kilide takılır. Gate açılınca
  // biri eşleşir (100 → 0), diğerinin iyimser yüklemi (`currentQty: 100`) artık
  // eşleşmez → P2025 → 409.
  console.log("\n=== §1: 100 m'lik top, iki tablet aynı anda 120 m kesiyor ===");
  const p1 = await depoTopu("A", 100);
  let gateAc!: () => void;
  const gateKapisi = new Promise<void>((res) => {
    gateAc = res;
  });
  const gateTx = prisma.$transaction(
    async (tx) => {
      // Satır kilidi: iki kesim de `updateMany`de burada bekleyecek.
      await tx.$queryRaw`SELECT id FROM rolls WHERE id = ${p1}::uuid FOR UPDATE`;
      await gateKapisi;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
  // Kural: gate promise'ine `await`ten ÖNCE no-op `.catch` — aksi hâlde bekçi
  // kendi kurduğu pencerede "unhandled rejection" ile düşer.
  gateTx.catch(() => {});
  const kesim1 = tambur.cutWarehouseRoll(p1, { cutLength: 120 }, userId);
  const kesim2 = tambur.cutWarehouseRoll(p1, { cutLength: 120 }, userId);
  kesim1.catch(() => {});
  kesim2.catch(() => {});
  // PENCERE ÖLÇÜMÜ: iki arka uç da BU topun satır kilidinde bekliyor mu? Bekleme
  // sayısı 2'ye ulaşmazsa yarış HİÇ KURULMADI ve §1'in sonucu yorumlanamaz.
  const bekleyenSayisi = async (): Promise<number> => {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n
      FROM pg_stat_activity a
      WHERE a.datname = current_database()
        AND a.pid <> pg_backend_pid()
        AND cardinality(pg_blocking_pids(a.pid)) > 0`;
    return Number(rows[0]?.n ?? 0);
  };
  let bekleyen = 0;
  const sonAn = Date.now() + 20_000;
  while (Date.now() < sonAn) {
    bekleyen = await bekleyenSayisi();
    if (bekleyen >= 2) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  check(
    "§1: PENCERE KURULDU — iki kesim de topun satır kilidinde bekliyor (yarış ölçülebilir)",
    bekleyen >= 2,
    bekleyen >= 2 ? `${bekleyen} arka uç bekliyor` : `YARIŞ ÖLÇÜLMEDİ: yalnız ${bekleyen} arka uç bekledi — aşağıdaki §1/§2 sonuçları yorumlanamaz`,
  );
  gateAc();
  await gateTx.catch(() => {});
  const sonuc = await Promise.allSettled([kesim1, kesim2]);
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

  // ═══ §6 — BAYAT OKUMA: eşzamanlı eksilme AŞIMA DÖNMEZ (niyet korunur) ═══
  // Pencere ELLE açılır: tx ÖNCESİ okuma kandırılır (ekran 100 m gösteriyor), tx İÇİNDE
  // satır kilidi altındaki gerçek kalan 40 m. Operatörün niyeti NORMAL kesimdir (80 ≤ 100);
  // kalan artık yetmediği için kesim 409 alır — aşım satırı yazılmaz, değişmez korunur.
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
  let red6: { statusCode?: number; details?: { code?: string } } | null = null;
  try {
    await tambur.cutWarehouseRoll(p5, { cutLength: 80 }, userId);
  } catch (e) {
    red6 = e as { statusCode?: number; details?: { code?: string } };
  } finally {
    (prisma.roll as unknown as { findUnique: FindUniqueFn }).findUnique = gercek;
  }
  check("§6: sonda bayat okumayı gerçekten enjekte etti", kandirildi);
  check("§6: ⭐ normal niyetli kesim AŞIMA DÖNMEDİ — 409 ROLL_CHANGED_DURING_CUT",
    red6?.statusCode === 409 && red6?.details?.code === "ROLL_CHANGED_DURING_CUT", JSON.stringify(red6?.details ?? null));
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
  check("§6: aşım satırı YAZILMADI, ikinci çocuk DOĞMADI", asim5 === 0 && cocuk5 === 60, `aşım ${asim5} m · çocuk ${cocuk5} m`);
  check(
    "§6: değişmez korundu — Σçocuk + kalan − Σaşım = 100",
    Math.abs(cocuk5 + kalan5 - asim5 - 100) < 0.001,
    `${cocuk5} + ${kalan5} − ${asim5} = ${cocuk5 + kalan5 - asim5}`,
  );

  // ═══ §7 — AÇIK KUMAŞ (cutOpenFabric): aynı NİYET kuralı (K-KES2, 2026-09-25) ═══
  // Eşzamanlı kesimler İŞ EMRİ satır kilidinde (touchWorkOrderTx) zaten SIRALANIR; kural
  // yokken ikinci kesim HER SEFERİNDE azalmış kalanı görüp aşıma dönüyordu (sha mesajında ölçüm).
  console.log("\n=== §7: açık kumaş — eşzamanlı kesim aşıma dönmez ===");
  const of1 = await acikKumas("OF1", 100);
  const s7 = await Promise.allSettled([
    tambur.cutOpenFabric(of1, { lengthMeters: 60, status: "WAREHOUSE" }),
    tambur.cutOpenFabric(of1, { lengthMeters: 60, status: "WAREHOUSE" }),
  ]);
  const ok7 = s7.filter((r) => r.status === "fulfilled").length;
  const red7 = s7.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  const cocuk7 = await cocuklar(of1);
  const kalan7 = Number((await prisma.roll.findUnique({ where: { id: of1 }, select: { currentQty: true } }))?.currentQty ?? 0);
  check("§7a ⭐ açık kumaş 60+60 (100 m): YALNIZ BİRİ geçti, kaybeden 409 ROLL_CHANGED_DURING_CUT",
    ok7 === 1 && (red7?.reason as { statusCode?: number; details?: { code?: string } })?.details?.code === "ROLL_CHANGED_DURING_CUT",
    `${ok7} başarılı · ${(red7?.reason as Error | undefined)?.message?.slice(0, 60) ?? "-"}`);
  check("§7a metraj korundu — Σçocuk + kalan = 100, aşım yok", Math.abs(cocuk7 + kalan7 - 100) < 0.001 && cocuk7 <= 100,
    `${cocuk7} + ${kalan7}`);

  const of2 = await acikKumas("OF2", 100);
  const s7b = await Promise.allSettled([
    tambur.cutOpenFabric(of2, { lengthMeters: 120, status: "WAREHOUSE" }),
    tambur.cutOpenFabric(of2, { lengthMeters: 120, status: "WAREHOUSE" }),
  ]);
  const ok7b = s7b.filter((r) => r.status === "fulfilled").length;
  const cocuk7b = await cocuklar(of2);
  check("§7b açık kumaş eşzamanlı aşım 120+120: yalnız biri geçti, YOKTAN KUMAŞ DOĞMADI (120 m)", ok7b === 1 && cocuk7b === 120,
    `${ok7b} başarılı · ${cocuk7b} m çocuk`);
  let ardisik = false;
  try {
    await tambur.cutOpenFabric(of2, { lengthMeters: 30, status: "WAREHOUSE" });
    ardisik = true;
  } catch { /* aşağıda raporlanır */ }
  check("§7c 0'a inmiş açık kumaşta ARDIŞIK aşım kesimi hâlâ serbest", ardisik);
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
  // ⚠️ `warehouseMovement` SİLİNMİYORDU ve her silme `.catch(() => {})` ile
  // susturulmuştu: kesim yolu stok defterine satır yazdığı için `roll.deleteMany`
  // `warehouse_movements_rollId_fkey`e (Restrict) çarpıyor, hata yutuluyor ve
  // FİKSTÜR KALIYORDU. Ölçüldü 2026-09-13: 88 deposuz `TST-TCC-*` stok topu
  // birikmişti ve `test_consistency §29` ile `test_roll_warehouse_stamp` onu
  // raporluyordu — yani temizliğin sessiz başarısızlığı İKİ bekçiyi kırmızı
  // tutuyordu. Sıra: ters satırlar (self-FK `Restrict`) → hareketler → sapma.
  await prisma.warehouseMovement.deleteMany({ where: { reversesMovement: { rollId: { in: ids } } } }).catch(() => {});
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { parentRollId: { in: ids } } }).catch(() => {});
  // ⚠️ SON ADIM SUSTURULMAZ: buraya kadar her şey silindiyse bu çağrı başarılı
  // olmak ZORUNDA. Yutulursa artık sessizce kalır ve başka bekçiyi kırmızı yapar
  // (yukarıdaki 88 top tam bu yüzden birikti) — temizlik başarısızlığı GÖRÜNÜR olur.
  const kalan = await prisma.roll
    .deleteMany({ where: { id: { in: ids } } })
    .then(() => null)
    .catch((e: Error) => e.message.replace(/\s+/g, " ").slice(-200));
  if (kalan) {
    fail++;
    console.error(`❌ Temizlik YARIDA KALDI — deposuz fikstür topu bırakıldı: ${kalan}`);
  }
  if (itemId) await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
  if (woIds.length) {
    const adimIds = (await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } }).catch(() => [])).map((x) => x.id);
    await prisma.rollOperation.deleteMany({ where: { workOrderStepId: { in: adimIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});
  }
  if (olusanIstasyon) await prisma.station.deleteMany({ where: { id: olusanIstasyon } }).catch(() => {});
  if (olusanKalite) await prisma.qualityGrade.deleteMany({ where: { id: olusanKalite } }).catch(() => {});
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
