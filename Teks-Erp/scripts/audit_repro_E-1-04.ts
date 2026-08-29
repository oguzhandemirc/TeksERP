// =============================================================================
// AUDIT REPRO — E-1-04: günlük belge sayacının UÇLARI. (a) 4 hane 9999'u aşınca
// kod BİÇİM DEĞİŞTİRİR ve `isDailyCode` doğrulaması onu artık tanımaz;
// (b) GGAAYY öneki yüzünden belge numarasının SÖZLÜKSEL sırası KRONOLOJİK
// DEĞİLDİR — `batchNumber` için yazılı olan yasak `workOrderNumber`/`shipmentNo`
// sıralanabilir alanlarında UYGULANMIYOR; (c) P99→P01 sarması körlemesine.
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER (aşağıdaki guard).
//        DB'ye HİÇ dokunmaz — ölçülen şey saf kod-format yardımcılarıdır.
// Beklenen (sağlıklı sistem): sayaç tavanında davranış AÇIK (ya kelepçe ya hata);
//        sıralanabilir belge numarası kronolojik sıra üretir.
// Gözlenen: <çalıştırınca doldur — log audit/repro/E-1-04.log>
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_E-1-04.ts
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

// ÜRETİM KODU — birebir import.
import {
  buildDailyCode,
  dailyCodePrefix,
  ddmmyy,
  isDailyCode,
  nextDailySeq,
  nextShortBatchSeq,
  parseShortBatchCode,
  SHORT_BATCH_MAX,
} from "../src/utils/code-format";
import { ROLL_BARCODE_RE, MAX_ROLL_SEQ, rollBarcodePrefix } from "../src/services/helpers/roll-barcode.helper";

let fail = 0;
let pass = 0;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  ok ? pass++ : fail++;
};

console.log("=== E-1-04 · günlük belge sayacı / barkod sayacı sınırları ===");
console.log("Kaynak: src/utils/code-format.ts:82-112, src/services/helpers/roll-barcode.helper.ts:19-95");
console.log("");

const day = new Date("2026-09-01T09:00:00+03:00");

// ── (1) 9999 taşması: belge kodu ─────────────────────────────────────────────
console.log("--- (1) Günlük belge sayacı 9999'u aşınca ---");
const prefix = dailyCodePrefix("SIP", day);
for (const seq of [9998, 9999, 10000, 12345]) {
  const code = `${prefix}${String(seq).padStart(4, "0")}`; // order/workorder/manifest/free-doc yolu birebir
  console.log(
    `   seq=${String(seq).padStart(5)} → ${code}  (uzunluk ${code.length}, isDailyCode=${isDailyCode(code, "SIP")})`,
  );
}
const over = `${prefix}${String(10000).padStart(4, "0")}`;
check(
  !isDailyCode(over, "SIP") && isDailyCode(`${prefix}9999`, "SIP"),
  "9999 sonrası kod 5 haneye çıkıyor ve `isDailyCode` doğrulaması onu REDDEDİYOR (biçim sözleşmesi kırılıyor, kayıt yine de yazılır)",
);
// Sayaç 10000'den sonra da doğru devam ediyor mu (numerik max)?
const mixed = [`${prefix}9999`, over, `${prefix}0001`];
check(
  nextDailySeq(mixed, prefix) === 10001,
  `Sayaç karışık hanede numerik max ile devam ediyor: next=${nextDailySeq(mixed, prefix)} (O-4 koruması AYAKTA)`,
);
// O-4 NaN zehirlenmesi guard'ı hâlâ var mı (regresyon çıpası)
check(
  nextDailySeq([`${prefix}ABC`, `${prefix}0007`], prefix) === 8,
  "Harf kuyruklu kod sayacı zehirlemiyor (Number.isFinite guard'ı AYAKTA)",
);

// ── (2) Top barkodu 9999: FAIL-CLOSED (doğru davranış — karşı örnek) ─────────
console.log("");
console.log("--- (2) Top barkodu tavanı (karşı örnek: burada FAIL-CLOSED) ---");
const bp = rollBarcodePrefix("H", day);
const at9999 = `${bp}${String(MAX_ROLL_SEQ).padStart(4, "0")}`;
const at10000 = `${bp}${String(MAX_ROLL_SEQ + 1).padStart(4, "0")}`;
console.log(`   ${at9999} → ROLL_BARCODE_RE=${ROLL_BARCODE_RE.test(at9999)}`);
console.log(`   ${at10000} → ROLL_BARCODE_RE=${ROLL_BARCODE_RE.test(at10000)}`);
console.log(
  "   roll-barcode.helper.ts:90-94 sayacı aşınca 409 fırlatıyor → tarayıcı sözleşmesi korunuyor.",
);
check(
  ROLL_BARCODE_RE.test(at9999) && !ROLL_BARCODE_RE.test(at10000),
  "Top barkodunda tavan AÇIKÇA kapılı (belge kodlarında olmayan koruma)",
);

// ── (3) GGAAYY: sözlüksel sıra ≠ kronolojik sıra ─────────────────────────────
console.log("");
console.log("--- (3) Belge numarası sıralaması (workOrderNumber/shipmentNo SIRALANABİLİR alanlar) ---");
const days = [
  new Date("2026-08-30T10:00:00+03:00"),
  new Date("2026-08-31T10:00:00+03:00"),
  new Date("2026-09-01T10:00:00+03:00"),
  new Date("2026-09-02T10:00:00+03:00"),
  new Date("2026-12-31T10:00:00+03:00"),
  new Date("2027-01-01T10:00:00+03:00"),
];
const codes = days.map((d) => buildDailyCode("IE", 1, d));
const chronological = [...codes];
const lexicographic = [...codes].sort();
console.log("   kronolojik  :", chronological.join(" → "));
console.log("   sözlüksel   :", lexicographic.join(" → "));
const sameOrder = chronological.every((c, i) => c === lexicographic[i]);
check(
  !sameOrder,
  "'İş Emri No'ya göre sıralama KRONOLOJİK DEĞİL (gün-ay-yıl öneki; ay/yıl devrinde tamamen karışır)",
);
console.log(
  "   ⚠️ code-format.ts:33-35 bu yasağı YALNIZ parti no için yazmış; ROLL/WO/Sevkiyat sıralanabilir alanlarında uygulanmıyor",
);
console.log("      (src/services/workorder.service.ts:34 WO_SORTABLE_FIELDS, shipping.service.ts:2346 SORTABLE).");

// ── (4) Parti no P99 → P01 körlemesine sarma ─────────────────────────────────
console.log("");
console.log("--- (4) Kısa parti no sarması (bilinçli karar — sınır davranışı kayda geçiriliyor) ---");
console.log(`   next(97)=${nextShortBatchSeq(97)}  next(98)=${nextShortBatchSeq(98)}  next(${SHORT_BATCH_MAX})=${nextShortBatchSeq(SHORT_BATCH_MAX)}`);
console.log(`   next(null)=${nextShortBatchSeq(null)}  parse('P00')=${parseShortBatchCode("P00")}  parse('P0508260019')=${parseShortBatchCode("P0508260019")}`);
check(
  nextShortBatchSeq(SHORT_BATCH_MAX) === 1,
  "P99 sonrası P01'e sarıyor; 'numara canlı mı' kontrolü YOK (2026-08-05 kullanıcı kararı — bulgu değil, sınır kaydı)",
);

// ── (5) Gün anahtarı: 2 haneli yıl + GGAAYY sabit uzunluk ────────────────────
console.log("");
console.log("--- (5) Gün anahtarı (roll_barcode_counters.day = GGAAYY) ---");
for (const d of [new Date("2026-12-31T23:59:00+03:00"), new Date("2027-01-01T00:01:00+03:00")]) {
  console.log(`   ${d.toISOString()} → ddmmyy='${ddmmyy(d)}'`);
}
check(
  ddmmyy(new Date("2027-01-01T00:01:00+03:00")) === "010127",
  "Yıl devrinde gün anahtarı doğru dönüyor (fabrika günü kaynaklı — 00:01'de yeni yıl)",
);
console.log("   NOT: `roll_barcode_counters` satırları hiç budanmıyor; 2 haneli yıl 100 yıl sonra döner (bilgi).");

console.log("");
console.log(`=== ÖZET: ${pass} geçti / ${fail} kaldı ===`);
console.log("NOT: K2 ölçümü bu oturumda YAPILAMADI (Postgres.app trust auth hatası). K2 sorguları:");
console.log("  a) SELECT max(length(\"workOrderNumber\")) FROM work_orders;  -- 12'yi aşan = 9999 taşması yaşandı");
console.log("  b) SELECT \"day\",\"type\",n FROM roll_barcode_counters ORDER BY n DESC LIMIT 5;  -- tavana yakınlık");
process.exitCode = fail > 0 ? 1 : 0;
