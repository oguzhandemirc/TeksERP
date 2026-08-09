// =============================================================================
// GÜN SINIRI BEKÇİSİ — raporlarda "bu olay hangi GÜNE ait" sorusu AÇIK mı?
// Çalıştır: npx tsx scripts/test_report_day_boundary.ts
// =============================================================================
// ── NEDEN VAR ────────────────────────────────────────────────────────────────
// 2026-08-01'de tüm tarih kolonları `timestamptz` oldu (CLAUDE.md → O-11).
// `timestamptz` MUTLAK AN saklar; `DATE_TRUNC('day', kolon)` ise günü OTURUM
// saat diliminde keser. Havuz oturumu bilinçli olarak UTC (adapter varsayımı,
// src/lib/pg-session.ts) → gün sınırı sessizce UTC'ye bağlanmıştı.
//
// Fabrika Europe/Istanbul'da (kalıcı UTC+3) ve vardiya gece yarısını GEÇİYOR.
// UTC'de kesilen gün, YEREL 00:00–03:00 arasındaki her olayı BİR ÖNCEKİ güne
// yazar — yani vardiyanın tam ortasını. Operatörün "bugün 40 top çıktı" dediği
// şeyle rapor çubuğu tutmaz; hata da log da vermez.
//
// Çözüm: gün sınırı artık AÇIKÇA yazılıyor — `src/constants/time.ts` →
// `factoryDaySql()` (`AT TIME ZONE 'Europe/Istanbul'`). Bu bekçi o sözleşmenin
// üç cephesini kilitler:
//   1) `factoryDaySql` gerçekten fabrika gününü üretiyor mu (canlı PG ile),
//   2) uçtan uca bir rapor (audit `daily`) gece yarısı sonrası olayı DOĞRU güne
//      yazıyor mu — fixture 01:30 Europe/Istanbul anında,
//   3) `src/` içinde `factoryDaySql`'i BYPASS eden çıplak gün-kesme kaldı mı
//      (yeni gelen biri `DATE_TRUNC('day', ...)` yazdığı gün sessizce UTC'ye
//      geri döneriz — bu adım o kapıyı kapatır),
//   4) audit raporunun ifade istatistiği (sl_day_exact) yeni ifadeyle eşleşiyor
//      mu — eşleşmezse sonuç DOĞRU kalır ama sorgu ~2x yavaşlar (sessiz regresyon).
//
// JS tarafı (`factoryDayStart` / `factoryDayKeyUtcMidnight`) SÜREÇ saat
// diliminden bağımsız olmalı; bu yüzden beklenen değerler `TZ` env'ine değil
// mutlak epoch'a göre yazıldı.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import prisma from "../src/lib/prisma";
import {
  FACTORY_TIMEZONE,
  factoryDaySql,
  factoryDayStart,
  factoryDayKeyUtcMidnight,
  factoryYmd,
} from "../src/constants/time";
import { getSystemLogSummary } from "../src/services/reports/audit.report.service";
import type { DateRange } from "../src/services/reports/_shared";

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

// 2026-07-31 22:30:00Z  ==  2026-08-01 01:30 Europe/Istanbul (gece vardiyası).
// UTC'de kesilen gün bunu 2026-07-31'e, fabrika günü 2026-08-01'e yazar.
const NIGHT_SHIFT = new Date("2026-07-31T22:30:00.000Z");
// 2026-08-01 09:00Z == 12:00 Europe/Istanbul — aynı fabrika günü, gündüz.
const SAME_DAY_NOON = new Date("2026-08-01T09:00:00.000Z");

const TEST_TABLE = `TZDAY-${Date.now()}`;
const createdLogIds: string[] = [];

async function main(): Promise<void> {
  console.log("\n=== Rapor gün sınırı (fabrika takvim günü) bekçisi ===");
  console.log(`FACTORY_TIMEZONE = ${FACTORY_TIMEZONE}\n`);

  // ── 1) JS yardımcıları — süreç saat diliminden BAĞIMSIZ ───────────────────
  console.log("── 1) JS gün sınırı yardımcıları ──");
  check(
    "factoryYmd: 22:30Z → fabrika günü ertesi gün",
    factoryYmd(NIGHT_SHIFT) === "2026-08-01",
    factoryYmd(NIGHT_SHIFT)
  );
  check(
    "factoryYmd: gece vardiyası ile aynı günün öğlesi AYNI güne düşer",
    factoryYmd(NIGHT_SHIFT) === factoryYmd(SAME_DAY_NOON),
    `${factoryYmd(NIGHT_SHIFT)} == ${factoryYmd(SAME_DAY_NOON)}`
  );
  // Europe/Istanbul 2026-08-01 00:00 == 2026-07-31 21:00Z
  check(
    "factoryDayStart: gün başlangıcı mutlak an olarak 21:00Z",
    factoryDayStart(NIGHT_SHIFT).toISOString() === "2026-07-31T21:00:00.000Z",
    factoryDayStart(NIGHT_SHIFT).toISOString()
  );
  check(
    "factoryDayStart: olay her zaman kendi gününün başlangıcından SONRA",
    factoryDayStart(NIGHT_SHIFT) <= NIGHT_SHIFT && factoryDayStart(SAME_DAY_NOON) <= SAME_DAY_NOON
  );
  check(
    "factoryDayKeyUtcMidnight: @db.Date anahtarı UTC-gece-yarısı (1 gün geri kaymaz)",
    factoryDayKeyUtcMidnight(NIGHT_SHIFT).toISOString() === "2026-08-01T00:00:00.000Z",
    factoryDayKeyUtcMidnight(NIGHT_SHIFT).toISOString()
  );

  // ── 2) factoryDaySql — canlı PG ile ───────────────────────────────────────
  console.log("\n── 2) factoryDaySql (canlı PostgreSQL) ──");
  const tzRow = await prisma.$queryRaw<Array<{ TimeZone: string }>>`SHOW TimeZone`;
  const sessionTz = tzRow[0]?.TimeZone;
  check(
    "havuz oturumu UTC (adapter sözleşmesi) — gün sınırı buna RAĞMEN doğru olmalı",
    sessionTz === "UTC",
    String(sessionTz)
  );

  const dayRows = await prisma.$queryRaw<Array<{ factoryDay: Date; naiveDay: Date }>>`
    SELECT
      ${factoryDaySql("t.ts")}              AS "factoryDay",
      DATE_TRUNC('day', t.ts)::date         AS "naiveDay"
    FROM (SELECT ${NIGHT_SHIFT}::timestamptz AS ts) t
  `;
  const factoryDay = dayRows[0]?.factoryDay.toISOString().slice(0, 10);
  const naiveDay = dayRows[0]?.naiveDay.toISOString().slice(0, 10);
  check("factoryDaySql gece vardiyasını DOĞRU güne yazar", factoryDay === "2026-08-01", String(factoryDay));
  check(
    "çıplak DATE_TRUNC (eski davranış) AYNI satırı bir önceki güne yazıyordu — fark kanıtlandı",
    naiveDay === "2026-07-31" && naiveDay !== factoryDay,
    `çıplak=${naiveDay} · fabrika=${factoryDay}`
  );
  // Prisma `date` kolonunu UTC-gece-yarısı Date olarak döndürür → servislerdeki
  // `.toISOString().slice(0,10)` etiketi doğru. Bu varsayım kırılırsa TÜM günlük
  // seriler bir gün kayar, o yüzden ayrıca doğrulanıyor.
  check(
    "PG `date` → JS Date UTC-gece-yarısı geliyor (toISOString().slice(0,10) güvenli)",
    dayRows[0]?.factoryDay.getUTCHours() === 0 && dayRows[0]?.factoryDay.getUTCMinutes() === 0
  );

  // ── 3) Uçtan uca: audit `daily` serisi ────────────────────────────────────
  console.log("\n── 3) Uçtan uca — getSystemLogSummary().daily ──");
  for (const at of [NIGHT_SHIFT, SAME_DAY_NOON]) {
    const row = await prisma.systemLog.create({
      data: {
        action: "CREATE",
        tableName: TEST_TABLE,
        recordId: `tz-${at.toISOString()}`,
        createdAt: at,
      },
      select: { id: true },
    });
    createdLogIds.push(row.id);
  }
  const range: DateRange = {
    from: new Date("2026-07-25T00:00:00.000Z"),
    to: new Date("2026-08-05T00:00:00.000Z"),
  };
  const summary = await getSystemLogSummary(range);
  const aug1 = summary.daily.find((d) => d.day === "2026-08-01");
  const jul31 = summary.daily.find((d) => d.day === "2026-07-31");
  // Aralıkta başka test/seed verisi olabilir → mutlak sayı yerine "bizim iki
  // satırımız 1 Ağustos'ta, 31 Temmuz'a sızmadı" iddiası kurulur.
  const mine = await prisma.systemLog.findMany({
    where: { tableName: TEST_TABLE },
    select: { createdAt: true },
  });
  check("fixture iki satır yazıldı", mine.length === 2, `${mine.length} satır`);
  check(
    "gece vardiyası + öğle AYNI günün (2026-08-01) çubuğunda birleşti",
    (aug1?.create ?? 0) >= 2,
    `2026-08-01 create=${aug1?.create ?? 0}`
  );
  const jul31Before = jul31?.create ?? 0;
  const summaryWithoutOurs = await getSystemLogSummary({
    from: new Date("2026-07-25T00:00:00.000Z"),
    to: new Date("2026-07-31T20:59:59.999Z"), // fabrika 1 Ağustos'un başlangıcından ÖNCE
  });
  const jul31Only = summaryWithoutOurs.daily.find((d) => d.day === "2026-07-31")?.create ?? 0;
  check(
    "31 Temmuz çubuğu bizim gece-vardiyası satırımızı İÇERMİYOR (UTC'de içerirdi)",
    jul31Before === jul31Only,
    `aralıklı=${jul31Before} · kesilmiş=${jul31Only}`
  );

  // ── 4) Kaçak gün-kesme taraması (src/) ────────────────────────────────────
  console.log("\n── 4) factoryDaySql'i BYPASS eden çıplak gün-kesme ──");
  const SRC = path.resolve(__dirname, "..", "src");
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && p.endsWith(".ts")) {
        // constants/time.ts ifadeyi ÜRETEN yerdir — tek meşru sahip.
        if (p === path.join(SRC, "constants", "time.ts")) continue;
        const lines = fs.readFileSync(p, "utf8").split("\n");
        lines.forEach((line, i) => {
          const code = line.split("--")[0] ?? ""; // SQL yorumları sayılmaz
          // JS yorumları da sayılmaz: tarihsel notlar ("eski `setHours` deseni…")
          // meşru ve çoktur; aranan şey ÇALIŞAN koddur.
          const trimmed = code.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
          if (/DATE_TRUNC\s*\(\s*'(day|week|month)'/i.test(code) || /\bCURRENT_DATE\b/.test(code)) {
            offenders.push(`${path.relative(SRC, p)}:${i + 1}  ${line.trim().slice(0, 90)}`);
          }
          // JS TARAFI (2026-08-09, F-OPS-VER-005): gün sınırını SÜREÇ saat
          // dilimiyle kuran yerel-zaman mutasyonları. Bu cephe eskiden taranmıyordu
          // ve kod tabanındaki tek üretim `setHours`u (backup-scheduler'ın yedek
          // saati) tam o boşluktan geçmişti: `BACKUP_HOUR=3` süreç TZ'sinde 03:00
          // demekti, fabrika gününde değil.
          // ⚠️ KAPSAM DAR: yalnız `setHours`. `setDate`/`setMonth` BİLEREK dışarıda —
          // onlar gün SINIRI kurmaz, SÜRE kaydırır ("termin + 30 gün",
          // order.service.ts:1438 / workorder.service.ts:250) ve o işlem saat
          // diliminden bağımsız olarak doğrudur; üstelik yerel saati koruduğu için
          // DST geçişlerinde `+ n*86400000`den DAHA doğrudur. İlk yazımda ikisi de
          // taranıyordu ve bu iki meşru satırı yanlış pozitif olarak işaretledi.
          // Kök CLAUDE.md ayrımı: TAKVİM GÜNÜ tz'ye bağlıdır, MUTLAK PENCERE değildir.
          if (/\.setHours\s*\(/.test(code)) {
            offenders.push(
              `${path.relative(SRC, p)}:${i + 1}  [JS gün sınırı] ${line.trim().slice(0, 80)}`,
            );
          }
        });
      }
    }
  };
  walk(SRC);
  check(
    "src/ içinde elle yazılmış DATE_TRUNC('day'/'week'/'month') veya CURRENT_DATE YOK",
    offenders.length === 0,
    offenders.length ? `\n     ${offenders.join("\n     ")}` : "temiz"
  );

  // ── 5) İfade istatistiği ifadeyle eşleşiyor mu ────────────────────────────
  console.log("\n── 5) sl_day_exact ifade istatistiği ──");
  const statRows = await prisma.$queryRaw<Array<{ def: string }>>`
    SELECT pg_get_statisticsobjdef(oid) AS def
    FROM pg_statistic_ext WHERE stxname = 'sl_day_exact'
  `;
  const def = statRows[0]?.def ?? "";
  check(
    "istatistik nesnesi VAR ve fabrika saat dilimini içeriyor",
    def.includes(`AT TIME ZONE '${FACTORY_TIMEZONE}'`),
    def || "nesne yok"
  );
  check(
    "istatistik ifadesi hâlâ günlük (DATE_TRUNC day → date)",
    /date_trunc\('day'/i.test(def) && /::date/.test(def)
  );
}

main()
  .catch((e) => {
    fail++;
    console.error("❌ beklenmeyen hata:", e);
  })
  .finally(async () => {
    try {
      if (createdLogIds.length) {
        // Test fixture'ı — audit tablosunda kalıcı çöp bırakma (soft-delete
        // kuralı domain kayıtları içindir; bu satırlar testin kendi ürettiği veridir).
        await prisma.systemLog.deleteMany({ where: { id: { in: createdLogIds } } });
      }
    } catch {
      /* temizlik best-effort */
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
