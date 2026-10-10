// =============================================================================
// Vardiya takvimi job'u bekçisi — `jobs/shift-calendar.job.ts` (dokuma raporları Dilim 1)
// =============================================================================
// Koşum: npx tsx scripts/test_shift_calendar_job.ts   (DB'li; kendi fikstürü, TEST- öneki)
//
// Ölçer:
//   §0 statik — bayrak okuması job'un İLK ifadesi; server.ts zamanlayıcıyı başlatıyor
//   §1 bayrak KAPALI → "disabled", `shift_instances` satırı DOĞMAZ (referans fabrika sıfır fark)
//   §2 bayrak AÇIK → 30 gün ileri; pencere `constants/time.ts`ten (fabrika günü), gece yarısını
//      geçen vardiya BAŞLADIĞI güne yazılır; `factoryDayKey` UTC gece yarısı
//   §3 İDEMPOTENT — ikinci koşum 0 yeni satır (sed `@@unique`; advisory kilit yok)
//   §4 haftagünü süzgeci — boş dizi HER GÜN, dolu dizi yalnız o günler
//   §5 tanım değişince MÜHÜRSÜZ pencere yeniden yazılır (satır silinmez, id korunur);
//      karnesi MÜHÜRLÜ pencere DEĞİŞMEZ (`updateMany` claim'i, count 0 → sealedSkipped)
//   §6 iptal edilmiş pencere korunur (isCancelled dokunulmaz, ikinci satır doğmaz)
//   §7 pasife alınan tanım için yeni pencere doğmaz, mevcut satırlar silinmez; başlamamış
//      pencere takvim sebebiyle İPTAL edilir
//   §8 YALNIZ İLERİ — başlamış pencere tanım değişince yeniden yazılmaz; yeni tanımın
//      başlamış (geçmiş) penceresi sonradan doğmaz
//   §9 haftagünü düşünce gelecek pencere takvim sebebiyle iptal, geri gelince DİRİLİR;
//      insan iptali (tatil) iki yönde de korunur
//
// NEGATİF SONDALAR (kırmızı görülerek, 2026-09-14):
//   · job'dan `readDokumaEnabled` kapısı kaldırılınca §1a/§1b ❌ (82 satır doğdu)
//   · `updateMany` yükleminden `machineStats: { none: SEALED }` düşürülünce §5a/§5c ❌
//   · (2026-10-10) plandan "başlamış" dalı + yüklemden `startsAt: { gt: now }` düşürülünce §8a ❌;
//     plandaki retire döngüsü kaldırılınca §7c/§9a ❌; diriliş dalı kaldırılınca §9b ❌
//   ⚠️ ÖLÇÜLDÜ, TUTMADI: test DB'de `shift_instances_shiftDefinitionId_factoryDayKey_key` DROP
//     edilince bu bekçi 23/0 YEŞİL KALDI — job'un `findUnique` ön kontrolü sıralı koşumda tek
//     başına yeter, sed yalnız YARIŞ penceresini kapatır ve bu bekçi yarış kurmaz. Sedin varlığı
//     `test_schema_drift` (Prisma `@@unique` ↔ DB) ile ölçülür; burada ölçülmüyor diye beyan edildi.
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { runShiftCalendarOnce, SHIFT_CALENDAR_DAYS_AHEAD } from "../src/jobs/shift-calendar.job";
import { SHIFT_CALENDAR_CANCEL_REASON } from "../src/services/helpers/shift-calendar-plan.helper";
import { factoryDayKeyUtcMidnight, factoryDayStart, factoryMinuteOfDay, factoryWeekday } from "../src/constants/time";

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

const FLAG_KEY = "dokuma.enabled";
const STAMP_KEY = "dokuma.shiftCalendarLastRunAt";
let originalFlag: unknown = undefined; // undefined = satır yoktu
let flagTouched = false;
let stampExisted = false;

async function setFlag(value: boolean): Promise<void> {
  if (!flagTouched) {
    const row = await prisma.systemSetting.findUnique({ where: { key: FLAG_KEY } });
    originalFlag = row ? row.value : undefined;
    flagTouched = true;
  }
  await prisma.systemSetting.upsert({
    where: { key: FLAG_KEY },
    create: { key: FLAG_KEY, value, description: "Dokuma modülü (bekçi geçici yazımı)" },
    update: { value },
  });
}

const ek = Date.now().toString(36);
const ids = { station: "", machine: "", defHerGun: "", defHaftaIci: "", defGece: "", defYeni: "", statIds: [] as string[] };

async function main(): Promise<void> {
  console.log("\n=== Vardiya takvimi job'u — bayrak kapısı, 30 gün, idempotent, mühür saygısı ===\n");

  // ── §0 statik ─────────────────────────────────────────────────────────────
  const jobSrc = readFileSync(join(__dirname, "../src/jobs/shift-calendar.job.ts"), "utf8");
  const gate = jobSrc.indexOf("readDokumaEnabled()");
  const firstPrisma = jobSrc.indexOf("prisma.", jobSrc.indexOf("export async function runShiftCalendarOnce"));
  check("§0a bayrak okuması job'un İLK ifadesi (prisma'ya dokunmadan)", gate > 0 && gate < firstPrisma);
  const serverSrc = readFileSync(join(__dirname, "../src/server.ts"), "utf8");
  check("§0b server.ts zamanlayıcıyı başlatıyor", /startShiftCalendarScheduler\(\)/.test(serverSrc));

  stampExisted = !!(await prisma.systemSetting.findUnique({ where: { key: STAMP_KEY } }));

  // ── fikstür ───────────────────────────────────────────────────────────────
  const station = await prisma.station.create({
    data: { name: `TEST-SC-IST-${ek}`, code: `TEST-SC-S-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "PROCESS_QC", isActive: true },
  });
  ids.station = station.id;
  const machine = await prisma.machine.create({
    data: { stationId: station.id, name: `TEST-SC-MAK-${ek}`, code: `TEST-SC-M-${ek}`.toUpperCase().slice(0, 32), isActive: true },
  });
  ids.machine = machine.id;
  const defHerGun = await prisma.shiftDefinition.create({
    data: { code: `A${ek}`.toUpperCase().slice(0, 8), name: `TEST-SC her gün ${ek}`, startMinute: 8 * 60, durationMinutes: 8 * 60 },
  });
  ids.defHerGun = defHerGun.id;
  const defHaftaIci = await prisma.shiftDefinition.create({
    data: { code: `B${ek}`.toUpperCase().slice(0, 8), name: `TEST-SC hafta içi ${ek}`, startMinute: 16 * 60, durationMinutes: 8 * 60, activeWeekdays: [1, 2, 3, 4, 5] },
  });
  ids.defHaftaIci = defHaftaIci.id;
  const defGece = await prisma.shiftDefinition.create({
    data: { code: `C${ek}`.toUpperCase().slice(0, 8), name: `TEST-SC gece ${ek}`, startMinute: 23 * 60, durationMinutes: 8 * 60 },
  });
  ids.defGece = defGece.id;
  const scope = { onlyDefinitionIds: [defHerGun.id, defHaftaIci.id, defGece.id] };
  const mine = { shiftDefinitionId: { in: scope.onlyDefinitionIds } };

  // ── §1 bayrak KAPALI ──────────────────────────────────────────────────────
  await setFlag(false);
  const kapali = await runShiftCalendarOnce(scope);
  check("§1a bayrak KAPALI → 'disabled'", kapali === "disabled", JSON.stringify(kapali));
  check("§1b bayrak KAPALIYKEN satır DOĞMAZ", (await prisma.shiftInstance.count({ where: mine })) === 0);

  // ── §2 bayrak AÇIK → 30 gün ───────────────────────────────────────────────
  await setFlag(true);
  // Fabrika gününün 00:01'i: bugünün pencereleri (08/16/23) henüz BAŞLAMAMIŞ — "yalnız ileri"
  // kuralı §2–§7'nin sayılarını saate bağlamasın; başlamış pencere §8'de ayrıca ölçülür.
  const now = new Date(factoryDayStart(new Date()).getTime() + 60_000);
  const r1 = await runShiftCalendarOnce({ ...scope, now });
  if (r1 === "disabled") throw new Error("bayrak açıkken disabled döndü");
  const gunler = Array.from({ length: SHIFT_CALENDAR_DAYS_AHEAD }, (_, i) => new Date(factoryDayStart(now).getTime() + i * 86_400_000 + 12 * 3600_000));
  const haftaIciBeklenen = gunler.filter((g) => [1, 2, 3, 4, 5].includes(factoryWeekday(g))).length;
  const beklenenToplam = SHIFT_CALENDAR_DAYS_AHEAD * 2 + haftaIciBeklenen;
  check(`§2a ${SHIFT_CALENDAR_DAYS_AHEAD} gün ileri yazıldı (her gün ×2 + hafta içi ${haftaIciBeklenen})`, r1.created === beklenenToplam, JSON.stringify(r1));
  const herGun = await prisma.shiftInstance.findMany({ where: { shiftDefinitionId: defHerGun.id }, orderBy: { factoryDayKey: "asc" } });
  check("§2b her-gün tanımı 30 pencere", herGun.length === SHIFT_CALENDAR_DAYS_AHEAD, String(herGun.length));
  const ilk = herGun[0];
  const bugunKey = factoryDayKeyUtcMidnight(now);
  check("§2c ilk pencere BUGÜNÜN fabrika günü, `factoryDayKey` UTC gece yarısı", !!ilk && ilk.factoryDayKey.getTime() === bugunKey.getTime(),
    ilk ? `${ilk.factoryDayKey.toISOString()} ↔ ${bugunKey.toISOString()}` : "satır yok");
  check("§2d pencere = fabrika günü 08:00–16:00 (constants/time.ts)", !!ilk
    && ilk.startsAt.getTime() === factoryMinuteOfDay(now, 8 * 60).getTime()
    && ilk.endsAt.getTime() === factoryMinuteOfDay(now, 16 * 60).getTime(),
    ilk ? `${ilk.startsAt.toISOString()} → ${ilk.endsAt.toISOString()}` : "");
  const gece = await prisma.shiftInstance.findFirst({ where: { shiftDefinitionId: defGece.id, factoryDayKey: bugunKey } });
  check("§2e gece yarısını geçen vardiya BAŞLADIĞI güne yazılır (23:00 → ertesi 07:00)", !!gece
    && gece.startsAt.getTime() === factoryMinuteOfDay(now, 23 * 60).getTime()
    && gece.endsAt.getTime() === factoryMinuteOfDay(now, 31 * 60).getTime()
    && gece.endsAt.getTime() - gece.startsAt.getTime() === 8 * 3600_000,
    gece ? `${gece.startsAt.toISOString()} → ${gece.endsAt.toISOString()}` : "satır yok");
  const stamp = await prisma.systemSetting.findUnique({ where: { key: STAMP_KEY } });
  check("§2f son koşum damgası SystemSetting'te", stamp?.value === now.toISOString());

  // ── §3 idempotent ─────────────────────────────────────────────────────────
  const r2 = await runShiftCalendarOnce({ ...scope, now });
  if (r2 === "disabled") throw new Error("disabled");
  check("§3a ikinci koşum 0 yeni satır", r2.created === 0 && r2.rewritten === 0, JSON.stringify(r2));
  check("§3b ikinci koşum her pencereyi 'unchanged' sayar", r2.unchanged === beklenenToplam, String(r2.unchanged));
  check("§3c toplam satır sayısı DEĞİŞMEDİ", (await prisma.shiftInstance.count({ where: mine })) === beklenenToplam);

  // ── §4 haftagünü ──────────────────────────────────────────────────────────
  const haftaIci = await prisma.shiftInstance.findMany({ where: { shiftDefinitionId: defHaftaIci.id } });
  check(`§4a hafta içi tanımı yalnız Pzt–Cum (${haftaIciBeklenen})`, haftaIci.length === haftaIciBeklenen, String(haftaIci.length));
  check("§4b hafta içi pencerelerinin hiçbiri hafta sonuna düşmez",
    haftaIci.every((s) => [1, 2, 3, 4, 5].includes(factoryWeekday(new Date(s.startsAt.getTime() + 60_000)))));

  // ── §5 tanım değişince ────────────────────────────────────────────────────
  // Mühürlü karne: ilk pencereye SEALED satır (Dilim 3'ün yazarı yok, fikstür doğrudan yazar).
  const stat = await prisma.machineShiftStat.create({
    data: {
      machineId: machine.id, shiftInstanceId: ilk!.id, factoryDay: ilk!.factoryDayKey,
      stopThresholdSec: 180, source: "OPERATOR", monitoringState: "OFF",
      sealState: "SEALED", sealGeneration: 1, sealedAt: new Date(),
    },
  });
  ids.statIds.push(stat.id);
  await prisma.shiftDefinition.update({ where: { id: defHerGun.id }, data: { durationMinutes: 9 * 60 } });
  const r3 = await runShiftCalendarOnce({ ...scope, now });
  if (r3 === "disabled") throw new Error("disabled");
  check("§5a tanım değişince MÜHÜRSÜZ pencereler yeniden yazıldı (29)", r3.rewritten === SHIFT_CALENDAR_DAYS_AHEAD - 1, JSON.stringify(r3));
  check("§5b satır SİLİNMEDİ, id korundu", (await prisma.shiftInstance.count({ where: { id: { in: herGun.map((s) => s.id) } } })) === SHIFT_CALENDAR_DAYS_AHEAD);
  const ilkSonra = await prisma.shiftInstance.findUnique({ where: { id: ilk!.id } });
  check("§5c MÜHÜRLÜ pencere DEĞİŞMEDİ (sealedSkipped 1)", r3.sealedSkipped === 1 && ilkSonra!.endsAt.getTime() === ilk!.endsAt.getTime(),
    `sealedSkipped=${r3.sealedSkipped}`);
  const ikinci = await prisma.shiftInstance.findUnique({ where: { id: herGun[1]!.id } });
  check("§5d mühürsüz pencerenin bitişi yeni süreyle (17:00)", ikinci!.endsAt.getTime() === factoryMinuteOfDay(new Date(herGun[1]!.startsAt.getTime() + 60_000), 17 * 60).getTime(),
    ikinci!.endsAt.toISOString());

  // ── §6 iptal korunur ──────────────────────────────────────────────────────
  await prisma.shiftInstance.update({ where: { id: herGun[2]!.id }, data: { isCancelled: true, cancelReason: "TEST-SC tatil" } });
  await prisma.shiftDefinition.update({ where: { id: defHerGun.id }, data: { startMinute: 9 * 60 } });
  const r4 = await runShiftCalendarOnce({ ...scope, now });
  if (r4 === "disabled") throw new Error("disabled");
  const iptal = await prisma.shiftInstance.findUnique({ where: { id: herGun[2]!.id } });
  check("§6a iptal bayrağı ve sebebi korunur (pencere yeniden yazılsa da)", iptal!.isCancelled && iptal!.cancelReason === "TEST-SC tatil"
    && iptal!.startsAt.getTime() === factoryMinuteOfDay(new Date(herGun[2]!.startsAt.getTime() + 60_000), 9 * 60).getTime());
  check("§6b iptal pencere için İKİNCİ satır doğmadı", (await prisma.shiftInstance.count({ where: { shiftDefinitionId: defHerGun.id, factoryDayKey: iptal!.factoryDayKey } })) === 1);

  // ── §7 pasif tanım ────────────────────────────────────────────────────────
  await prisma.shiftDefinition.update({ where: { id: defHaftaIci.id }, data: { isActive: false } });
  // İlk haftadan sonrasını boşalt: job isActive'e bakmasaydı burada yeniden doğururdu (§7a);
  // ilk haftanın satırları (≥ 4 hafta içi, haftanın gününden bağımsız) §7c'nin iptal ölçüsüdür.
  await prisma.shiftInstance.deleteMany({ where: { shiftDefinitionId: defHaftaIci.id, factoryDayKey: { gt: new Date(bugunKey.getTime() + 7 * 86_400_000) } } });
  const kalanOnce = await prisma.shiftInstance.count({ where: { shiftDefinitionId: defHaftaIci.id } });
  const r5 = await runShiftCalendarOnce({ ...scope, now });
  if (r5 === "disabled") throw new Error("disabled");
  check("§7a pasif tanım için yeni pencere DOĞMAZ", r5.created === 0 && haftaIciBeklenen > 1, JSON.stringify(r5));
  check("§7b pasif tanımın mevcut satırı SİLİNMEZ", (await prisma.shiftInstance.count({ where: { shiftDefinitionId: defHaftaIci.id } })) === kalanOnce, `${kalanOnce} satır`);
  const pasifAcik = await prisma.shiftInstance.count({ where: { shiftDefinitionId: defHaftaIci.id, isCancelled: false, startsAt: { gt: now } } });
  check("§7c pasif tanımın BAŞLAMAMIŞ penceresi takvim sebebiyle iptal (açık kalan 0)", pasifAcik === 0 && kalanOnce >= 4 && r5.retired === kalanOnce,
    `retired=${r5.retired} kalan=${kalanOnce} açık=${pasifAcik}`);

  // ── §8 yalnız ileri ───────────────────────────────────────────────────────
  const gece2330 = factoryMinuteOfDay(now, 23 * 60 + 30); // bugünün gece penceresi (23:00) BAŞLAMIŞ
  const geceBugun = await prisma.shiftInstance.findFirstOrThrow({ where: { shiftDefinitionId: defGece.id, factoryDayKey: bugunKey } });
  await prisma.shiftDefinition.update({ where: { id: defGece.id }, data: { durationMinutes: 7 * 60 } });
  const r6 = await runShiftCalendarOnce({ ...scope, now: gece2330 });
  if (r6 === "disabled") throw new Error("disabled");
  const geceSonra = await prisma.shiftInstance.findUniqueOrThrow({ where: { id: geceBugun.id } });
  check("§8a BAŞLAMIŞ pencere tanım değişince yeniden YAZILMAZ (startedSkipped)", r6.startedSkipped >= 1
    && geceSonra.endsAt.getTime() === geceBugun.endsAt.getTime(), JSON.stringify(r6));
  const geceYarin = await prisma.shiftInstance.findFirstOrThrow({ where: { shiftDefinitionId: defGece.id, factoryDayKey: { gt: bugunKey } }, orderBy: { factoryDayKey: "asc" } });
  check("§8b başlamamış pencere yeni süreyle (7 sa)", geceYarin.endsAt.getTime() - geceYarin.startsAt.getTime() === 7 * 3600_000);
  const defYeni = await prisma.shiftDefinition.create({
    data: { code: `D${ek}`.toUpperCase().slice(0, 8), name: `TEST-SC yeni ${ek}`, startMinute: 6 * 60, durationMinutes: 8 * 60 },
  });
  ids.defYeni = defYeni.id;
  const saat10 = factoryMinuteOfDay(now, 10 * 60);
  const r7 = await runShiftCalendarOnce({ onlyDefinitionIds: [defYeni.id], now: saat10 });
  if (r7 === "disabled") throw new Error("disabled");
  const gecmis = await prisma.shiftInstance.count({ where: { shiftDefinitionId: defYeni.id, startsAt: { lte: saat10 } } });
  check("§8c yeni tanımın BAŞLAMIŞ penceresi sonradan doğmaz (bugün 06:00, saat 10:00)", gecmis === 0 && r7.created === SHIFT_CALENDAR_DAYS_AHEAD - 1,
    JSON.stringify(r7));

  // ── §9 haftagünü düşer → iptal; geri gelir → diriliş; insan iptali korunur ─
  const yarinGun = factoryWeekday(new Date(now.getTime() + 36 * 3600_000));
  const kalanGunler = [0, 1, 2, 3, 4, 5, 6].filter((g) => g !== yarinGun);
  await prisma.shiftDefinition.update({ where: { id: defHerGun.id }, data: { activeWeekdays: kalanGunler } });
  const r8 = await runShiftCalendarOnce({ ...scope, now });
  if (r8 === "disabled") throw new Error("disabled");
  const dusen = await prisma.shiftInstance.findMany({ where: { shiftDefinitionId: defHerGun.id, cancelReason: SHIFT_CALENDAR_CANCEL_REASON } });
  const beklenenDusen = gunler.filter((g) => factoryWeekday(g) === yarinGun).length - (factoryWeekday(new Date(herGun[2]!.startsAt.getTime() + 60_000)) === yarinGun ? 1 : 0);
  check("§9a düşen haftagününün gelecek pencereleri takvim sebebiyle İPTAL (satır silinmez)", dusen.length === beklenenDusen && r8.retired >= beklenenDusen
    && dusen.every((w) => factoryWeekday(new Date(w.startsAt.getTime() + 60_000)) === yarinGun), `${dusen.length}/${beklenenDusen} ${JSON.stringify(r8)}`);
  await prisma.shiftDefinition.update({ where: { id: defHerGun.id }, data: { activeWeekdays: [] } });
  const r9 = await runShiftCalendarOnce({ ...scope, now });
  if (r9 === "disabled") throw new Error("disabled");
  const dirilen = await prisma.shiftInstance.count({ where: { id: { in: dusen.map((w) => w.id) }, isCancelled: false, cancelReason: null } });
  check("§9b haftagünü geri gelince takvim iptali DİRİLİR (aynı satır)", dirilen === dusen.length && r9.rewritten >= dusen.length, `${dirilen}/${dusen.length}`);
  const tatil = await prisma.shiftInstance.findUniqueOrThrow({ where: { id: herGun[2]!.id } });
  check("§9c insan iptali (tatil) dirilişte KORUNUR", tatil.isCancelled && tatil.cancelReason === "TEST-SC tatil");
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    try {
      if (ids.statIds.length) await prisma.machineShiftStat.deleteMany({ where: { id: { in: ids.statIds } } });
      const defIds = [ids.defHerGun, ids.defHaftaIci, ids.defGece, ids.defYeni].filter(Boolean);
      if (defIds.length) {
        await prisma.shiftInstance.deleteMany({ where: { shiftDefinitionId: { in: defIds } } });
        await prisma.shiftDefinition.deleteMany({ where: { id: { in: defIds } } });
      }
      if (ids.machine) await prisma.machine.delete({ where: { id: ids.machine } });
      if (ids.station) await prisma.station.delete({ where: { id: ids.station } });
      if (!stampExisted) await prisma.systemSetting.deleteMany({ where: { key: STAMP_KEY } });
      if (flagTouched) {
        if (originalFlag === undefined) await prisma.systemSetting.deleteMany({ where: { key: FLAG_KEY } });
        else await prisma.systemSetting.update({ where: { key: FLAG_KEY }, data: { value: originalFlag as Prisma.InputJsonValue } });
      }
    } catch (e) {
      console.error("temizlik hatası:", e);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
