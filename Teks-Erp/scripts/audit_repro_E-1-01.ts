// =============================================================================
// AUDIT REPRO — E-1-01: audit arşiv kesme tarihi `setMonth` ile ay uzunluğunu
// taşıyor (29/30/31'inde koşulunca cutoff 1-3 gün İLERİ kayar → söz verilenden
// erken arşivlenen log).
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER (aşağıdaki guard).
//        Bu script DB'ye HİÇ dokunmaz (saf Date aritmetiği) — guard yine de koşar.
// Beklenen (sağlıklı sistem): "N ay geri" her çalıştırma gününde en fazla o ayın
//        uzunluğu kadar geri gider; hedef ayda o gün yoksa AYIN SON GÜNÜNE kelepçelenir.
// Gözlenen: <çalıştırınca doldur — log audit/repro/E-1-01.log>
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_E-1-01.ts
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

// ── ÜRETİM KODUNUN BİREBİR KOPYASI (src/services/audit.service.ts:205-206) ──
// Kopyalanmasının sebebi: archiveOlderThan() DB'ye gider; ölçülmek istenen şey
// yalnız cutoff aritmetiğidir.
function cutoffAsInProduction(runAt: Date, monthsToKeep: number): Date {
  const cutoff = new Date(runAt);
  cutoff.setMonth(cutoff.getMonth() - monthsToKeep);
  return cutoff;
}

/** Doğru davranış: hedef ayda o gün yoksa ayın SON gününe kelepçele. */
function cutoffClamped(runAt: Date, monthsToKeep: number): Date {
  const y = runAt.getFullYear();
  const m = runAt.getMonth() - monthsToKeep;
  const d = runAt.getDate();
  const lastDayOfTarget = new Date(y, m + 1, 0).getDate();
  const out = new Date(runAt);
  out.setDate(1);
  out.setMonth(m);
  out.setDate(Math.min(d, lastDayOfTarget));
  return out;
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

let fail = 0;
let pass = 0;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  ok ? pass++ : fail++;
};

console.log("=== E-1-01 · audit arşivi: `cutoff.setMonth(getMonth() - N)` ay uzunluğu sınırı ===");
console.log("Kaynak: Teks-Erp/src/services/audit.service.ts:205-206 (MONTHS_TO_KEEP=6, jobs/archive-scheduler.ts:22)");
console.log("");

// 1) Scheduler yolu: 6 ay geri, ayın 29/30/31'inde koşum.
console.log("--- (1) Scheduler: monthsToKeep = 6 ---");
const schedulerCases: Array<[string, Date]> = [
  ["31 Ağu 2026 → hedef Şubat (28 gün)", new Date(2026, 7, 31, 4, 0, 0)],
  ["31 Eki 2026 → hedef Nisan (30 gün)", new Date(2026, 9, 31, 4, 0, 0)],
  ["30 Ağu 2026 → hedef Şubat (28 gün)", new Date(2026, 7, 30, 4, 0, 0)],
  ["29 Ağu 2026 → hedef Şubat (28 gün)", new Date(2026, 7, 29, 4, 0, 0)],
  ["31 Ara 2026 → hedef Haziran (30 gün)", new Date(2026, 11, 31, 4, 0, 0)],
  ["15 Ağu 2026 → hedef Şubat (kontrol)", new Date(2026, 7, 15, 4, 0, 0)],
];
let drifted = 0;
for (const [label, runAt] of schedulerCases) {
  const prod = cutoffAsInProduction(runAt, 6);
  const want = cutoffClamped(runAt, 6);
  const driftDays = Math.round((prod.getTime() - want.getTime()) / 86_400_000);
  if (driftDays !== 0) drifted++;
  console.log(
    `   ${label}\n      üretim cutoff = ${ymd(prod)} | kelepçeli = ${ymd(want)} | SAPMA = ${driftDays} gün`,
  );
}
check(
  drifted > 0,
  `Sapma ÜRETİLDİ: ${drifted}/${schedulerCases.length} koşum gününde cutoff ileri kaydı (bulgu doğrulandı)`,
);

// 2) Elle arşiv ucu (admin.routes.ts:852 monthsToKeep 1..120) — en kötü hâl.
console.log("");
console.log("--- (2) Elle arşiv ucu: monthsToKeep = 1 (POST /api/admin/system-logs/archive) ---");
let worst = 0;
let worstLabel = "";
for (let months = 1; months <= 12; months++) {
  for (let m = 0; m < 12; m++) {
    for (const d of [29, 30, 31]) {
      const lastDay = new Date(2026, m + 1, 0).getDate();
      if (d > lastDay) continue;
      const runAt = new Date(2026, m, d, 4, 0, 0);
      const prod = cutoffAsInProduction(runAt, months);
      const want = cutoffClamped(runAt, months);
      const drift = Math.round((prod.getTime() - want.getTime()) / 86_400_000);
      if (drift > worst) {
        worst = drift;
        worstLabel = `${ymd(runAt)} · monthsToKeep=${months} → cutoff ${ymd(prod)} (beklenen ${ymd(want)})`;
      }
    }
  }
}
console.log(`   En büyük sapma: ${worst} gün — ${worstLabel}`);
check(worst >= 3, `Azami sapma ${worst} gün (≥3 bekleniyordu — Ocak 31 → Şubat 31 → Mart 3)`);

// 3) KARŞI ÖRNEK — aynı repoda DOĞRU yazılmış ikizi.
//    src/services/latency-persist.service.ts:170-171 `setUTCDate(getUTCDate() - N)`
console.log("");
console.log("--- (3) Karşı örnek: latency-persist retention `setUTCDate` (ay/yıl devrini DOĞRU yapar) ---");
const retentionCases: Array<[string, Date, number]> = [
  ["1 Mar 2026 − 30 gün", new Date(Date.UTC(2026, 2, 1)), 30],
  ["1 Oca 2027 − 30 gün (yıl devri)", new Date(Date.UTC(2027, 0, 1)), 30],
];
let retentionOk = true;
for (const [label, day, days] of retentionCases) {
  const c = new Date(day);
  c.setUTCDate(c.getUTCDate() - days);
  const expectedMs = day.getTime() - days * 86_400_000;
  const ok = c.getTime() === expectedMs;
  if (!ok) retentionOk = false;
  console.log(`   ${label} → ${c.toISOString().slice(0, 10)} (beklenen ${new Date(expectedMs).toISOString().slice(0, 10)})`);
}
check(retentionOk, "latency-persist retention kesmesi ay/yıl devrinde DOĞRU (düzeltmenin şekli budur)");

// 4) `setMonth` ayrıca YEREL saat dilimindedir — arşiv sınırı süreç TZ'sine bağlı.
console.log("");
console.log("--- (4) Yan gözlem: setMonth YEREL takvimde çalışır (süreç TZ'si) ---");
console.log(`   process TZ = ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
console.log(
  "   `constants/time.ts` tüm takvim-günü kararlarını Europe/Istanbul'a sabitlerken",
);
console.log("   arşiv kesmesi süreç saat dilimini kullanıyor (tek kaynak dışında).");

console.log("");
console.log(`=== ÖZET: ${pass} geçti / ${fail} kaldı ===`);
console.log(
  "NOT: bu script DB'ye dokunmaz; K2 (canlı veride ihlal) ölçümü bu oturumda YAPILAMADI —",
);
console.log("     Postgres.app 'trust authentication' hatası (audit/tools/sql-*.sh erişilemedi).");
console.log(
  "     K2 sorgusu: SELECT value FROM system_settings WHERE key='audit.lastArchiveAt';",
);
console.log("     (dönen tarihin ayın 29/30/31'i olması fiili ihlali gösterir)");
process.exitCode = fail > 0 ? 1 : 0;
