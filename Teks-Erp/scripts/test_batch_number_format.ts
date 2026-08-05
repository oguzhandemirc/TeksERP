// =============================================================================
// Test: PARTİ NO biçimi — dolgusuz sıra (P + GGAAYY + SIRA)
// Çalıştır: npx tsx scripts/test_batch_number_format.ts
// =============================================================================
// 2026-08-05 kullanıcı kararı: parti no zero-pad TAŞIMAZ (`P0508261`,
// `P05082619`, `P050826123`…) ve hane sayısı serbesttir. Sistemdeki diğer TÜM
// belge/barkod kodları 4 hane dolguludur — parti no tek istisnadır.
//
// Bu bekçi dört ayrı sessiz bozulmayı kilitler:
//   1) DOLGU GERİ GELİRSE — biri `buildDailyCode`'un varsayılan `digits`'ini
//      kullanır (dördüncü argümanı düşürmek yeter) ve kimse fark etmez.
//   2) SÜREKLİLİK KIRILIRSA — 2026-08-05 öncesi kayıtlar dolguludur ve AYNI
//      GÜN içinde iki biçim yan yana yaşayabilir. `nextDailySeq` kuyruğu
//      `parseInt` ile okumazsa sayaç 1'e döner → P2002 çakışması ya da (daha
//      kötüsü) numara tekrarı.
//   3) SIRALAMA — dolgusuz kodda SÖZLÜKSEL sıra ≠ SAYISAL sıra (`P05082610` <
//      `P0508262`). `orderBy: { batchNumber }` kullanan bir yüzey partileri
//      operatöre YANLIŞ SIRADA gösterir; hata da log da çıkmaz.
//   4) İSTİSNANIN SIZMASI — dolgusuzluk yalnız "P"ye aittir. SIP/İE/CV/RK/FS…
//      okutulan kodlardır ve sabit uzunluk varsayan tarayıcı/parser yolları
//      vardır (`isDailyCode` regex'i `\d{4}` ister).
//
// Gerçek DB'ye YAZMAZ: 1-3 sahte tx ile saf, 5. bölüm canlı veriyi salt-okur.
// =============================================================================

import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { generateBatchNumberTx } from "../src/services/batch.service";
import { buildDailyCode, dailyCodePrefix } from "../src/utils/code-format";

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

/** `batch.findMany` sözleşmesini taşıyan minimum sahte tx (DB yok). */
function stubTx(existing: string[]): Prisma.TransactionClient {
  return {
    batch: {
      findMany: async (args: { where: { batchNumber: { startsWith: string } } }) => {
        const p = args.where.batchNumber.startsWith;
        return existing.filter((c) => c.startsWith(p)).map((batchNumber) => ({ batchNumber }));
      },
    },
  } as unknown as Prisma.TransactionClient;
}

// Sabit an — fabrika takvim günü 05.08.2026 (12:00 Europe/Istanbul).
const D = new Date("2026-08-05T09:00:00.000Z");
const PFX = "P050826";

async function main(): Promise<void> {
  // ── 1) Dolgusuz üretim ────────────────────────────────────────────────────
  console.log("\n── 1) Dolgusuz üretim ──");
  const first = await generateBatchNumberTx(stubTx([]), D);
  check("boş günde ilk parti 1'den başlar", first === `${PFX}1`, first);
  check("sıfır dolgusu YOK", /^P\d{6}[1-9]\d*$/.test(first), first);

  const ninth = await generateBatchNumberTx(stubTx([`${PFX}8`]), D);
  check("tek haneli devam", ninth === `${PFX}9`, ninth);

  const tenth = await generateBatchNumberTx(stubTx([`${PFX}9`]), D);
  check("9 → 10 (hane büyür, dolgu yok)", tenth === `${PFX}10`, tenth);

  // ── 2) Eski dolgulu kayıtlarla SÜREKLİLİK ────────────────────────────────
  console.log("\n── 2) Eski dolgulu kayıtlarla süreklilik ──");
  const afterLegacy = await generateBatchNumberTx(stubTx([`${PFX}0019`]), D);
  check(
    "eski dolgulu max okunur (P…0019 → 20)",
    afterLegacy === `${PFX}20`,
    afterLegacy,
  );

  const mixed = await generateBatchNumberTx(
    stubTx([`${PFX}0001`, `${PFX}0019`, `${PFX}20`, `${PFX}21`]),
    D,
  );
  check("karışık biçimde NUMERIC max+1", mixed === `${PFX}22`, mixed);

  // Sözlüksel max ile sayısal max'ın AYRIŞTIĞI durum: "9" > "10" sözlükte.
  const lexTrap = await generateBatchNumberTx(stubTx([`${PFX}9`, `${PFX}10`]), D);
  check("sözlüksel max tuzağına düşmez (9 vs 10)", lexTrap === `${PFX}11`, lexTrap);

  // ── 3) 9999 tavanı düştü ─────────────────────────────────────────────────
  console.log("\n── 3) Günlük tavan ──");
  const overflow = await generateBatchNumberTx(stubTx([`${PFX}9999`]), D);
  check("9999 tavanı yok (→ 10000, 5 hane)", overflow === `${PFX}10000`, overflow);

  // ── 4) Fabrika günü + istisnanın sızmaması ───────────────────────────────
  console.log("\n── 4) Gün sınırı ve diğer kodlar ──");
  // 22:30Z = ertesi gün 01:30 Europe/Istanbul → gece vardiyası BUGÜNÜ görmeli.
  const night = await generateBatchNumberTx(stubTx([]), new Date("2026-08-05T22:30:00.000Z"));
  check("gün = fabrika takvim günü (01:30 → 06.08)", night === "P0608261", night);

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

  // ── 6) Canlı veri: karışık biçim çakışma üretmemiş olmalı ────────────────
  console.log("\n── 6) Canlı veri (salt-okunur) ──");
  const live = await prisma.batch.findMany({ select: { batchNumber: true } });
  const auto = live.filter((b) => /^P\d{6}\d+$/.test(b.batchNumber));
  check("otomatik biçimli parti bulundu", auto.length > 0, `${auto.length}/${live.length}`);

  // Aynı gün içinde iki parti AYNI sıra numarasına çözülmemeli — dolgulu ve
  // dolgusuz kayıt farklı string olduğu için unique constraint bunu yakalamaz.
  const seqByDay = new Map<string, Map<number, string[]>>();
  for (const b of auto) {
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
  check("aynı gün + aynı sıra iki kez üretilmemiş", dupes.length === 0, dupes.join(" | ") || "temiz");

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
