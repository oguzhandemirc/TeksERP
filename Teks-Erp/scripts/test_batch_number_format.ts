// =============================================================================
// Test: PARTİ NO biçimi — kısa dönen no (P01…P99) + eski günlük kalıp
// Çalıştır: npx tsx scripts/test_batch_number_format.ts
// =============================================================================
// İKİ REJİM var ve bekçi İKİSİNİ DE ölçer (`batch.shortNumberEnabled`):
//   • AÇIK (varsayılan) → `P01 … P99`, 99'dan sonra P01'e SARAR. Tarih taşımaz,
//     BENZERSİZ DEĞİLDİR (2026-08-05 kullanıcı kararı — numaralı fiziksel plaka).
//   • KAPALI            → eski `P + GGAAYY + SIRA` (dolgusuz günlük sıra).
//
// Kilitlenen sessiz bozulmalar:
//   1) SAYAÇ KAYNAĞI ESKİ KODLARI GÖRÜRSE — `readLastShortBatchSeqTx` regex'i
//      gevşerse bayrak ilk açıldığında sayaç P01 yerine "son günlük sıra + 1"den
//      başlar (sahada P29'dan başlamak gibi). Sessiz: kimse fark etmez.
//   2) SARMA KIRILIRSA — P99'dan sonra P100 üretmek `VarChar(64)`'e sığar ve hata
//      VERMEZ; fabrikanın 99'luk fiziksel plaka setiyle bağ sessizce kopar.
//   3) KİLİT DÜŞERSE / SONRAYA ALINIRSA — `@unique` bu migration'da kaldırıldığı
//      için yarışı tutan TEK şey advisory lock. Düşerse aynı gün doğan iki parti
//      sessizce aynı kodu alır (klasik TOCTOU; KK1 guard'ında birebir yaşandı).
//   4) DOLGU / İSTİSNA SIZMASI — günlük kalıp dolgusuz KALMALI; SIP/İE/CV/RK/FS
//      ise 4 hane dolgulu KALMALI (okutulan kodlar, sabit uzunluk varsayan
//      parser yolları var).
//   5) SIRALAMA — `orderBy: { batchNumber }` hem eski (sözlüksel≠sayısal) hem yeni
//      (numara sarıyor: P01, P99'dan YENİ olabilir) biçimde YANLIŞ sıra üretir.
//   6) KISIT GERİ GELİRSE — canlı DB'de `batches_batchNumber_key` yeniden doğarsa
//      sarma ilk tekrarda 500 verir ve üretim durur.
//
// 0-5 sahte tx ile saf (DB'ye YAZMAZ), 6-7 canlı veriyi SALT-OKUR.
// =============================================================================

import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { generateBatchNumberTx, BATCH_NUMBER_LOCK_NS } from "../src/services/batch.service";
import { DUPLICATE_GUARD_LOCK_NS } from "../src/services/helpers/duplicate-guard.helper";
import {
  SHORT_BATCH_MAX,
  SHORT_BATCH_MIN,
  buildDailyCode,
  buildShortBatchCode,
  dailyCodePrefix,
  nextShortBatchSeq,
  parseShortBatchCode,
} from "../src/utils/code-format";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * `generateBatchNumberTx`'in dokunduğu HER yüzeyi taşıyan minimum sahte tx (DB yok):
 * advisory lock (`$executeRaw`), kısa-parti okuması (`$queryRaw`), günlük okuma
 * (`batch.findMany`) ve bayrak (`systemSetting.findUnique`).
 *
 * `calls` çağrı SIRASINI kaydeder — kilidin okumalardan ÖNCE alındığı ancak böyle
 * doğrulanabilir (§3). Sıra kaydedilmeseydi kilidi fonksiyonun SONUNA taşımak
 * hiçbir testi kırmazdı ve koruma sessizce ölürdü.
 */
function stubTx(opts: {
  shortEnabled: boolean;
  /** Kısa-parti sorgusunun döneceği en son kod (yoksa null). */
  lastShort?: string | null;
  /** Günlük rejimde `batch.findMany`'nin göreceği kodlar. */
  daily?: string[];
}): { tx: Prisma.TransactionClient; calls: string[]; sqlPattern: () => string | null } {
  const calls: string[] = [];
  let sqlPattern: string | null = null;
  const tx = {
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      calls.push(/pg_advisory_xact_lock/.test(sql) ? `lock(${values.join(",")})` : "execRaw");
      return 1;
    },
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      calls.push("queryLastShort");
      // PG'nin `~` süzgecini ÜRÜNÜN KENDİ deseniyle taklit et — desen sabitlenirse
      // bekçi ile ürün ayrışır ve gevşeyen bir süzgeç sessizce geçerdi.
      const m = sql.match(/~\s*'(\^[^']+)'/);
      sqlPattern = m ? (m[1] as string) : null;
      const last = opts.lastShort ?? null;
      if (!last || !sqlPattern) return [];
      return new RegExp(sqlPattern).test(last) ? [{ batchNumber: last }] : [];
    },
    batch: {
      findMany: async (args: { where: { batchNumber: { startsWith: string } } }) => {
        calls.push("findManyDaily");
        const p = args.where.batchNumber.startsWith;
        return (opts.daily ?? [])
          .filter((c) => c.startsWith(p))
          .map((batchNumber) => ({ batchNumber }));
      },
    },
    systemSetting: {
      findUnique: async () => {
        calls.push("readFlag");
        return { value: opts.shortEnabled };
      },
    },
  } as unknown as Prisma.TransactionClient;
  return { tx, calls, sqlPattern: () => sqlPattern };
}

// Sabit an — fabrika takvim günü 05.08.2026 (12:00 Europe/Istanbul).
const D = new Date("2026-08-05T09:00:00.000Z");
const PFX = "P050826";

async function main(): Promise<void> {
  // ── 0) Saf yardımcılar ────────────────────────────────────────────────────
  console.log("\n── 0) Saf yardımcılar (biçim + sarma aritmetiği) ──");
  check("aralık 1–99", SHORT_BATCH_MIN === 1 && SHORT_BATCH_MAX === 99);
  check(
    "iki hane dolgulu biçim",
    buildShortBatchCode(1) === "P01" &&
      buildShortBatchCode(7) === "P07" &&
      buildShortBatchCode(42) === "P42" &&
      buildShortBatchCode(99) === "P99",
    buildShortBatchCode(7),
  );
  check(
    "kısa kod parse edilir",
    parseShortBatchCode("P01") === 1 && parseShortBatchCode("P42") === 42,
  );
  check(
    "ESKİ GÜNLÜK KOD kısa sayılmaz (sayaç onu görmemeli)",
    parseShortBatchCode("P0508260019") === null && parseShortBatchCode("P0508261") === null,
  );
  check(
    "aralık dışı / bozuk değer reddedilir",
    parseShortBatchCode("P00") === null &&
      parseShortBatchCode("P1") === null &&
      parseShortBatchCode("X42") === null &&
      parseShortBatchCode(null) === null,
  );
  check("sarma: 42 → 43", nextShortBatchSeq(42) === 43);
  check("sarma: 98 → 99", nextShortBatchSeq(98) === 99);
  check("SARMA: 99 → 1 (100 ÜRETMEZ)", nextShortBatchSeq(99) === 1, String(nextShortBatchSeq(99)));
  check("kayıt yoksa 1'den başlar", nextShortBatchSeq(null) === 1);

  // ── 1) Kısa rejim (bayrak AÇIK) ──────────────────────────────────────────
  console.log("\n── 1) Kısa rejim — bayrak AÇIK ──");
  const s1 = stubTx({ shortEnabled: true, lastShort: null });
  check("hiç kısa parti yokken P01", (await generateBatchNumberTx(s1.tx, D)) === "P01");

  const s2 = stubTx({ shortEnabled: true, lastShort: "P42" });
  check("P42 → P43", (await generateBatchNumberTx(s2.tx, D)) === "P43");

  const s3 = stubTx({ shortEnabled: true, lastShort: "P99" });
  const wrapped = await generateBatchNumberTx(s3.tx, D);
  check("P99 → P01 (SARMA)", wrapped === "P01", wrapped);

  // 1'inci sessiz bozulma: eski günlük kodlar sayaca sızarsa P01 yerine P29 doğar.
  const s4 = stubTx({ shortEnabled: true, lastShort: "P05082628", daily: [`${PFX}28`] });
  const afterLegacyOnly = await generateBatchNumberTx(s4.tx, D);
  check(
    "DB'de yalnız ESKİ kodlar varken P01'den başlar (sayaç eskiyi görmez)",
    afterLegacyOnly === "P01",
    afterLegacyOnly,
  );
  check("kısa rejimde günlük sorgu HİÇ koşmaz", !s4.calls.includes("findManyDaily"), s4.calls.join(" → "));

  // SQL SÜZGECİNİN KENDİSİ — `parseShortBatchCode` ikinci hat olarak yanlış satırı
  // zaten eler, ama süzgeç gevşerse sorgu "en son satır" olarak bir GÜNLÜK kod
  // döndürür, parse null verir ve sayaç HER SEFERİNDE P01'e düşer: canlı P01
  // dururken ikinci bir P01 doğar. İki hat da ayrı ayrı doğrulanmalı.
  const pat = s4.sqlPattern();
  check("kısa-parti sorgusunun deseni yakalandı (körlük zemini)", pat !== null, pat ?? "YOK");
  if (pat) {
    const re = () => new RegExp(pat);
    check(
      "SQL süzgeci ESKİ GÜNLÜK kodları DIŞLAR",
      !re().test("P0508260019") && !re().test("P0508261") && !re().test("P05082628"),
      pat,
    );
    check("SQL süzgeci P00'ı DIŞLAR", !re().test("P00"), pat);
    check(
      "SQL süzgeci P01–P99'u KABUL EDER",
      re().test("P01") && re().test("P42") && re().test("P99"),
      pat,
    );
  }

  // ── 2) Kilit: alınıyor mu ve İLK mi? ─────────────────────────────────────
  console.log("\n── 2) Advisory lock ──");
  check(
    "kilit alınıyor (kısa rejim)",
    s2.calls.some((c) => c.startsWith("lock(")),
    s2.calls.join(" → "),
  );
  check(
    "kilit HER ŞEYDEN ÖNCE (kısa rejim)",
    s2.calls.findIndex((c) => c.startsWith("lock(")) === 0,
    s2.calls.join(" → "),
  );
  // Aynı namespace'te olsalardı ham giriş tuzağı ile parti numaralandırma birbirini
  // SESSİZCE serileştirirdi (yanlış sonuç değil, teşhisi imkânsız gecikme). Sabit
  // yazmak yerine KK1'in kendi sabitiyle karşılaştırılır — biri değişirse bekçi de
  // kendiliğinden doğru soruyu sormaya devam eder.
  check(
    `kilit namespace'i KK1'inkinden (${DUPLICATE_GUARD_LOCK_NS}) AYRI`,
    BATCH_NUMBER_LOCK_NS !== DUPLICATE_GUARD_LOCK_NS &&
      s2.calls[0] === `lock(${BATCH_NUMBER_LOCK_NS},1)`,
    s2.calls[0],
  );

  // ── 3) Günlük rejim (bayrak KAPALI) — eski davranış BİREBİR ──────────────
  console.log("\n── 3) Günlük rejim — bayrak KAPALI (eski davranış) ──");
  const off = (daily: string[]) => stubTx({ shortEnabled: false, daily });

  const o1 = off([]);
  const first = await generateBatchNumberTx(o1.tx, D);
  check("boş günde ilk parti 1'den başlar", first === `${PFX}1`, first);
  check("sıfır dolgusu YOK", /^P\d{6}[1-9]\d*$/.test(first), first);
  check(
    "kilit günlük rejimde DE alınıyor ve İLK (@unique kalktı, yerini o aldı)",
    o1.calls[0] === `lock(${BATCH_NUMBER_LOCK_NS},1)`,
    o1.calls.join(" → "),
  );

  check("tek haneli devam", (await generateBatchNumberTx(off([`${PFX}8`]).tx, D)) === `${PFX}9`);
  check(
    "9 → 10 (hane büyür, dolgu yok)",
    (await generateBatchNumberTx(off([`${PFX}9`]).tx, D)) === `${PFX}10`,
  );
  check(
    "eski dolgulu max okunur (P…0019 → 20)",
    (await generateBatchNumberTx(off([`${PFX}0019`]).tx, D)) === `${PFX}20`,
  );
  check(
    "karışık biçimde NUMERIC max+1",
    (await generateBatchNumberTx(off([`${PFX}0001`, `${PFX}0019`, `${PFX}20`, `${PFX}21`]).tx, D)) ===
      `${PFX}22`,
  );
  check(
    "sözlüksel max tuzağına düşmez (9 vs 10)",
    (await generateBatchNumberTx(off([`${PFX}9`, `${PFX}10`]).tx, D)) === `${PFX}11`,
  );
  check(
    "9999 tavanı yok (→ 10000, 5 hane)",
    (await generateBatchNumberTx(off([`${PFX}9999`]).tx, D)) === `${PFX}10000`,
  );
  // 22:30Z = ertesi gün 01:30 Europe/Istanbul → gece vardiyası BUGÜNÜ görmeli.
  check(
    "gün = fabrika takvim günü (01:30 → 06.08)",
    (await generateBatchNumberTx(off([]).tx, new Date("2026-08-05T22:30:00.000Z"))) === "P0608261",
  );

  // ── 4) İstisnanın sızmaması ──────────────────────────────────────────────
  console.log("\n── 4) Diğer kodlar dolgulu KALMALI ──");
  check(
    "prefix yardımcısı değişmedi",
    dailyCodePrefix("P", D) === PFX && PFX.length === 7,
    dailyCodePrefix("P", D),
  );
  check(
    "SIP/İE/CV hâlâ 4 hane dolgulu (istisna sızmadı)",
    buildDailyCode("SIP", 1, D) === "SIP0508260001" &&
      buildDailyCode("IE", 19, D) === "IE0508260019" &&
      buildDailyCode("CV", 1, D) === "CV0508260001",
    buildDailyCode("SIP", 1, D),
  );

  // ── 5) SIRALAMA: hiçbir yüzey batchNumber ile sıralamamalı ───────────────
  console.log("\n── 5) Sıralama sözleşmesi (kaynak taraması) ──");
  const srcRoot = join(__dirname, "..", "src");
  const files: string[] = [];
  (function walk(dir: string): void {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts")) files.push(p);
    }
  })(srcRoot);

  // Körlük zemini: tarayıcı boşa düşerse "ihlal yok" ile "hiç bakılmadı" aynı
  // yeşile çıkar. src/ bugün 300+ dosya.
  check("kaynak tarayıcı gerçekten dosya buldu", files.length > 150, `${files.length} dosya`);

  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    // `orderBy: { batchNumber: ...` ve `orderBy: [{ batchNumber: ...`
    if (/orderBy:\s*\[?\s*\{\s*batchNumber\s*:/.test(src)) {
      offenders.push(f.slice(srcRoot.length + 1));
    }
  }
  check(
    "src/ içinde `orderBy: { batchNumber }` YOK",
    offenders.length === 0,
    offenders.join(", ") || "temiz",
  );

  // ── 6) Canlı DB: benzersizlik kısıtı GERÇEKTEN kalkmış olmalı ────────────
  console.log("\n── 6) Canlı DB kısıtları ──");
  const idx = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'batches'`,
  );
  const names = idx.map((i) => i.indexname);
  check(
    "batches_batchNumber_key KALDIRILDI (sarma 500 vermesin)",
    !names.includes("batches_batchNumber_key"),
    names.join(", "),
  );
  check(
    "batches_createdAt_idx VAR (sayacın kaynağı onu kullanır)",
    names.includes("batches_createdAt_idx"),
    names.join(", "),
  );

  // ── 7) Canlı veri (salt-okunur) ──────────────────────────────────────────
  console.log("\n── 7) Canlı veri (salt-okunur) ──");
  const live = await prisma.batch.findMany({ select: { batchNumber: true } });
  const daily = live.filter((b) => /^P\d{6}\d+$/.test(b.batchNumber));
  const short = live.filter((b) => parseShortBatchCode(b.batchNumber) !== null);
  check(
    "biçimlerden en az biri canlıda mevcut",
    daily.length + short.length > 0,
    `günlük ${daily.length} · kısa ${short.length} / toplam ${live.length}`,
  );

  // ESKİ günlük kodlarda aynı gün + aynı sıra iki kez üretilmemeli. Kısa kodlara
  // UYGULANMAZ — orada tekrar TASARIMIN KENDİSİ, ihlal değil.
  const seqByDay = new Map<string, Map<number, string[]>>();
  for (const b of daily) {
    const day = b.batchNumber.slice(1, 7);
    const seq = parseInt(b.batchNumber.slice(7), 10);
    if (!seqByDay.has(day)) seqByDay.set(day, new Map());
    const m = seqByDay.get(day)!;
    m.set(seq, [...(m.get(seq) ?? []), b.batchNumber]);
  }
  const dupes: string[] = [];
  for (const [day, m] of seqByDay) {
    for (const [seq, codes] of m) {
      if (codes.length > 1) dupes.push(`${day}#${seq}: ${codes.join(" / ")}`);
    }
  }
  check(
    "eski günlük kodlarda aynı gün+sıra çifti YOK",
    dupes.length === 0,
    dupes.join(" | ") || "temiz",
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("PATLADI:", e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
