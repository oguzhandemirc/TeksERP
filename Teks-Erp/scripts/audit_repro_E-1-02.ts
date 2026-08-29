// =============================================================================
// AUDIT REPRO — E-1-02: içe aktarım tarih hücresi (`parseDateCell`) takvim
// sınırını doğrulamıyor → 31.02.2026 sessizce 03.03.2026 olur; sayısal hücre
// (Excel seri no) yıl olarak okunur (45900 → yıl 45900).
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER (aşağıdaki guard).
//        DB'ye HİÇ dokunmaz — ölçülen şey saf dönüştürücüdür.
// Beklenen (sağlıklı sistem): geçersiz takvim günü ve tarih olmayan hücre
//        `null` döner → içe aktarım satırı "tarih okunamadı" hatasıyla REDDEDİLİR.
// Gözlenen: <çalıştırınca doldur — log audit/repro/E-1-02.log>
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_E-1-02.ts
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

// ÜRETİM KODU — birebir import (kopya değil).
import { parseDateCell, parseLocaleNumber } from "../src/services/import/import-coerce";

let fail = 0;
let pass = 0;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  ok ? pass++ : fail++;
};

const trLocal = (d: Date) =>
  new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);

console.log("=== E-1-02 · içe aktarım tarih hücresi sınır davranışı ===");
console.log("Kaynak: Teks-Erp/src/services/import/import-coerce.ts:71-96 (parseDateCell)");
console.log("Tüketici: src/services/import/import.service.ts:88-91 (col.type === 'date')");
console.log("Kullanan adaptör: src/services/import/adapters/order.adapter.ts:57-58 (orderDate, deadline)");
console.log("");

// ── (1) Var olmayan takvim günleri ────────────────────────────────────────────
console.log("--- (1) Var olmayan takvim günü — beklenen: null (satır reddedilsin) ---");
const badDays = ["31.02.2026", "30.02.2026", "29.02.2026", "31.04.2026", "31.06.2026", "31.09.2026"];
let silentlyShifted = 0;
for (const raw of badDays) {
  const out = parseDateCell(raw);
  if (out === null) {
    console.log(`   ${raw} → null  (DOĞRU)`);
  } else {
    silentlyShifted++;
    console.log(`   ${raw} → ${trLocal(out)}  ← SESSİZ KAYMA (hata yok, log yok)`);
  }
}
check(
  silentlyShifted > 0,
  `Geçersiz takvim günü SESSİZCE kaydı: ${silentlyShifted}/${badDays.length} (bulgu doğrulandı)`,
);

// 29.02: artık yıl ayrımı ölçülür.
console.log("");
console.log("   Artık yıl kontrolü:");
const leap = parseDateCell("29.02.2028"); // 2028 artık yıl → MEŞRU
const nonLeap = parseDateCell("29.02.2026"); // 2026 artık DEĞİL → geçersiz gün
console.log(`   29.02.2028 (artık yıl, meşru) → ${leap ? trLocal(leap) : "null"}`);
console.log(`   29.02.2026 (artık DEĞİL)      → ${nonLeap ? trLocal(nonLeap) : "null"}`);
check(
  nonLeap !== null,
  "Artık yıl olmayan 29 Şubat da kabul edilip 1 Mart'a taşınıyor (aynı sınıf)",
);

// ── (2) Tarih olmayan hücre: Excel seri numarası ─────────────────────────────
console.log("");
console.log("--- (2) Tarih olmayan hücre (Excel seri no / serbest metin) ---");
const notDates = ["45900", "45900.5", "2026", "0", "1", "99999"];
let acceptedAsDate = 0;
for (const raw of notDates) {
  const out = parseDateCell(raw);
  if (out === null) {
    console.log(`   ${JSON.stringify(raw)} → null  (DOĞRU)`);
  } else {
    acceptedAsDate++;
    console.log(
      `   ${JSON.stringify(raw)} → ${out.toISOString()}  (yıl ${out.getUTCFullYear()}) ← YIL OLARAK OKUNDU`,
    );
  }
}
check(
  acceptedAsDate > 0,
  `Tarih olmayan hücre tarih sayıldı: ${acceptedAsDate}/${notDates.length} (bulgu doğrulandı)`,
);

// ── (3) Doğru çalışan yol — regresyon çıpası ─────────────────────────────────
console.log("");
console.log("--- (3) Doğru yol (regresyon çıpası): gece yarısı fabrika gününe oturuyor ---");
const good = parseDateCell("01.09.2026");
const okMidnight = good !== null && good.toISOString() === "2026-08-31T21:00:00.000Z";
console.log(`   01.09.2026 → ${good?.toISOString()} (yerel ${good ? trLocal(good) : "-"})`);
check(okMidnight, "Geçerli tarih Europe/Istanbul 00:00'a oturuyor (bu kısım DOĞRU yazılmış)");

// ── (4) Yan gözlem: sayı hücresinde yerel belirsizliği ───────────────────────
console.log("");
console.log("--- (4) Yan gözlem: parseLocaleNumber tek-ayraç kuralı (bilinçli, şablonda yazılı) ---");
for (const raw of ["1.234", "1,234", "1.5", "1e5"]) {
  console.log(`   ${JSON.stringify(raw)} → ${parseLocaleNumber(raw)}`);
}
console.log("   (EN yerelli dosyada '1,234' = 1234 iken burada 1.234 olur — kural şablonda yazılı,");
console.log("    bulgu DEĞİL; yalnız sınır davranışı kayda geçirildi.)");

console.log("");
console.log(`=== ÖZET: ${pass} geçti / ${fail} kaldı ===`);
console.log(
  "NOT: K2 (canlı veride yıl>3000 / ay-sonu kaymış sipariş tarihi) ölçümü bu oturumda YAPILAMADI —",
);
console.log("     Postgres.app 'trust authentication' hatası. K2 sorgusu:");
console.log(
  "     SELECT count(*) FROM orders WHERE \"orderDate\" > now()+interval '10 years' OR deadline > now()+interval '10 years';",
);
process.exitCode = fail > 0 ? 1 : 0;
