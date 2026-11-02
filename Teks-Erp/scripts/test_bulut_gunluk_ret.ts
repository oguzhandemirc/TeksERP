// =============================================================================
// BEKÇİ — PATRON BULUTU GÜNLÜK ANLIK RETTE YENİDEN DENEME + RET LOGU (`cloud-sync.job.ts`, `daily-retry.ts`)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts bulut_gunluk_ret   (kendi _test DB'si; ~30 sn)
//
// Vaka (2026-11-02, deneme sunucusu): bulut eski katalogla `ozet-masraf`ı tanımadı → saatlik
// "eşitleme turu KISMI (ret)" ve hangi projeksiyonun reddedildiği logda yoktu. Günlük anlık ret
// alsaydı gün "tamam" işaretlenip o gün bir daha denenmeyecekti (sessiz kayıp).
//
// NE ÖLÇER (iş tık'ı SAHTE BULUTA karşı; lisans saat seddi ileri sıçramayı reddettiği için zaman
// iş durumunu yaşlandırarak ilerletilir — `__ageCloudSyncStateForTests`):
//   §1 ⭐ ret logu reddedilen projeksiyon + bulut kodunu yazar; buluttan gelen tuhaf metin loga girmez
//   §2 ⭐ ret alan GUNLUK anlık geri çekilme dolmadan yeniden gitmez
//   §3 ⭐ geri çekilme dolunca yalnız o anlık yeniden gider; aynı KISMI satırı tekrar yazılmaz
//   §4 ⭐ bulut kabul edince işaret yazılır, defter boşalır, bir daha gitmez
//   §5 saf: başarılı ad defterden düşer (yeniden gönderilmez); gecikme 1→2→4→8 sa tavan
//   §6 gün dönünce tüm GUNLUK gider, defter sıfırlanır (deneme sayısı 1'den)
//   §7 ⭐ başarılı yol aynen: ret yoksa günlük anlık günde bir kez, yeniden deneme logu yok
//
// NEGATİF SONDA — dosya DIŞI mutasyon (cp + shasum ile birebir geri alındı; commit mesajında):
//   N1 iş `settleDaily` çağrısı kaldırılır (eski davranış: gün tamam)     → §1d · §3a · §3b · §4a · §6a · §6b ❌ (16/6)
//   N2 `describeRoundProblem` hep "ret" döner (eski log)                  → §1b · §1e ❌ (20/2)
//   N3 KISMI tekrar bastırması kaldırılır                               → §3c ❌ (21/1)
//   N4 `settleDailyRetry` ret bakmadan her denenen adı defterde tutar      → §5b · §4c · §7b ❌ (19/3)
// =============================================================================
import fs from "node:fs";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuditService } from "../src/services/audit.service";
import { egressCloudTransport } from "../src/cloud-sync/cloud-client";
import { wmKey } from "../src/cloud-sync/watermarks";
import { runCloudSyncTick, __ageCloudSyncStateForTests, __configureCloudSyncForTests } from "../src/jobs/cloud-sync.job";
import { DAILY_RETRY_MAX_MS, DAILY_SNAPSHOT_NAMES, dailyRetryDelayMs, describeRoundProblem, dueDailyRetries, settleDailyRetry, type DailyRetryEntry } from "../src/cloud-sync/daily-retry";
import { bulutLisansKur, sahteBulutBaslat, type SahteBulut, type BulutLisans } from "./lib/bulut-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

AuditService.logEvent = async () => undefined;
AuditService.log = async () => undefined;

const GUNLUK = "rapor-katalogu";
const KOD = "PROJEKSIYON_BILINMIYOR";
const MIN = 60_000;

// Log yakalama: patron-bulut satırları ayrıca toplanır (konsola da düşer).
const loglar: string[] = [];
const asilWarn = console.warn.bind(console);
const asilLog = console.log.bind(console);
console.warn = (...a: unknown[]) => {
  const s = a.map(String).join(" ");
  if (s.includes("[patron-bulut]")) loglar.push(s);
  asilWarn(...a);
};
console.log = (...a: unknown[]) => {
  const s = a.map(String).join(" ");
  if (s.includes("[patron-bulut]")) loglar.push(s);
  asilLog(...a);
};

async function temizle(): Promise<void> {
  await prisma.syncWatermark.deleteMany({});
  await prisma.syncMark.deleteMany({});
}

/** `ileriMs` kadar zaman geçmiş sayılır, tık koşar; dönen: giden ARTIMLI paketlerdeki anlık adları + yeni log satırları. */
async function tik(bulut: SahteBulut, ileriMs: number, yeniGun = false): Promise<{ anliklar: Set<string>; paket: number; log: string[] }> {
  const p0 = bulut.paketler.length;
  const l0 = loglar.length;
  __ageCloudSyncStateForTests(ileriMs, { newDay: yeniGun });
  await runCloudSyncTick(Date.now());
  const yeni = bulut.paketler.slice(p0).filter((p) => p.tur === "ARTIMLI");
  return { anliklar: new Set(yeni.flatMap((p) => p.anliklar.map((a) => a.projeksiyon))), paket: yeni.length, log: loglar.slice(l0) };
}

async function isaretVar(ad: string): Promise<boolean> {
  return (await prisma.syncWatermark.count({ where: { source: wmKey.snapshot(ad) } })) > 0;
}

async function retBolumu(bulut: SahteBulut): Promise<void> {
  console.log("\n§1–§4 — günlük anlık ret → geri çekilmeli yeniden deneme");
  __configureCloudSyncForTests({ transport: egressCloudTransport, reset: true });
  bulut.mod.anlikRet.set(GUNLUK, KOD);
  const r1 = await tik(bulut, 0);
  const kismi = r1.log.filter((l) => l.includes("eşitleme turu KISMI"));
  check("§1a ilk tur günlük anlığı taşır (körlük zemini)", r1.anliklar.has(GUNLUK), [...r1.anliklar].join(","));
  check("§1b ⭐ KISMI satırı reddedilen projeksiyonu ve bulut kodunu yazar", kismi.some((l) => l.includes(`${GUNLUK}=${KOD}`)), kismi.join(" | "));
  check("§1c ret alan anlığın işareti YAZILMAZ", !(await isaretVar(GUNLUK)));
  check("§1d ⭐ yeniden deneme 60 dk sonraya kurulur (deneme 1)", r1.log.some((l) => l.includes(`günlük anlık ${GUNLUK} buluta geçmedi — 60 dk`) && l.includes("deneme 1")), r1.log.join(" | "));
  check("§1e buluttan gelen biçimsiz metin loga girmez", describeRoundProblem({ reason: null, rejected: [{ projection: "x{\"a\":1}", code: "kod; DROP" }], unaccepted: [] }) === "ret: ?=?");

  const r2 = await tik(bulut, 5 * MIN + 1000);
  check("§2 ⭐ geri çekilme dolmadan (5 dk) tur var ama günlük anlık YOK", r2.paket > 0 && !r2.anliklar.has(GUNLUK), `${r2.paket} paket · ${[...r2.anliklar].join(",")}`);

  const r3 = await tik(bulut, 56 * MIN);
  check("§3a ⭐ 60 dk dolunca günlük anlık yeniden gider", r3.anliklar.has(GUNLUK), [...r3.anliklar].join(","));
  check("§3b ⭐ ikinci ret → 120 dk geri çekilme (deneme 2)", r3.log.some((l) => l.includes("120 dk") && l.includes("deneme 2")), r3.log.join(" | "));
  check("§3c ⭐ aynı KISMI satırı 6 sa içinde yeniden YAZILMAZ (saatlik log yağmuru yok)", !r3.log.some((l) => l.includes("eşitleme turu KISMI")), r3.log.join(" | "));
  const r3b = await tik(bulut, 61 * MIN);
  check("§3d geri çekilme (120 dk) dolmadan yeniden gitmez", !r3b.anliklar.has(GUNLUK));

  bulut.mod.anlikRet.clear();
  const r4 = await tik(bulut, 60 * MIN);
  check("§4a ⭐ bulut düzelince günlük anlık gider ve kabul edilir", r4.anliklar.has(GUNLUK) && (await isaretVar(GUNLUK)), [...r4.anliklar].join(","));
  const r5 = await tik(bulut, 6 * MIN);
  check("§4b ⭐ kabulden sonra aynı gün bir daha gitmez", !r5.anliklar.has(GUNLUK));
  const r6 = await tik(bulut, 245 * MIN);
  check("§4c defter boş: 4 sa sonra da gitmez, yeni deneme logu yok", !r6.anliklar.has(GUNLUK) && !r6.log.some((l) => l.includes("buluta geçmedi")));

  console.log("\n§6 — gün dönümü defteri sıfırlar");
  await prisma.syncWatermark.deleteMany({ where: { source: wmKey.snapshot(GUNLUK) } });
  bulut.mod.anlikRet.set(GUNLUK, KOD);
  const g1 = await tik(bulut, 6 * MIN, true);
  check("§6a ⭐ yeni gün tüm GUNLUK'u gönderir, ret → deneme 1 / 60 dk (dünkü sayaç taşınmaz)", g1.anliklar.has(GUNLUK) && g1.log.some((l) => l.includes("60 dk") && l.includes("deneme 1")), g1.log.join(" | "));
  const g2 = await tik(bulut, 61 * MIN);
  const g3 = await tik(bulut, 6 * MIN, true);
  check("§6b ⭐ deneme 2'deyken gün dönerse sayaç 1'e iner (60 dk)", g2.log.some((l) => l.includes("deneme 2")) && g3.anliklar.has(GUNLUK) && g3.log.some((l) => l.includes("60 dk") && l.includes("deneme 1")), [...g2.log, ...g3.log].join(" | "));
  bulut.mod.anlikRet.clear();
}

function safBolum(): void {
  console.log("\n§5 — saf: defter kuralları");
  const iki = [...DAILY_SNAPSHOT_NAMES];
  check("§5a körlük zemini: en az iki GUNLUK anlık var", iki.length >= 2 && DAILY_SNAPSHOT_NAMES.has(GUNLUK), iki.join(","));
  const diger = iki.find((n) => n !== GUNLUK)!;
  const defter = new Map<string, DailyRetryEntry>([[GUNLUK, { attempts: 2, nextAt: 0 }]]);
  settleDailyRetry(defter, iki, { rejected: [{ projection: diger, code: KOD }] }, 1000);
  check("§5b ⭐ kabul edilen ad defterden düşer, yalnız ret alan kalır", !defter.has(GUNLUK) && defter.get(diger)?.attempts === 1, JSON.stringify([...defter]));
  check("§5c zamanı gelmeyen deneme listelenmez, gelen listelenir", dueDailyRetries(defter, 1000).length === 0 && dueDailyRetries(defter, 1000 + dailyRetryDelayMs(1))[0] === diger);
  check("§5d gecikme 1 → 2 → 4 sa, tavan 8 sa (sonsuz sık deneme yok)", dailyRetryDelayMs(1) === 60 * MIN && dailyRetryDelayMs(2) === 120 * MIN && dailyRetryDelayMs(3) === 240 * MIN && dailyRetryDelayMs(9) === DAILY_RETRY_MAX_MS && DAILY_RETRY_MAX_MS === 480 * MIN);
  const kayit = new Map<string, DailyRetryEntry>();
  settleDailyRetry(kayit, ["ozet-masraf"], { rejected: [{ projection: "ozet-masraf", code: KOD }] }, 0);
  check("§5e GUNLUK olmayan anlık deftere girmez (kendi sıklığıyla zaten yeniden gider)", kayit.size === 0);
}

async function basariliYol(bulut: SahteBulut): Promise<void> {
  console.log("\n§7 — başarılı yol aynen");
  await temizle();
  __configureCloudSyncForTests({ transport: egressCloudTransport, reset: true });
  const a = await tik(bulut, 0);
  const b = await tik(bulut, 61 * MIN);
  const c = await tik(bulut, 124 * MIN);
  check("§7a ⭐ ret yoksa günlük anlık ilk turda bir kez gider", a.anliklar.has(GUNLUK) && !b.anliklar.has(GUNLUK) && !c.anliklar.has(GUNLUK));
  check("§7b yeniden deneme ve KISMI logu yok", ![...a.log, ...b.log, ...c.log].some((l) => l.includes("buluta geçmedi") || l.includes("KISMI")));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(`⛔ DURDURULDU — ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== PATRON BULUTU GÜNLÜK ANLIK RET ===");
  let bulut: SahteBulut | null = null;
  let lisans: BulutLisans | null = null;
  try {
    await temizle();
    lisans = await bulutLisansKur();
    bulut = await sahteBulutBaslat(lisans.x);
    safBolum();
    await retBolumu(bulut);
    await basariliYol(bulut);
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    __configureCloudSyncForTests({ reset: true });
    await bulut?.kapat();
    await temizle().catch(() => undefined);
    if (lisans) fs.rmSync(lisans.dizin, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end().catch(() => undefined);
  process.exitCode = fail > 0 ? 1 : 0;
}

void main();
