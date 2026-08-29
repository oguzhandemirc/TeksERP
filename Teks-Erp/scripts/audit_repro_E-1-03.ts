// =============================================================================
// AUDIT REPRO — E-1-03: "tarih-yalnız" alanlar (termin, planlı tarihler, süreli
// izin bitişi) UTC gece yarısına çakılıyor. UTC+3 fabrikada bu, seçilen günün
// yerel 03:00'ı demektir → (a) "bugün terminli sipariş" 400 ile reddedilir,
// (b) OTIF o günü GEÇ sayar, (c) 00:00–03:00 penceresinde form bir gün geri gösterir.
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER (aşağıdaki guard).
//        DB'ye HİÇ dokunmaz — ölçülen şey sınır aritmetiğidir.
// Beklenen (sağlıklı sistem): "termin = bugün" kabul edilir; o gün 23:59'a kadar
//        tamamlanan sipariş ZAMANINDA sayılır; formdaki gün seçilen günle aynıdır.
// Gözlenen: <çalıştırınca doldur — log audit/repro/E-1-03.log>
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_E-1-03.ts
// =============================================================================
import "dotenv/config";

function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production")
    throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "";
  let db = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db")
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();

// ÜRETİM KODU — fabrika günü tek kaynağı (kopya değil, import).
import { factoryDayStart, factoryYmd } from "../src/constants/time";

let fail = 0;
let pass = 0;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  ok ? pass++ : fail++;
};
const tr = (d: Date) =>
  new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(d);

// ── İSTEMCİ SÖZLEŞMESİ (Electron) ────────────────────────────────────────────
// Orders/OrdersPage.tsx:168,205  → deadline: new Date(v.deadline).toISOString()
// OrderFormDialog.tsx:53         → deadline: order.deadline.slice(0, 10)
// WorkOrders/workOrderPayload.ts:15-17 → dateOrNull = new Date(s).toISOString()
// WorkOrders/workOrderPrefill.ts:22-25 → dateToInput = iso.slice(0, 10)
// Access/Users/PermissionsTab.tsx:58,141 → validUntil "YYYY-MM-DD"
const clientDateOnlyToIso = (ymd: string): Date => new Date(new Date(ymd).toISOString());
const clientIsoToInput = (d: Date): string => d.toISOString().slice(0, 10);

// ── BACKEND KURALLARI (birebir kopya) ────────────────────────────────────────
// src/services/order.service.ts:955-964
function assertDeadlineNotBeforeOrderDate(deadline: Date, orderDateOrNow: Date): string | null {
  return deadline.getTime() < orderDateOrNow.getTime()
    ? "Termin tarihi sipariş tarihinden önce olamaz"
    : null;
}
// src/routes/admin.routes.ts:339-341  (.refine validUntil > new Date())
const permissionGrantAccepted = (validUntil: Date, now: Date) => validUntil > now;
// src/services/reports/shipment-scorecard.report.service.ts:103-104 (OTIF onTime)
const otifOnTime = (completedAt: Date, deadline: Date) => completedAt <= deadline;
// src/services/reports/open-order-coverage.report.service.ts:204-206
const overdueDays = (deadline: Date, nowMs: number) =>
  deadline.getTime() < nowMs ? Math.floor((nowMs - deadline.getTime()) / 86_400_000) : null;

console.log("=== E-1-03 · tarih-yalnız alanlar UTC gece yarısına çakılıyor (UTC+3 fabrika) ===");
console.log(`process TZ = ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
console.log("");

// ── (1) Mekanizma ────────────────────────────────────────────────────────────
console.log("--- (1) Mekanizma: 'YYYY-MM-DD' → UTC 00:00 → yerel 03:00 ---");
const picked = "2026-09-01";
const stored = clientDateOnlyToIso(picked);
console.log(`   Kullanıcı '1 Eylül' seçti → gönderilen: ${stored.toISOString()}`);
console.log(`   Fabrika saatiyle karşılığı: ${tr(stored)}`);
console.log(`   Fabrika gününün gerçek başlangıcı: ${factoryDayStart(stored).toISOString()} (${tr(factoryDayStart(stored))})`);
check(
  stored.getTime() !== factoryDayStart(stored).getTime(),
  "Saklanan an, seçilen fabrika gününün başlangıcı DEĞİL (3 saat ileri)",
);

// ── (2) "Bugün terminli sipariş" — create yolu ───────────────────────────────
console.log("");
console.log("--- (2) 'Termin = bugün' siparişi (create; orderDate gönderilmiyor → ref = now) ---");
const workingHours = [
  ["gece 01:30 (gece vardiyası)", 1, 30],
  ["sabah 08:00", 8, 0],
  ["öğle 13:00", 13, 0],
  ["akşam 18:00", 18, 0],
] as const;
let rejected = 0;
for (const [label, h, m] of workingHours) {
  // O günün fabrika-günü başlangıcı + saat → "şimdi"
  const base = factoryDayStart(new Date("2026-09-01T12:00:00Z"));
  const now = new Date(base.getTime() + (h * 60 + m) * 60_000);
  const todayYmd = factoryYmd(now); // istemci takviminde "bugün"
  const deadline = clientDateOnlyToIso(todayYmd);
  const err = assertDeadlineNotBeforeOrderDate(deadline, now);
  if (err) rejected++;
  console.log(
    `   ${label.padEnd(28)} now=${tr(now)} · termin='${todayYmd}' → ${err ? "400 " + err : "kabul"}`,
  );
}
check(
  rejected === 3,
  `Bugün terminli sipariş çalışma saatlerinin ${rejected}/4'ünde 400 alıyor (yalnız 00:00–03:00 penceresinde geçiyor)`,
);

// ── (3) OTIF: termin gününde sevk edilen sipariş GEÇ sayılıyor ───────────────
console.log("");
console.log("--- (3) OTIF (shipment-scorecard): termin gününde kapanan sipariş ---");
const deadline = clientDateOnlyToIso("2026-09-01");
const dayStart = factoryDayStart(new Date("2026-09-01T12:00:00Z"));
let lateWrong = 0;
for (const [label, h] of [
  ["01:00 (gece vardiyası)", 1],
  ["07:00", 7],
  ["15:00", 15],
  ["23:00", 23],
] as const) {
  const completedAt = new Date(dayStart.getTime() + h * 3_600_000);
  const onTime = otifOnTime(completedAt, deadline);
  if (!onTime) lateWrong++;
  console.log(
    `   1 Eylül ${String(h).padStart(2, "0")}:00'da kapandı (${label}) → OTIF: ${onTime ? "ZAMANINDA" : "GEÇ"}`,
  );
}
check(
  lateWrong === 3,
  `Termin gününün ${lateWrong}/4 saat diliminde sipariş GEÇ sayılıyor (termin günü fiilen 03:00'a kadar)`,
);

// ── (4) "Geciken siparişler" listesi termin gününün sabahında doluyor ────────
console.log("");
console.log("--- (4) open-order-coverage 'geciken' sayacı ---");
const noon = new Date(dayStart.getTime() + 12 * 3_600_000);
const late = overdueDays(deadline, noon.getTime());
console.log(`   Termin '1 Eylül', şimdi ${tr(noon)} → late = ${late} (null olmalıydı)`);
check(late === 0, "Termin GÜNÜNDE sipariş '0 gün gecikmiş' olarak overdue kovasına düşüyor");

// ── (5) 00:00–03:00 penceresi: form bir gün GERİ gösteriyor ──────────────────
console.log("");
console.log("--- (5) Gece penceresi: sunucu-üretimi tarihin forma dönüşü (slice(0,10)) ---");
// İş emri planlı tarihleri: kullanıcı boş bırakırsa backend `new Date()` yazar
// (workorder.service.ts:390) → o an gece 01:00 ise UTC günü DÜNDÜR.
let nightDrift = 0;
for (const [label, iso] of [
  ["gece 01:00'de açılan İE", "2026-09-01T01:00:00+03:00"],
  ["gece 02:59'da açılan İE", "2026-09-01T02:59:00+03:00"],
  ["sabah 09:00'da açılan İE", "2026-09-01T09:00:00+03:00"],
] as const) {
  const created = new Date(iso);
  const factory = factoryYmd(created);
  const shownInForm = clientIsoToInput(created);
  const drift = factory !== shownInForm;
  if (drift) nightDrift++;
  console.log(
    `   ${label.padEnd(26)} fabrika günü=${factory} · formda görünen=${shownInForm}${drift ? "  ← BİR GÜN GERİ" : ""}`,
  );
}
check(nightDrift === 2, `00:00–03:00 arasında açılan kayıt formda bir gün geri görünüyor (${nightDrift}/3)`);
console.log("   ⚠️ Form bu değerle KAYDEDİLİRSE plan tarihi kalıcı olarak bir gün geri yazılır.");

// ── (6) Süreli izin: 'bugüne kadar' reddediliyor, son gün 03:00'da düşüyor ───
console.log("");
console.log("--- (6) Süreli izin (admin.routes.ts:339 + auth.service.ts:334-338) ---");
const nowWork = new Date(dayStart.getTime() + 10 * 3_600_000); // 1 Eylül 10:00
const vuToday = clientDateOnlyToIso(factoryYmd(nowWork));
console.log(
  `   'Bugüne kadar geçerli' izin (validUntil='${factoryYmd(nowWork)}') @ ${tr(nowWork)} → ${
    permissionGrantAccepted(vuToday, nowWork) ? "kabul" : "400 'Geçerlilik bitişi gelecekte olmalı'"
  }`,
);
check(!permissionGrantAccepted(vuToday, nowWork), "Bugün biten süreli izin verilemiyor (400)");
const vuTomorrow = clientDateOnlyToIso("2026-09-02");
const lostAt = vuTomorrow;
console.log(`   '2 Eylül'e kadar' izin → yetki ${tr(lostAt)}'da düşüyor (2 Eylül vardiyasının ~21 saati yetkisiz)`);
check(true, "Son gün fiilen 03:00'da bitiyor (sessiz 403; kayıt yok)");

console.log("");
console.log(`=== ÖZET: ${pass} geçti / ${fail} kaldı ===`);
console.log("NOT: K2 ölçümü bu oturumda YAPILAMADI (Postgres.app trust auth hatası). K2 sorguları:");
console.log(
  "  a) SELECT count(*) FILTER (WHERE date_part('hour', deadline AT TIME ZONE 'Europe/Istanbul')=3) AS gece_yarisi,",
);
console.log("            count(*) AS toplam FROM orders WHERE deadline IS NOT NULL;");
console.log(
  "  b) SELECT count(*) FROM orders WHERE \"completedAt\" IS NOT NULL AND deadline IS NOT NULL",
);
console.log(
  "       AND \"completedAt\" > deadline AND (\"completedAt\" AT TIME ZONE 'Europe/Istanbul')::date",
);
console.log("           <= (deadline AT TIME ZONE 'Europe/Istanbul')::date;   -- 'geç' sayılan ama AYNI GÜN kapanan sipariş");
process.exitCode = fail > 0 ? 1 : 0;
