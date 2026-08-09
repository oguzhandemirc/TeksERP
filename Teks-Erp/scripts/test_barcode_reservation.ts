// =============================================================================
// Test: Top barkod sayacı — TX ÖNCESİ toplu rezervasyon sözleşmesi
// Çalıştır: npx tsx scripts/test_barcode_reservation.ts
// =============================================================================
// (2026-08-10 denetimi, F-CORE-VER-001)
//
// SORUN: `roll_barcode_counters` satırının kilidi, artışı yapan transaction
// COMMIT edene kadar tutulur. Barkod uzun bir tx'in İÇİNDE alınırsa kilit o
// tx'in geri kalanı boyunca tutulur ve sistemdeki HER top girişi o tek satırda
// kuyruğa girer. Ölçüm (bench, gerçek PG):
//
//     sayaç tx İÇİNDE          → paralel istek 1345 ms bekliyor
//     sayaç tx AÇILMADAN ÖNCE  →   39 ms  (34 kat)
//
// ⚠️ KABUL KRİTERİ İKİ KOŞULLUDUR — **T1 < 100 ms VE T2 = 30/30**. Tek koşula
// bakan bir "düzeltme" üretimi durdurur: rezervasyonu havuz client'ıyla ama tx
// callback'inin İÇİNDE yapmak kilidi 2 ms'ye indirir (T1 mükemmel görünür) ama
// ikinci bir bağlantı ister ve havuzu tüketir — 30 eş zamanlı işlemin yalnız
// **3'ü** tamamlandı, kalanı `timeout exceeded when trying to connect` aldı.
// Bu yüzden §6 ve §7 birlikte durur; birini silme.
//
// SAYAÇ İZOLASYONU: testler gerçek "bugün" satırına DOKUNMAZ — helper `date`
// parametresi aldığı için uzak bir tarih kullanılır ve satırlar `finally`'de
// silinir. Aksi halde bekçi her koşumda üretimin 9.999/gün/tip kapasitesinden
// yiyordu.
// =============================================================================
import { readdirSync, readFileSync, statSync } from "fs";
import { join, resolve, relative } from "path";
import prisma, { pool } from "../src/lib/prisma";
import {
  MAX_ROLL_SEQ,
  ROLL_BARCODE_RE,
  reserveRollBarcodes,
  reserveRollBarcodesInOrder,
  generateRollBarcode,
} from "../src/services/helpers/roll-barcode.helper";

const SRC = resolve(__dirname, "../src");

/**
 * Barkodu HÂLÂ TX İÇİNDE alan yollar. Üçü BİLİNÇLİ olarak taşınmadı ve gerekçe
 * her satırda yazılı; liste **iki yönlü** denetlenir (yeni tx-içi çağrı eklense
 * de, listedeki biri düzeltilip listeden düşürülmese de kırmızı).
 *
 * ⚠️ TX-İÇİ OLMAK BURADA BİR HATA DEĞİL — birkaçında tek doğru seçenek bu.
 * `roll-finalize.helper`in çağıranlarının ikisinde (`kursun-bypass` ~1386,
 * `kursun-qc` ~866) top listesi tx'in İÇİNDE hesaplanıyor; `roll-disposition`
 * ve `batch-drop`ta barkodsuz küme claim'den SONRA okunuyor. Tx içinde kalmanın
 * bir kazancı da var: geri sarmada sayaç artışı da geri sarılır, boşluk doğmaz.
 */
const KNOWN_TX_INTERNAL: Record<string, number> = {
  "services/inventory.service.ts": 2, // KK1 ham giriş (48 satır) + 3954 (9 satır)
  "services/subcontractor.service.ts": 2, // fason çıkış (tekil) + fason kabul (toplu)
  "services/workorder-batch-drop.service.ts": 1, // parti düşürme (100 satır)
  "services/helpers/roll-finalize.helper.ts": 1,
  "services/helpers/roll-disposition.helper.ts": 1,
};

/**
 * TX İÇİNDE **TEKİL** (`generateRollBarcode`) çağıran yollar — yani N top için N
 * sayaç turu atma riski taşıyanlar. 2026-08-10'da dört yol toplu ifadeye çevrildi
 * (roll-finalize · roll-disposition · batch-drop · fason kabul); bu liste o
 * kazancın geri alınmasını yakalar.
 *
 * ⚠️ TEKİL ÇAĞRI DÖNGÜ İÇİNDEYSE ZARARLIDIR: sayaç satırının kilidi İLK turdan
 * itibaren zaten tutuluyor, dolayısıyla araya giren her ek tur kilidi o kadar
 * uzatır. Aşağıdaki iki dosyada tekil çağrı **döngüsüzdür** (tek top üretilir),
 * o yüzden meşru. Buraya yeni bir satır eklemeden önce sor: çağrı bir döngünün
 * içinde mi?
 */
const KNOWN_TX_INTERNAL_SINGULAR: Record<string, number> = {
  "services/inventory.service.ts": 2, // KK1 tek top · 3954 tek top — ikisi de döngüsüz
  "services/subcontractor.service.ts": 1, // fason çıkış: sevk başına tek çocuk
};

/** Kilidi en uzun tutan üç yolun dosyası — burada tx-içi çağrı KALMAMALI. */
const MUST_BE_CLEAN = "services/tambur.service.ts";

/**
 * Körlük zemini. Muaf listesi zaten iki yönlü denetlendiği için bu sayı ORADA
 * gereksiz görünür — ama asıl koruduğu şey `MUST_BE_CLEAN` kontrolüdür: regex
 * bozulursa (dosya taşınır, çağrı biçimi değişir) `found[tambur]` `undefined`
 * olur ve "tx-içi çağrı YOK" kontrolü **vakumen yeşil** kalır. Zemin sıfırdan
 * uzak, bugünkü gerçek sayıdan (7) rahatça aşağıda tutulur ki meşru bir taşıma
 * turu bekçiyi sebepsiz kırmızıya çevirmesin.
 */
const MIN_FILES_SCANNED = 100;
const MIN_CALLSITES = 5;

/** Testin kendi sayaç satırları — gerçek "bugün"den uzak, `finally`'de silinir. */
const TEST_DATE = new Date(Date.UTC(2031, 10, 17, 12, 0, 0));
const TEST_DAY = "171131"; // ddmmyy(TEST_DATE)

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

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/**
 * Yorumları söker — YAPISAL TARAMANIN ÖN KOŞULU. `tambur.service.ts`'teki
 * taşıma gerekçesi eski çağrıyı ALINTILIYOR (`generateRollBarcode(tx, …)`);
 * sökülmezse bekçi kendi düzelttiği dosyayı ihlal sanır. (Aynı sınıf hata
 * `test_import_cycles`te de yaşandı — bir bekçi kodu ölçmeli, yanındaki
 * cümleyi değil.)
 */
function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock
    .split("\n")
    .map((line) => {
      let quotes = 0;
      for (let i = 0; i < line.length - 1; i++) {
        const ch = line[i]!;
        if (ch === '"' || ch === "'" || ch === "`") quotes++;
        if (ch === "/" && line[i + 1] === "/" && quotes % 2 === 0) return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

/** Barkodun sayı kuyruğu (`T171131H0042` → 42). */
function seqOf(barcode: string): number {
  return Number(barcode.slice(-4));
}

/** Kuyruğu bilinen bir değere kur — ardışıklık kontrolleri sabit zeminden başlasın. */
async function setCounter(type: "H" | "F", n: number): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "roll_barcode_counters" ("day", "type", "n")
    VALUES (${TEST_DAY}, ${type}, ${n})
    ON CONFLICT ("day", "type") DO UPDATE SET "n" = ${n}
  `;
}

async function readCounter(type: "H" | "F"): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT "n" FROM "roll_barcode_counters" WHERE "day" = ${TEST_DAY} AND "type" = ${type}
  `;
  return rows.length ? Number(rows[0]!.n) : null;
}

// ── §1 YAPISAL: kilidi uzun tutan yollar tx-içi çağrı taşımıyor ─────────────
function structural(): void {
  console.log("\n--- §1 Yapısal: tx-içi barkod çağrısı ---");
  const files = walk(SRC);
  const found: Record<string, number> = {};
  const foundSingular: Record<string, number> = {};
  let total = 0;
  for (const f of files) {
    const src = stripComments(readFileSync(f, "utf8"));
    const hits = src.match(/(?:generateRollBarcode|reserveRollBarcodes\w*)\s*\(\s*tx\b/g);
    if (hits?.length) {
      found[relative(SRC, f)] = hits.length;
      total += hits.length;
    }
    const singular = src.match(/generateRollBarcode\s*\(\s*tx\b/g);
    if (singular?.length) foundSingular[relative(SRC, f)] = singular.length;
  }

  check(`körlük zemini: en az ${MIN_FILES_SCANNED} dosya tarandı`, files.length >= MIN_FILES_SCANNED, `${files.length}`);
  check(
    `körlük zemini: en az ${MIN_CALLSITES} barkod çağrı yeri bulundu`,
    total >= MIN_CALLSITES,
    `${total} — tarayıcı boşa düşmüş olabilir`,
  );

  check(
    `${MUST_BE_CLEAN} içinde tx-içi barkod çağrısı YOK`,
    !found[MUST_BE_CLEAN],
    found[MUST_BE_CLEAN] ? `${found[MUST_BE_CLEAN]} çağrı — kilit tx boyunca tutulur` : "",
  );

  // İki yönlü muaf denetimi: yeni ihlal DE, ölü muaf DA testi düşürür.
  const unexpected = Object.keys(found).filter((f) => f !== MUST_BE_CLEAN && !(f in KNOWN_TX_INTERNAL));
  check(
    "listede olmayan YENİ tx-içi çağrı yok",
    unexpected.length === 0,
    unexpected.join(", "),
  );
  const stale = Object.keys(KNOWN_TX_INTERNAL).filter((f) => !found[f]);
  check(
    "bilinen tx-içi çağrı listesi bayat değil (düzeltilen varsa listeden çıkar)",
    stale.length === 0,
    stale.join(", "),
  );
  const drifted = Object.entries(KNOWN_TX_INTERNAL).filter(([f, n]) => found[f] !== undefined && found[f] !== n);
  check(
    "bilinen dosyalardaki çağrı SAYILARI değişmedi",
    drifted.length === 0,
    drifted.map(([f, n]) => `${f}: beklenen ${n}, bulunan ${found[f]}`).join(" | "),
  );

  // TEKİL biçim ayrıca izlenir: toplu ifadeye çevrilen dört yolun geri alınması
  // yukarıdaki toplam sayıyı DEĞİŞTİRMEZ (iki biçim de aynı regex'e düşer), yani
  // bu kontrol olmadan regresyon sessizce geçerdi.
  const singularUnexpected = Object.keys(foundSingular).filter((f) => !(f in KNOWN_TX_INTERNAL_SINGULAR));
  check(
    "tx içinde TEKİL barkod çağrısı yalnız döngüsüz yollarda (toplu ifade geri alınmamış)",
    singularUnexpected.length === 0,
    singularUnexpected.map((f) => `${f}: ${foundSingular[f]}`).join(", "),
  );
  const singularStale = Object.keys(KNOWN_TX_INTERNAL_SINGULAR).filter((f) => !foundSingular[f]);
  check(
    "tekil çağrı listesi bayat değil",
    singularStale.length === 0,
    singularStale.join(", "),
  );
  const singularDrift = Object.entries(KNOWN_TX_INTERNAL_SINGULAR).filter(
    ([f, n]) => foundSingular[f] !== undefined && foundSingular[f] !== n,
  );
  check(
    "tekil çağrı SAYILARI değişmedi",
    singularDrift.length === 0,
    singularDrift.map(([f, n]) => `${f}: beklenen ${n}, bulunan ${foundSingular[f]}`).join(" | "),
  );
}

// ── §2-§5 DAVRANIŞ ──────────────────────────────────────────────────────────
async function behaviour(): Promise<void> {
  console.log("\n--- §2 Toplu rezervasyon: ardışık + biçimli ---");
  await setCounter("H", 0);
  const five = await reserveRollBarcodes(prisma, "H", 5, TEST_DATE);
  check("5 barkod döndü", five.length === 5, `${five.length}`);
  check("hepsi biçim sözleşmesine uyuyor", five.every((b) => ROLL_BARCODE_RE.test(b)), five.join(","));
  check(
    "ardışık ve 1'den başlıyor",
    five.map(seqOf).join(",") === "1,2,3,4,5",
    five.map(seqOf).join(","),
  );
  check("sayaç tam olarak 5 arttı", (await readCounter("H")) === 5, String(await readCounter("H")));

  // TEK ifade sözleşmesi: 5 barkod için sayaç 5 artmalı, 5 ayrı tur değil.
  const next = await reserveRollBarcodes(prisma, "H", 3, TEST_DATE);
  check("ikinci parti kaldığı yerden devam ediyor", next.map(seqOf).join(",") === "6,7,8", next.map(seqOf).join(","));

  console.log("\n--- §3 Sıra koruması (karışık tip) ---");
  await setCounter("H", 100);
  await setCounter("F", 200);
  const types = ["H", "F", "H", "F", "F", "H"] as const;
  const ordered = await reserveRollBarcodesInOrder(prisma, [...types], TEST_DATE);
  check("dizi uzunluğu korunuyor", ordered.length === types.length, `${ordered.length}`);
  // ⚠️ ASIL KONTROL: barkodun tipi, istenen SLOT'un tipiyle aynı olmalı. Tip
  // bazında gruplayıp düz döndüren bir uygulama burada kırmızı verir — ve o hata
  // sahada fiziksel toplara YANLIŞ etiket bastırırdı (hata yok, log yok).
  const slotOk = ordered.every((b, i) => b[7] === types[i]);
  check("her barkodun tipi kendi slot'unun tipiyle eşleşiyor", slotOk, ordered.join(","));
  check(
    "H slot'ları kendi içinde ardışık",
    ordered.filter((_, i) => types[i] === "H").map(seqOf).join(",") === "101,102,103",
    ordered.filter((_, i) => types[i] === "H").map(seqOf).join(","),
  );
  check(
    "F slot'ları kendi içinde ardışık",
    ordered.filter((_, i) => types[i] === "F").map(seqOf).join(",") === "201,202,203",
    ordered.filter((_, i) => types[i] === "F").map(seqOf).join(","),
  );

  console.log("\n--- §4 Sıfır/negatif: sayaca DOKUNULMAZ ---");
  await setCounter("H", 500);
  const zero = await reserveRollBarcodes(prisma, "H", 0, TEST_DATE);
  check("count=0 → boş dizi", zero.length === 0);
  check("count=0 sayacı ARTIRMADI", (await readCounter("H")) === 500, String(await readCounter("H")));
  const emptyOrder = await reserveRollBarcodesInOrder(prisma, [], TEST_DATE);
  check("boş tip listesi → boş dizi, sayaç sabit", emptyOrder.length === 0 && (await readCounter("H")) === 500);

  console.log("\n--- §5 Eşzamanlılık: mükerrer barkod YOK ---");
  await setCounter("F", 0);
  const N = 20;
  const batches = await Promise.all(
    Array.from({ length: N }, () => reserveRollBarcodes(prisma, "F", 3, TEST_DATE)),
  );
  const all = batches.flat();
  check(`${N} paralel × 3 = ${N * 3} barkod üretildi`, all.length === N * 3, `${all.length}`);
  check("hiç mükerrer YOK", new Set(all).size === all.length, `${all.length - new Set(all).size} mükerrer`);
  const seqs = all.map(seqOf).sort((a, b) => a - b);
  check(
    "numaralar boşluksuz 1..60 aralığını dolduruyor",
    seqs[0] === 1 && seqs[seqs.length - 1] === N * 3,
    `${seqs[0]}..${seqs[seqs.length - 1]}`,
  );
  // Aynı parti içindeki 3 numara ARDIŞIK olmalı — tek ifade garantisi.
  check(
    "her partinin 3 numarası kendi içinde ardışık (tek ifade)",
    batches.every((b) => seqOf(b[1]!) === seqOf(b[0]!) + 1 && seqOf(b[2]!) === seqOf(b[0]!) + 2),
  );

  console.log("\n--- §5b Kapasite tavanı ---");
  await setCounter("H", MAX_ROLL_SEQ - 2);
  let overflowed = false;
  try {
    await reserveRollBarcodes(prisma, "H", 5, TEST_DATE);
  } catch {
    overflowed = true;
  }
  check(`tavanı aşan toplu rezervasyon reddediliyor (${MAX_ROLL_SEQ})`, overflowed);
  // Tekil yol da aynı helper'dan geçtiği için aynı sözleşmeyi taşımalı.
  await setCounter("F", MAX_ROLL_SEQ);
  let singleOverflowed = false;
  try {
    await generateRollBarcode(prisma, "F", TEST_DATE);
  } catch {
    singleOverflowed = true;
  }
  check("tekil generateRollBarcode da tavanda reddediyor", singleOverflowed);
}

// ── §6/§7 ÖLÇÜM: kabul kriterinin İKİ koşulu ────────────────────────────────
/** Üretim deseni: rezervasyon tx AÇILMADAN ÖNCE, sonra uzun tx. */
async function productionFlow(workMs: number): Promise<void> {
  await reserveRollBarcodes(prisma, "H", 3, TEST_DATE);
  await prisma.$transaction(
    async () => {
      await new Promise((r) => setTimeout(r, workMs));
    },
    { timeout: 30_000, maxWait: 20_000 },
  );
}

const T1_LIMIT_MS = 100;
const T2_CONCURRENCY = 30;

async function measure(): Promise<void> {
  console.log("\n--- §6 T1: uzun tx koşarken paralel rezervasyonun beklemesi ---");
  await setCounter("H", 0);
  const busy = productionFlow(1500);
  await new Promise((r) => setTimeout(r, 200)); // tx'in açılmasını bekle
  const t0 = Date.now();
  await reserveRollBarcodes(prisma, "H", 1, TEST_DATE);
  const waited = Date.now() - t0;
  await busy;
  check(
    `T1: paralel rezervasyon < ${T1_LIMIT_MS} ms bekledi`,
    waited < T1_LIMIT_MS,
    `${waited} ms (sayaç tx içindeyken ölçülen: 1345 ms)`,
  );

  console.log("\n--- §7 T2: havuz sağlığı (T1'i tek başına kabul etme) ---");
  await setCounter("H", 0);
  const results = await Promise.all(
    Array.from({ length: T2_CONCURRENCY }, () =>
      productionFlow(800)
        .then(() => true)
        .catch(() => false),
    ),
  );
  const ok = results.filter(Boolean).length;
  check(
    `T2: ${T2_CONCURRENCY} eş zamanlı işlemin TAMAMI tamamlandı`,
    ok === T2_CONCURRENCY,
    `${ok}/${T2_CONCURRENCY} — havuz client'ını tx açıkken kullanan varyantta 3/30 ölçüldü`,
  );
}

async function main(): Promise<void> {
  console.log("=== Top barkod sayacı: tx öncesi rezervasyon sözleşmesi ===");
  try {
    structural();
    await behaviour();
    await measure();
  } finally {
    // Testin sayaç satırlarını temizle — üretimin "bugün" satırına hiç dokunulmadı.
    await prisma
      .$executeRaw`DELETE FROM "roll_barcode_counters" WHERE "day" = ${TEST_DAY}`
      .catch(() => undefined);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
  }
  process.exit(fail > 0 ? 1 : 0);
}

void main();
