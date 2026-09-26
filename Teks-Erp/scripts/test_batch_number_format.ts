// =============================================================================
// Test: PARTİ NO biçimi — kısa dönen no (P01…P99) + eski günlük kalıp
// Çalıştır: npx tsx scripts/test_batch_number_format.ts
// =============================================================================
// İKİ REJİM var ve bekçi İKİSİNİ DE ölçer (`batch.shortNumberEnabled`):
//   • AÇIK (varsayılan) → `P01 … P99`, 99'dan sonra P01'e SARAR. Tarih taşımaz,
//     BENZERSİZ DEĞİLDİR (2026-08-05 kullanıcı kararı — numaralı fiziksel plaka).
//     R6 (2026-09-26): sarma global kalır, AYNI iş emrinde dolu numara atlanır; 99'u da
//     doluysa 409. Negatif sonda: atlama kapatılınca 5, atlama sarmadan ilerleyince 3 R6 ❌.
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
import { buildDailyCode, dailyCodePrefix } from "../src/utils/code-format";
import { numberSeriesCatalogEntry } from "../src/constants/number-series-catalog";
import { resolveSeriesFormat } from "../src/services/number-series.service";
import {
  formatSeriesCode,
  matchesSeries,
  seriesCodeSeq,
  seriesDigitsQuantifier,
  seriesPosixRegex,
  type NumberSeriesFormat,
} from "../src/services/helpers/series-format.helper";
import { nextCounterSeq, seriesCounterReadsLastBorn } from "../src/services/helpers/series-counter.helper";

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
  /** Aynı iş emrinde DOLU parti numaraları (R6 doluluk sorgusu). */
  woTaken?: string[];
}): {
  tx: Prisma.TransactionClient;
  calls: string[];
  sqlPattern: () => string | null;
  sqlFilter: () => ((code: string) => boolean) | null;
} {
  const calls: string[] = [];
  let sqlPattern: string | null = null;
  let sqlFilter: ((code: string) => boolean) | null = null;
  const tx = {
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      calls.push(/pg_advisory_xact_lock/.test(sql) ? `lock(${values.join(",")})` : "execRaw");
      return 1;
    },
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push("queryLastShort");
      // PG'nin `~` süzgecini ÜRÜNÜN KENDİ deseniyle taklit et — desen sabitlenirse
      // bekçi ile ürün ayrışır ve gevşeyen bir süzgeç sessizce geçerdi.
      // ⚠️ Desen artık SQL METNİNDE değil PARAMETREDE (biçimden türetiliyor);
      // metinden okuyan eski kol sessizce `null` görüp HER kodu geçirirdi.
      const pat = values.find((v) => typeof v === "string" && v.startsWith("^"));
      sqlPattern = typeof pat === "string" ? pat : null;
      // Süzgeç İKİ AYAKLI (desen + sayısal aralık); taklit de iki ayaklı olmalı,
      // yoksa bekçi ürünün yalnız yarısını ölçer ve öteki yarısı gevşeyebilir.
      const sayilar = values.filter((v): v is number => typeof v === "number");
      const [dMin, dMax] = [sayilar[0] ?? 1, sayilar[1] ?? Number.MAX_SAFE_INTEGER];
      sqlFilter = (code: string): boolean => {
        if (!sqlPattern || !new RegExp(sqlPattern).test(code)) return false;
        const kuyruk = code.match(/[0-9]+$/)?.[0];
        if (kuyruk === undefined) return false;
        const n = Number(kuyruk);
        return n >= dMin && n <= dMax;
      };
      const last = opts.lastShort ?? null;
      if (!last) return [];
      return sqlFilter(last) ? [{ batchNumber: last }] : [];
    },
    batch: {
      findMany: async (args: { where: { workOrderId?: string; batchNumber?: { startsWith: string } } }) => {
        if (args.where.workOrderId) {
          calls.push("findTakenInWo");
          return (opts.woTaken ?? []).map((batchNumber) => ({ batchNumber }));
        }
        if (!args.where.batchNumber) throw new Error("beklenmeyen batch.findMany");
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
  return { tx, calls, sqlPattern: () => sqlPattern, sqlFilter: () => sqlFilter };
}

// Sabit an — fabrika takvim günü 05.08.2026 (12:00 Europe/Istanbul).
const D = new Date("2026-08-05T09:00:00.000Z");
const PFX = "P050826";

async function main(): Promise<void> {
  // ── 0) Saf yardımcılar ────────────────────────────────────────────────────
  // ⚠️ 2026-09-23'te AYNI SORULAR, YENİ KAYNAK: aralık · dolgu · sarma artık
  // `code-format.ts` sabitleri değil `batchShort` SERİSİNİN AYARLARI. Bu bölümün
  // asıl iddiası "VARSAYILAN = BUGÜNKÜ DAVRANIŞ"tır — ayar açılırken davranışın
  // değişmediği ölçülmezse, açma işinin kendisi sessiz bir göç olurdu.
  console.log("\n── 0) Saf yardımcılar (biçim + sarma, AYARDAN) ──");
  const seed = numberSeriesCatalogEntry("batchShort");
  check(
    "⭐ TOHUM = BUGÜNKÜ DAVRANIŞ: P · 2 hane · tarihsiz · 1–99 · sarma AÇIK",
    seed.seedPrefix === "P" &&
      seed.seedDigits === 2 &&
      seed.seedDateSegment === "NONE" &&
      seed.seedSeparator === "" &&
      seed.seedMaxValue === 99 &&
      seed.seedWrap === true,
    `${seed.seedPrefix}/${seed.seedDigits}/${seed.seedDateSegment}/${seed.seedMaxValue}/${seed.seedWrap}`,
  );
  const kisa = resolveSeriesFormat("batchShort");
  check("aralık 1–99 (ayardan)", (kisa.startValue ?? 1) === 1 && kisa.maxValue === 99);
  check("sarmalı seri sayacı EN SON DOĞAN koddan okur", seriesCounterReadsLastBorn(kisa));
  check(
    "iki hane dolgulu biçim",
    formatSeriesCode(kisa, 1) === "P01" &&
      formatSeriesCode(kisa, 7) === "P07" &&
      formatSeriesCode(kisa, 42) === "P42" &&
      formatSeriesCode(kisa, 99) === "P99",
    formatSeriesCode(kisa, 7),
  );
  check("kısa kod parse edilir", seriesCodeSeq(kisa, "P01") === 1 && seriesCodeSeq(kisa, "P42") === 42);
  check(
    "ESKİ GÜNLÜK KOD kısa sayılmaz (sayaç onu görmemeli)",
    seriesCodeSeq(kisa, "P0508260019") === null && seriesCodeSeq(kisa, "P0508261") === null,
  );
  check(
    "aralık dışı / bozuk değer reddedilir",
    seriesCodeSeq(kisa, "P00") === null &&
      seriesCodeSeq(kisa, "P1") === null &&
      seriesCodeSeq(kisa, "X42") === null &&
      seriesCodeSeq(kisa, null) === null,
  );
  check("sarma: 42 → 43", nextCounterSeq(kisa, 42, "kısa") === 43);
  check("sarma: 98 → 99", nextCounterSeq(kisa, 98, "kısa") === 99);
  check("SARMA: 99 → 1 (100 ÜRETMEZ)", nextCounterSeq(kisa, 99, "kısa") === 1, String(nextCounterSeq(kisa, 99, "kısa")));
  check("kayıt yoksa 1'den başlar", nextCounterSeq(kisa, 0, "kısa") === 1);

  // ── 0b) AYAR GERÇEKTEN BAĞLI MI? (pozitif sonda) ──────────────────────────
  // ⚠️ Yukarıdaki kol tek başına SAHTE YEŞİL verebilir: ayar hiç okunmuyor,
  // değerler hâlâ koda gömülü olsa da "varsayılan bugünküyle aynı" iddiası
  // GEÇERDİ. Bu yüzden ayarı DEĞİŞTİRİP davranışın DEĞİŞTİĞİ de ölçülür.
  console.log("\n── 0b) Ayar değişince davranış DEĞİŞİYOR mu ──");
  const genis: NumberSeriesFormat = { ...kisa, digits: 3, maxValue: 999 };
  check("hane 3 → P001 (dolgu ayardan)", formatSeriesCode(genis, 1) === "P001", formatSeriesCode(genis, 1));
  check("aralık 999 → 99'da SARMAZ", nextCounterSeq(genis, 99, "kısa") === 100);
  check("aralık 999 → 999'da SARAR", nextCounterSeq(genis, 999, "kısa") === 1);
  const oneksiz: NumberSeriesFormat = { ...kisa, prefix: "PRT" };
  check("ön ek PRT → PRT42", formatSeriesCode(oneksiz, 42) === "PRT42", formatSeriesCode(oneksiz, 42));
  check(
    "⭐ SQL süzgeci de ön eki AYARDAN alır (K27: sabit süzgeç her satırı eler)",
    seriesPosixRegex(oneksiz).startsWith("^PRT") && !seriesPosixRegex(oneksiz).startsWith("^P["),
    seriesPosixRegex(oneksiz),
  );
  const sarmasiz: NumberSeriesFormat = { ...kisa, wrap: false };
  check("sarma KAPALI seri EN SON DOĞANI okumaz (max'a döner)", !seriesCounterReadsLastBorn(sarmasiz));

  // ── 0d) HANE GENİŞLİĞİ: SINIRLI seri SABİT, sınırsız seri ESNEK ──────────
  // ⚠️ BU KOL BİR NEGATİF SONDANIN SESSİZ KALMASIYLA DOĞDU (2026-09-23):
  // `seriesDigitsQuantifier` daraltmasını geri alan sonda 56/0 verdi, çünkü
  // "SQL süzgeci eski günlük kodları dışlar" iddiasını o an SAYISAL ARALIK
  // ayağı tek başına taşıyordu. Yani daraltma KORUNMASIZDI: biri onu geri
  // alsa hiçbir kapı konuşmayacaktı. Sonda ısırmıyorsa kapı kördür.
  check(
    "⭐ SINIRLI seride hane SABİT (`{2}`) — komşu serinin uzun kodu kendi kodu sanılmaz",
    seriesDigitsQuantifier(kisa) === "{2}" && !matchesSeries(kisa, "P0508260019"),
    seriesDigitsQuantifier(kisa),
  );
  const sinirsiz: NumberSeriesFormat = { ...kisa, maxValue: null, wrap: false };
  check(
    "⭐ SINIRSIZ seride hane ESNEK (`{2,}`) — 99'u aşan kod okutulabilir kalır (E-1-04)",
    seriesDigitsQuantifier(sinirsiz) === "{2,}" && matchesSeries(sinirsiz, "P100"),
    seriesDigitsQuantifier(sinirsiz),
  );
  check(
    "⭐ SQL deseni ile bellek-içi yüklem AYNI genişlikten doğar (boğaz ikizi)",
    seriesPosixRegex(kisa).endsWith("[0-9]{2}$") && seriesPosixRegex(sinirsiz).endsWith("[0-9]{2,}$"),
    `${seriesPosixRegex(kisa)} / ${seriesPosixRegex(sinirsiz)}`,
  );

  // ── 0c) HANE KÜÇÜLTME → BÜYÜTME: öngörülebilirlik (2 → 1 → 2) ─────────────
  // Kullanıcı kararı: hane küçültme SERBEST. Tek şart davranışın öngörülebilir
  // kalması — her geçişte kapsam damgası sayacı yeni rejime taşır, eski kodlar
  // DOKUNULMAZ ve numara zaten benzersiz değildir.
  console.log("\n── 0c) Hane 2 → 1 → 2 geçişi ──");
  const tekHane: NumberSeriesFormat = { ...kisa, digits: 1, maxValue: 9 };
  check("2 → 1: yeni kod P1 (dolgu yok)", formatSeriesCode(tekHane, 1) === "P1", formatSeriesCode(tekHane, 1));
  check("1 hane rejiminde P42 ARALIK DIŞI (sayaç onu sürüklemez)", seriesCodeSeq(tekHane, "P42") === null);
  check("1 hane rejiminde 9'dan sonra P1'e sarar", nextCounterSeq(tekHane, 9, "kısa") === 1);
  check("1 → 2: geri dönünce P01 yeniden geçerli", seriesCodeSeq(kisa, "P01") === 1);
  check(
    "⭐ HER ÜÇ REJİMDE DE eski kodlar SİLİNMEZ, yalnız sayaç kapsamı değişir",
    seriesCodeSeq(kisa, "P42") === 42 && seriesCodeSeq(tekHane, "P4") === 4,
  );

  // ── 1) Kısa rejim (bayrak AÇIK) ──────────────────────────────────────────
  console.log("\n── 1) Kısa rejim — bayrak AÇIK ──");
  const s1 = stubTx({ shortEnabled: true, lastShort: null });
  check("hiç kısa parti yokken P01", (await generateBatchNumberTx(s1.tx, D)) === "P01");

  const s2 = stubTx({ shortEnabled: true, lastShort: "P42" });
  check("P42 → P43", (await generateBatchNumberTx(s2.tx, D)) === "P43");

  const s3 = stubTx({ shortEnabled: true, lastShort: "P99" });
  const wrapped = await generateBatchNumberTx(s3.tx, D);
  check("P99 → P01 (SARMA)", wrapped === "P01", wrapped);

  // R6 (2026-09-26): sarma GLOBAL kalır, yalnız AYNI iş emrinde dolu numara atlanır.
  const r6a = stubTx({ shortEnabled: true, lastShort: "P04", woTaken: ["P05", "P06"] });
  check("R6 aynı iş emrinde dolu P05/P06 atlanır → P07", (await generateBatchNumberTx(r6a.tx, D, "wo-1")) === "P07");
  const r6b = stubTx({ shortEnabled: true, lastShort: "P98", woTaken: ["P99", "P01"] });
  const r6bNo = await generateBatchNumberTx(r6b.tx, D, "wo-1");
  check("R6 atlama da SARAR: P99 ve P01 doluyken P98'den sonra P02", r6bNo === "P02", r6bNo);
  const r6c = stubTx({ shortEnabled: true, lastShort: "P04", woTaken: ["P05"] });
  check("R6 iş emri verilmezse (önizleme) atlama yok, global sıra aynı → P05", (await generateBatchNumberTx(r6c.tx, D)) === "P05");
  check("R6 iş emri verilmezse doluluk sorgusu HİÇ koşmaz", !r6c.calls.includes("findTakenInWo"), r6c.calls.join(" → "));
  const hepsi = Array.from({ length: 99 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`);
  const r6d = stubTx({ shortEnabled: true, lastShort: "P10", woTaken: hepsi });
  const dolu = await generateBatchNumberTx(r6d.tx, D, "wo-1").then(() => null, (e: { statusCode?: number; details?: { code?: string } }) => e);
  check("R6 99 numaranın hepsi doluysa döngü yok: 409 BATCH_NUMBER_WO_FULL", dolu?.statusCode === 409 && dolu.details?.code === "BATCH_NUMBER_WO_FULL", `${dolu?.statusCode} ${dolu?.details?.code}`);
  const r6e = stubTx({ shortEnabled: true, lastShort: "P10", woTaken: hepsi.filter((c) => c !== "P03") });
  check("R6 98 dolu, tek boş P03 → P03 bulunur", (await generateBatchNumberTx(r6e.tx, D, "wo-1")) === "P03");
  check("R6 kilit doluluk sorgusundan ÖNCE", r6a.calls.indexOf("lock(8022,1)") === 0 && r6a.calls.includes("findTakenInWo"), r6a.calls.join(" → "));

  // 1'inci sessiz bozulma: eski günlük kodlar sayaca sızarsa P01 yerine P29 doğar.
  const s4 = stubTx({ shortEnabled: true, lastShort: "P05082628", daily: [`${PFX}28`] });
  const afterLegacyOnly = await generateBatchNumberTx(s4.tx, D);
  check(
    "DB'de yalnız ESKİ kodlar varken P01'den başlar (sayaç eskiyi görmez)",
    afterLegacyOnly === "P01",
    afterLegacyOnly,
  );
  check("kısa rejimde günlük sorgu HİÇ koşmaz", !s4.calls.includes("findManyDaily"), s4.calls.join(" → "));

  // SQL SÜZGECİNİN KENDİSİ — `seriesCodeSeq` ikinci hat olarak yanlış satırı
  // zaten eler, ama süzgeç gevşerse sorgu "en son satır" olarak bir GÜNLÜK kod
  // döndürür, parse null verir ve sayaç HER SEFERİNDE P01'e düşer: canlı P01
  // dururken ikinci bir P01 doğar. İki hat da ayrı ayrı doğrulanmalı.
  const pat = s4.sqlPattern();
  const sqlSuz = s4.sqlFilter();
  check("kısa-parti sorgusunun deseni yakalandı (körlük zemini)", pat !== null, pat ?? "YOK");
  check("kısa-parti sorgusunun ARALIK ayağı da yakalandı (körlük zemini)", sqlSuz !== null, pat ?? "YOK");
  if (sqlSuz) {
    // ⚠️ SÜZGEÇ İKİ AYAKLI: biçim deseni + sayısal aralık. Tek ayağı ölçmek
    // ötekinin sessizce gevşemesine izin verirdi; iddia BİRLEŞİK süzgeci ölçer.
    check(
      "SQL süzgeci ESKİ GÜNLÜK kodları DIŞLAR",
      !sqlSuz("P0508260019") && !sqlSuz("P0508261") && !sqlSuz("P05082628"),
      pat ?? "",
    );
    check("SQL süzgeci P00'ı DIŞLAR (aralık ayağı)", !sqlSuz("P00"), pat ?? "");
    check(
      "SQL süzgeci P01–P99'u KABUL EDER",
      sqlSuz("P01") && sqlSuz("P42") && sqlSuz("P99"),
      pat ?? "",
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
  const short = live.filter((b) => seriesCodeSeq(kisa, b.batchNumber) !== null);
  // ⚠️ İKİ FARKLI "SIFIR" — karıştırmak bu testi TEMİZ KURULUMDA kırıyordu
  // (CI, 2026-08-09: `günlük 0 · kısa 0 / toplam 0`). Ayrım şu:
  //   · `toplam 0`  → veritabanında gerçekten hiç parti YOK. Bu bir ihlal değil,
  //     meşru bir durum: temiz CI DB'si, yeni kurulum, `seed` sonrası. Burada
  //     "biçim denetimi" sorulacak bir soru bile değildir.
  //   · `toplam > 0` ama iki biçim de 0 → parti VAR ama HİÇBİRİ tanınmıyor.
  //     ASIL İHLAL BUDUR: parser bozulmuş ya da üçüncü bir biçim doğmuş demektir.
  // Eski hâli ikisini aynı sayıyordu; sonuç, dev DB'si dolu olduğu için yerelde
  // yeşil, temiz CI DB'sinde kırmızı olan bir bekçiydi — yani `CLAUDE.md`'nin
  // "Ortamdaki veriye BAĞIMLI OLMA" kuralının tam ihlali.
  check(
    live.length === 0
      ? "canlı DB'de hiç parti yok — biçim denetimi kapsam dışı (temiz kurulum)"
      : "biçimlerden en az biri canlıda mevcut",
    live.length === 0 || daily.length + short.length > 0,
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

    // ── withBarcodeRetry JITTER SÖZLEŞMESİ (2026-08-09, F-URE-ESZ-001) ────────
  // Kod/numara üretimi P2002 çakışmasında TÜM işlemi yeniden koşturuyor. Eskiden
  // denemeler arasında HİÇ bekleme yoktu: çakışan iki istek beklemeden yeniden
  // koşup aynı mikrosaniye penceresinde TEKRAR çarpışabiliyordu (livelock
  // eğilimi) ve beş deneme tükenince kullanıcı sebebini anlamadığı bir 409
  // alıyordu. Rastgelelik ŞART — sabit bekleme iki isteği aynı ritimde tutar.
  {
    const rsrc = require("fs").readFileSync(
      require("path").join(__dirname, "../src/utils/barcode-retry.ts"),
      "utf8",
    ) as string;
    check("withBarcodeRetry denemeler arasında bekliyor", /setTimeout\(/.test(rsrc));
    check("bekleme JITTER'lı (sabit değil)", /Math\.random\(\)/.test(rsrc));
    check(
      "son denemeden sonra beklemiyor (hata mesajını geciktirmez)",
      /attempt < maxAttempts/.test(rsrc),
    );
  }

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
