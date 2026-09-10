// =============================================================================
// BEKÇİ — SÜREÇ UYARISI YIĞIN İZİYLE LOG'A DÜŞÜYOR MU
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts process_warnings
//
// ⭐ NEDEN VAR (2026-09-07): sahada `backend-err.log`a şu düştü —
//    "Calling client.query() when the client is already executing a query is
//     deprecated and will be removed in pg@9.0"
//    ve Node NEREDEN geldiğini söylemedi: "(Use `node --trace-deprecation ...`)".
//    O bayrak canlıda yeniden başlatma, yani KESİNTİ demekti.
//
//    ÖLÇÜLDÜ: `warning` olayının `w.stack` alanı çağrı yerini BAYRAKSIZ DA
//    taşıyor — Node yalnız ekrana basmıyor. Yani tanı için gereken tek şey bu
//    dinleyiciydi. Bu bekçi, bir daha TAHMİNLE teşhis edilmemesini kilitler.
//
// NE ÖLÇER:
//   §1 Dinleyici kurulunca uyarı ETİKETLİ tek satır olarak düşüyor.
//   §2 ⭐ YIĞIN İZİ BASILIYOR — bu bekçinin tek sebebi bu. İz düşerse uyarı
//      yine görünür ama "nereden" sorusu yine cevapsız kalır ve bir sonraki
//      teşhis yine tahminle yapılır.
//   §3 İz ETİKETSİZ (bir olay = tek greplenebilir satır; `logger.ts` kuralı).
//   §4 AYNI YERDEN gelen uyarı TEKRAR basılmıyor (log'u boğmasın) ve ikinci
//      kurulum no-op. İmza çağrı yerini içerir: aynı metin başka bir yerden
//      gelirse AYRI sorundur, susturulmaz.
//
// ⚠️ SONDA GERÇEK MEKANİZMAYI KULLANIR: uyarı `process.emitWarning` ile taklit
//    edilmez, `pg`nin KENDİ koşulu tetiklenir — aynı client'a ÜÇÜNCÜ sorgu
//    (`pg/lib/client.js`: `_queryQueue.length > 0`). İKİ sorgu YETMEZ; bekçi
//    ilk yazımda iki sorguyla kurulmuştu ve hiçbir şey ölçmüyordu.
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-07):
//    ① `stackTrace(w.stack)` satırı silinince §2 KIRMIZI
//    ② `seen` kümesi kaldırılınca §4 KIRMIZI (⚠️ İLK YAZIMDA ISIRMADI:
//       tekrar testi pg'nin uyarısıyla yapılmıştı, o zaten süreç başına bir
//       kez basıyor → sonda vakumen yeşil kaldı. Tekrar artık `emitWarning`
//       ile ölçülüyor.)
//    ③ `installed` bayrağı kaldırılınca §4 YEŞİL KALDI ve bu DOĞRU: iki dinleyici
//       kurulsa bile `seen` kümesi ikinciyi susturuyor. Bayrak ikinci sed,
//       tek başına ölçülebilir bir davranış taşımıyor — bekçi ona güvenmiyor.
// =============================================================================
import { pool } from "../src/lib/prisma";
import { logProcessWarnings } from "../src/lib/process-warnings";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

/**
 * Kanalın stderr'ini yakala. ⚠️ İKİ FONKSİYON: `uyari()` `console.warn`,
 * yığın izi `console.error` kullanıyor. İlk yazımda yalnız `error` sarılmıştı
 * ve §1 "satır basılmadı" diye KIRMIZI verdi — satır aslında basılıyordu.
 */
const satirlar: string[] = [];
const gercekError = console.error;
const gercekWarn = console.warn;
const yakala = (...a: unknown[]) => { satirlar.push(a.map(String).join(" ")); };
console.error = yakala;
console.warn = yakala;
function kanaliSerbestBirak(): void {
  console.error = gercekError;
  console.warn = gercekWarn;
}

async function run(): Promise<void> {
  logProcessWarnings();
  logProcessWarnings(); // ikinci kurulum no-op olmalı (§4)

  // ⚠️ ÜÇ sorgu: pg'nin koşulu "kuyrukta bekleyen var" — ikisi kuyruğa hiç
  //    girmez (biri aktif olur), üçüncüsü uyarıyı doğurur.
  const c = await pool.connect();
  await Promise.all([
    c.query("SELECT pg_sleep(0.3)"),
    c.query("SELECT 2"),
    c.query("SELECT 3"),
  ]).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 500));
  c.release();

  // ── TEKRAR TESTİ AYRI BİR UYARIYLA ────────────────────────────────────────
  // ⚠️ pg'nin uyarısı `util.deprecate` ile sarılı ve SÜREÇ BAŞINA BİR KEZ basar.
  //    İlk yazımda tekrar testi ONUNLA yapılmıştı: sonda `seen` kümesini
  //    kaldırdığında bile YEŞİL kaldı, çünkü ikinci uyarı zaten hiç doğmuyordu.
  //    "Vakumen yeşil" — bekçi hiçbir şey ölçmüyordu. Tekrar KENDİ süzgecimizin
  //    işi olduğu için TEKRARLAYAN bir uyarıyla ölçülür.
  //
  // ⚠️ İMZA ÇAĞRI YERİNİ İÇERİR (bilinçli): aynı metin farklı yerlerden gelirse
  //    AYRI sorunlardır ve ayrı basılmalı. Bu yüzden tekrar TEK çağrı yerinden
  //    üretilir — üç ayrı satırdan atılsaydı üç signature doğardı ve test yanlış
  //    şeyi ölçerdi (ilk denemede tam bunu yaptı, 3 satır çıktı).
  const tekrarOncesi = satirlar.length;
  for (let i = 0; i < 3; i++) process.emitWarning("TEST-TEKRAR uyarısı", "TeksErpTestWarning");
  await new Promise((r) => setTimeout(r, 100));
  const tekrarSatirlari = satirlar
    .slice(tekrarOncesi)
    .filter((l) => l.startsWith("UYARI [node]") && l.includes("TEST-TEKRAR"));

  kanaliSerbestBirak();

  // ── §1 ETİKETLİ SATIR ─────────────────────────────────────────────────────
  console.log("\n§1 — uyarı etiketli tek satır olarak düşüyor");
  const etiketli = satirlar.find((l) => l.startsWith("UYARI [node]"));
  check("körlük zemini: en az bir satır yakalandı", satirlar.length > 0, `${satirlar.length} satır`);
  check("⭐ `UYARI [node] ...` satırı basıldı", !!etiketli, etiketli?.slice(0, 70) ?? "YOK");
  check(
    "satır uyarının kendi metnini taşıyor",
    !!etiketli && /already executing a query/.test(etiketli),
  );

  // ── §2 YIĞIN İZİ ──────────────────────────────────────────────────────────
  console.log("\n§2 — çağrı yeri (yığın izi) basılıyor");
  const iz = satirlar.find((l) => /\bat Client\.query\b/.test(l) || /pg\/lib\/client\.js/.test(l));
  check(
    "⭐ yığın izi basıldı — 'nereden geldi' sorusu log'dan cevaplanabiliyor",
    !!iz,
    iz?.split("\n")[0]?.trim().slice(0, 80) ?? "İZ YOK",
  );
  check(
    "⭐ iz `--trace-deprecation` BAYRAĞI OLMADAN elde edildi (kesinti gerektirmiyor)",
    !!iz && !process.execArgv.some((a) => a.includes("trace-deprecation")),
    `execArgv: ${JSON.stringify(process.execArgv)}`,
  );

  // ── §3 İZ ETİKETSİZ ───────────────────────────────────────────────────────
  console.log("\n§3 — iz ETİKETSİZ (bir olay = tek greplenebilir satır)");
  check(
    "⭐ yığın izi `UYARI [` ile başlamıyor (grep -c sayımı bozulmuyor)",
    !!iz && !iz.startsWith("UYARI ["),
  );

  // ── §4 TEKRAR BASILMIYOR ──────────────────────────────────────────────────
  console.log("\n§4 — aynı uyarı log'u boğmuyor (TEKRARLAYAN uyarıyla ölçülür)");
  check(
    "körlük zemini: tekrar uyarısı en az bir kez düştü",
    tekrarSatirlari.length > 0,
    `${tekrarSatirlari.length} satır`,
  );
  check(
    "⭐ üç kez atılan AYNI uyarı log'a BİR kez düştü",
    tekrarSatirlari.length === 1,
    `${tekrarSatirlari.length} satır`,
  );
  check(
    "ikinci `logProcessWarnings()` çağrısı dinleyiciyi ÇİFTLEMEDİ",
    satirlar.filter((l) => l.startsWith("UYARI [node]") && l.includes("already executing")).length === 1,
    `${satirlar.filter((l) => l.startsWith("UYARI [node]") && l.includes("already executing")).length} pg satırı`,
  );
}

run()
  .catch((e) => { kanaliSerbestBirak(); console.error("HATA:", e); fail++; })
  .finally(async () => {
    kanaliSerbestBirak();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await pool.end().catch(() => undefined);
    process.exit(fail > 0 ? 1 : 0);
  });
