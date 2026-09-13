// =============================================================================
// Bekçi: `machine_stop_events` + vardiya + toplayıcı — dokuma P2b-1 (2026-09-13)
// Çalıştır: npx tsx scripts/run-all-tests.ts machine_stop
// =============================================================================
// NE ÖLÇÜYOR:
//   §1 AÇIK DURUŞ SEDDİ  makine başına TEK açık duruş; ve sed fazla GENİŞ değil
//                        (kapanmış duruştan sonra yenisi açılabilir, başka makine
//                        serbest).
//   §2 GERİ ALMA         `revokedAt` dolu duruş sedde yer İŞGAL ETMEZ.
//   §3 REPLAY SEDDİ      aynı (makine, stopKey) ikinci kez yazılamaz — kimlik
//                        SAAT DEĞİL TOKEN'dır: saat kaysa da tek satır.
//   §4 CHECK'LER         zaman sırası (duruş EŞİTLİĞE izin verir, vardiya VERMEZ)
//                        · negatif süre · vardiya penceresi sağlığı.
//   §5 EŞZAMANLILIK      iki eşzamanlı açılıştan tam biri kazanır.
//   §6 KALINTI RİSK      fold'un NULL olamamasının DAYANAĞI hâlâ duruyor mu.
//
// ⛔ NE ÖLÇMÜYOR — §5 bir TOCTOU PENCERESİ ölçümü DEĞİLDİR ve öyle okunmamalı.
//   Bugün duruş yazan bir SERVİS yok; iki INSERT doğrudan sede çarpıyor, yani
//   "önce oku sonra yaz" aralığı hiç yok ve sıralı iki INSERT de P2002 verir.
//   ⇒ `p2002 === 1` sedin çalıştığını kanıtlar, ÖRTÜŞMEYİ değil. Kaybedenin hata
//   kodu ancak örtüşmeyen durumda FARKLI bir sonuç üretiyorsa pencere tanığıdır;
//   burada öyle bir ayırt edici YOK. Pencere sorusu ingest ucu doğduğunda açılır
//   ve o gün bu bölüm yeniden yazılır. (`test_machine_run` §5 ile aynı beyan.)
//
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adımdır.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

function isP2002(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}
function isCheckViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && JSON.stringify(e.meta ?? {}).includes("23514");
}
/**
 * "Başarılı olmalı" yazımlar da try/catch'e alınır: sed FAZLA GENİŞ kurulduğunda
 * geçmesi gereken bir INSERT fırlatır ve çıplak `await` bekçiyi ÖLDÜRÜR — ❌
 * satırı basılmaz, sonraki bölümler ölçülmez, `=== Sonuç` hiç yazılmaz.
 * (`test_machine_run`da negatif sondayla ölçüldü.)
 */
async function dene<T>(fn: () => Promise<T>): Promise<{ satir: T | null; hata: unknown }> {
  try {
    return { satir: await fn(), hata: null };
  } catch (e) {
    return { satir: null, hata: e };
  }
}
/** ⚠️ YALNIZ kırmızı satırda çağrılır: yeşil bir satırın yanında "beklenmedik
 *  P2039" yazmak okuyucuyu, geçmiş bir kontrolün bozuk olduğuna inandırır. */
function ozet(ok: boolean, e: unknown): string {
  if (ok) return "";
  if (e instanceof Prisma.PrismaClientKnownRequestError) return `hata ${e.code}`;
  return e ? String(e).slice(0, 100) : "hata YOK (beklenen red gelmedi)";
}

const T = (iso: string): Date => new Date(iso);

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(1);
  }

  const ek = Date.now().toString(36);
  const gun = T("2026-04-05T00:00:00.000Z");

  const station = await prisma.station.create({
    data: {
      name: `TEST-MS-IST-${ek}`,
      code: `TEST-MS-S-${ek}`.toUpperCase().slice(0, 32),
      type: "INTERNAL",
      kind: "PROCESS_QC",
      isActive: true,
    },
  });

  try {
    const makine = await prisma.machine.create({
      data: {
        stationId: station.id,
        name: `TEST-MS-MAK-${ek}`,
        code: `TEST-MS-M-${ek}`.toUpperCase().slice(0, 32),
        isActive: true,
      },
    });
    const makine2 = await prisma.machine.create({
      data: {
        stationId: station.id,
        name: `TEST-MS-MAK2-${ek}`,
        code: `TEST-MS-M2-${ek}`.toUpperCase().slice(0, 32),
        isActive: true,
      },
    });

    const durus = (over: Record<string, unknown>): Record<string, unknown> => ({
      machineId: makine.id,
      stopKey: crypto.randomUUID(),
      startedAt: T("2026-04-05T08:00:00.000Z"),
      factoryDay: gun,
      source: "MACHINE" as const,
      ...over,
    });

    // ── §1 AÇIK DURUŞ SEDDİ ──────────────────────────────────────────────────
    const r1a = await dene(() => prisma.machineStopEvent.create({ data: durus({}) as never }));
    check("§1a açık duruş yazılabiliyor", Boolean(r1a.satir), ozet(Boolean(r1a.satir), r1a.hata));
    if (!r1a.satir) throw new Error("§1a yazılamadı — sonraki bölümler ölçülemez");

    const r1b = await dene(() =>
      prisma.machineStopEvent.create({ data: durus({ startedAt: T("2026-04-05T09:00:00.000Z") }) as never }),
    );
    check("§1b aynı makinede İKİNCİ açık duruş reddedilir", isP2002(r1b.hata));

    // Sed fazla GENİŞ olmamalı: başka makine kendi açık duruşunu açabilmeli.
    const r1c = await dene(() =>
      prisma.machineStopEvent.create({ data: durus({ machineId: makine2.id }) as never }),
    );
    check("§1c başka makinede açık duruş meşru", Boolean(r1c.satir), ozet(Boolean(r1c.satir), r1c.hata));

    // ── §2 GERİ ALMA sedde yer işgal etmez ───────────────────────────────────
    await prisma.machineStopEvent.update({
      where: { id: r1a.satir.id },
      data: { revokedAt: new Date(), revokeReason: "TEST-MS geri alma" },
    });
    const r2 = await dene(() =>
      prisma.machineStopEvent.create({ data: durus({ startedAt: T("2026-04-05T10:00:00.000Z") }) as never }),
    );
    check("§2 geri alınmış duruş sedde yer İŞGAL ETMEZ", Boolean(r2.satir), ozet(Boolean(r2.satir), r2.hata));

    // ── §3 REPLAY SEDDİ — kimlik SAAT DEĞİL TOKEN ────────────────────────────
    if (r2.satir) {
      const ayniKey = r2.satir.stopKey;
      // Saat 4 saat kaysa bile aynı token ⇒ TEK satır. (Kapatarak açık-duruş
      // seddini devre dışı bırakıyoruz ki ölçülen şey REPLAY seddi olsun.)
      await prisma.machineStopEvent.update({
        where: { id: r2.satir.id },
        data: { endedAt: T("2026-04-05T10:30:00.000Z") },
      });
      const r3 = await dene(() =>
        prisma.machineStopEvent.create({
          data: durus({ stopKey: ayniKey, startedAt: T("2026-04-05T14:00:00.000Z") }) as never,
        }),
      );
      check("§3 aynı (makine, stopKey) ikinci kez yazılamaz — saat kaysa da", isP2002(r3.hata));
    } else {
      check("§3 aynı (makine, stopKey) ikinci kez yazılamaz — saat kaysa da", false, "ÖLÇÜLEMEDİ — §2 satırı doğmadı");
    }

    // ── §4 CHECK'LER ─────────────────────────────────────────────────────────
    const r4a = await dene(() =>
      prisma.machineStopEvent.create({
        data: durus({
          machineId: makine2.id,
          startedAt: T("2026-04-05T12:00:00.000Z"),
          endedAt: T("2026-04-05T11:00:00.000Z"),
        }) as never,
      }),
    );
    check("§4a kapanış açılıştan ÖNCE olamaz", isCheckViolation(r4a.hata), ozet(isCheckViolation(r4a.hata), r4a.hata));

    // ⚠️ EŞİTLİĞE İZİN VAR ve bu bilinçli: anlık duruş (aç-kapa aynı damga)
    // gerçek bir olaydır; reddetmek ajanın kuyruğunu kilitlerdi. Vardiya
    // tarafındaki kardeş CHECK ise eşitliği REDDEDER (sıfır pencere ⇒ payda 0).
    const an = T("2026-04-05T13:00:00.000Z");
    const r4b = await dene(() =>
      prisma.machineStopEvent.create({
        data: durus({ machineId: makine2.id, startedAt: an, endedAt: an, durationSec: 0 }) as never,
      }),
    );
    check("§4b ANLIK duruş (başlangıç = bitiş) KABUL edilir", Boolean(r4b.satir), ozet(Boolean(r4b.satir), r4b.hata));

    const r4c = await dene(() =>
      prisma.machineStopEvent.create({
        data: durus({ machineId: makine2.id, startedAt: T("2026-04-05T15:00:00.000Z"), durationSec: -5 }) as never,
      }),
    );
    check("§4c negatif süre reddedilir", isCheckViolation(r4c.hata), ozet(isCheckViolation(r4c.hata), r4c.hata));

    const vardiyaAdi = `TEST-MS-VRD-${ek}`;
    const r4d = await dene(() =>
      prisma.shiftDefinition.create({
        data: { code: `T${ek}`.slice(0, 8), name: vardiyaAdi, startMinute: 480, durationMinutes: 480, plannedBreakMinutes: 30 },
      }),
    );
    check("§4d geçerli vardiya tanımı yazılabiliyor", Boolean(r4d.satir), ozet(Boolean(r4d.satir), r4d.hata));

    const r4e = await dene(() =>
      prisma.shiftDefinition.create({
        data: { code: `X${ek}`.slice(0, 8), name: `${vardiyaAdi}-X`, startMinute: 480, durationMinutes: 60, plannedBreakMinutes: 60 },
      }),
    );
    check("§4e mola süreyi AŞAMAZ (negatif POT'u kaynağında keser)", isCheckViolation(r4e.hata), ozet(isCheckViolation(r4e.hata), r4e.hata));

    if (r4d.satir) {
      const r4f = await dene(() =>
        prisma.shiftInstance.create({
          data: {
            shiftDefinitionId: r4d.satir!.id,
            factoryDayKey: gun,
            startsAt: T("2026-04-05T08:00:00.000Z"),
            endsAt: T("2026-04-05T08:00:00.000Z"),
          },
        }),
      );
      check(
        "§4f SIFIR uzunluklu vardiya penceresi reddedilir (duruşun tersine)",
        isCheckViolation(r4f.hata),
        ozet(isCheckViolation(r4f.hata), r4f.hata),
      );
    }

    // ── §5 EŞZAMANLILIK (SED ölçümü — pencere ölçümü DEĞİL, başlığa bak) ──────
    // ⚠️ ÜÇÜNCÜ, TEMİZ makine: `makine2`nin §1c'den kalma AÇIK duruşu sedi zaten
    // doldurduğu için ilk yazımda İKİSİ DE reddedildi (kazanan=0). Yani ölçüm
    // "yarışı" değil "zaten dolu bir sedi" ölçüyordu — sonuç doğru görünen ama
    // konusu yanlış bir kırmızıydı. Eşzamanlılık ölçümü TEMİZ zemin ister.
    const makine3 = await prisma.machine.create({
      data: {
        stationId: station.id,
        name: `TEST-MS-MAK3-${ek}`,
        code: `TEST-MS-M3-${ek}`.toUpperCase().slice(0, 32),
        isActive: true,
      },
    });
    const sonuc = await Promise.allSettled([
      prisma.machineStopEvent.create({
        data: durus({ machineId: makine3.id, startedAt: T("2026-04-06T08:00:00.000Z") }) as never,
      }),
      prisma.machineStopEvent.create({
        data: durus({ machineId: makine3.id, startedAt: T("2026-04-06T08:00:01.000Z") }) as never,
      }),
    ]);
    const kazanan = sonuc.filter((r) => r.status === "fulfilled").length;
    const p2002 = sonuc.filter((r) => r.status === "rejected" && isP2002(r.reason)).length;
    check(
      "§5 eşzamanlı iki açılıştan tam biri kazanır",
      kazanan === 1 && p2002 === 1,
      `kazanan=${kazanan} p2002=${p2002} (SED ölçümü; pencere ölçümü DEĞİL)`,
    );

    // ── §6 KALINTI RİSK — fold'un dayanağı hâlâ duruyor mu ───────────────────
    // `shift_definitions.nameFold` / `machine_collectors.nameFold` NULLABLE ve
    // UNIQUE. NULL olamamalarının TEK dayanağı kaynak `name` kolonunun NOT NULL
    // olmasıdır; türetme SESSİZDİR. Biri `name`i nullable yaparsa PG'nin
    // NULLS DISTINCT davranışı yüzünden sınırsız "adsız" satır kabul edilir ve
    // UNIQUE deliği KENDİLİĞİNDEN açılır. Bu geçişi başka hiçbir kapı görmez
    // (`EXPRESSION_UNIQUES` envanteri `expr`+`predicate` tutar, kaynağın
    // nullability'sini tutmaz) — o yüzden yüklem BURADA yaşıyor.
    const kaynaklar = await prisma.$queryRaw<Array<{ table_name: string; is_nullable: string }>>`
      SELECT table_name, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'name'
        AND table_name IN ('shift_definitions', 'machine_collectors')
      ORDER BY table_name`;
    check(
      "§6 fold'un dayanağı duruyor: iki tabloda da `name` NOT NULL",
      kaynaklar.length === 2 && kaynaklar.every((k) => k.is_nullable === "NO"),
      kaynaklar.map((k) => `${k.table_name}=${k.is_nullable}`).join(" · ") || "kolon bulunamadı",
    );

    // Ve fold'un kendisi motor seddiyle korunuyor mu: `GENERATED ALWAYS AS`
    // kolona DOĞRUDAN yazmak PG tarafından reddedilir (trigger değil, atlatılamaz).
    const r6b = await dene(
      () => prisma.$executeRawUnsafe(
        `INSERT INTO "shift_definitions" ("id","code","name","startMinute","durationMinutes","nameFold","updatedAt")
         VALUES (gen_random_uuid(), 'TZ${ek.slice(0, 5)}', 'TEST-MS-GEN-${ek}', 480, 480, 'elle-yazilan', now())`,
      ),
    );
    check(
      "§6b GENERATED kolona doğrudan yazma motorca REDDEDİLİR",
      r6b.hata !== null,
      r6b.hata === null ? "⚠️ YAZILDI — fold artık uygulama tarafından ezilebilir" : "",
    );
  } finally {
    await prisma.machineStopEvent.deleteMany({ where: { machine: { stationId: station.id } } });
    await prisma.machine.deleteMany({ where: { stationId: station.id } });
    await prisma.station.deleteMany({ where: { id: station.id } });
    await prisma.shiftInstance.deleteMany({ where: { shiftDefinition: { name: { startsWith: `TEST-MS-VRD-${ek}` } } } });
    await prisma.shiftDefinition.deleteMany({ where: { name: { startsWith: "TEST-MS-" } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
