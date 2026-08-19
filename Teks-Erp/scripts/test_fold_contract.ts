// =============================================================================
// BEKÇİ: Arama katlaması TEK SÖZLEŞME — JS ≡ SQL ≡ üç kopya (2026-08-19)
// Çalıştır: npx tsx scripts/test_fold_contract.ts
// =============================================================================
// Aranan her metin kolonunun yanında DB'nin ürettiği bir `xFold` gölgesi var
// (GENERATED ALWAYS AS (public.tr_fold(x)) STORED); arama terimini ise
// `src/utils/search-fold.ts` katlıyor. İKİSİ AYRIŞIRSA ARAMA SESSİZCE BOŞ
// DÖNER — hata yok, log yok, operatör "kayıt yok" sanır. Bu dosya o eşitliğin
// tek bekçisidir; ikinci bir bekçi AÇMA (iki muaf listesi kaçınılmaz olarak
// ayrışır, biri meşru sebeple kırmızıya döner ve ekip kırmızıyı görmezden
// gelmeyi öğrenir — timestamptz bekçisinin dersi).
//
// DÖRT CEPHE:
//   1. Üç kopya BAYT-BAYT aynı mı (backend + Electron + mobil).
//   2. JS ≡ SQL — TÜM BMP (63k karakter) + gerçek dünya korpusu.
//   3. Katlamanın İŞ KURALLARI (i-ailesi, Türkçe harfler, joker temizliği,
//      boşluk tekleme) — eşitlik sağlansa bile YANLIŞ olabilirler.
//   4. Sıralama katlamayla YAPILMAZ — negatif sözleşme.
//
// ⚠️ KÖRLÜK ZEMİNİ: her sayım kontrolünün alt sınırı var. Bir refactor taramayı
// boşa düşürürse ("0 sapma bulundu" ile "hiçbir şeye bakılmadı" aynı yeşile
// çıkar) zemin testi düşürür.
// =============================================================================
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import {
  foldSearchText,
  foldSearchTerm,
  foldSearchTokens,
  foldedIncludes,
} from "../src/utils/search-fold";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const ROOT = path.resolve(__dirname, "..", "..");
const COPIES = [
  "Teks-Erp/src/utils/search-fold.ts",
  "Electron/src/lib/search-fold.ts",
  "mobil/src/utils/searchFold.ts",
];

async function main(): Promise<void> {
  // ── 1) Üç kopya bayt-bayt aynı ────────────────────────────────────────────
  console.log("\n── 1) Üç kopya bayt-bayt aynı ──");
  const digests = COPIES.map((rel) => {
    const abs = path.join(ROOT, rel);
    try {
      return createHash("md5").update(readFileSync(abs)).digest("hex");
    } catch {
      return `EKSİK:${rel}`;
    }
  });
  COPIES.forEach((rel, i) => check(`bulundu: ${rel}`, !digests[i].startsWith("EKSİK")));
  check(
    "üç kopyanın md5'i eşit",
    new Set(digests).size === 1,
    digests.map((d, i) => `${COPIES[i].split("/").pop()}=${d.slice(0, 8)}`).join(" "),
  );

  // ── 2) JS ≡ SQL — tüm BMP + korpus ────────────────────────────────────────
  console.log("\n── 2) JS ≡ SQL (public.tr_fold) ──");
  const fnExists = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'tr_fold' AND p.provolatile = 'i'`,
  );
  const haveFn = Number(fnExists[0]?.n ?? 0) === 1;
  check("public.tr_fold(text) var ve IMMUTABLE", haveFn);

  const samples: string[] = [];
  for (let c = 0x20; c <= 0xffff; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue; // yalnız surrogate — tek başına geçersiz
    samples.push(String.fromCodePoint(c));
  }
  const CORPUS = [
    "ÖZ ŞAHİN", "öz şahin", "Öz Şahin", "OZ SAHIN", "oz sahin", "  öz  şahin  ",
    "ŞAHİN".toLowerCase(), "İPLİK".toLowerCase(), "IŞIK", "ışık", "Işık", "ıŞıK",
    "ÇANAKKALE", "canakkale", "Çanakkale", "ÇİSEM", "çisem", "cisem", "Çişem",
    "GÜMÜŞOĞLU", "gumusoglu", "Gümüşoğlu", "PATOS 300", "AKTOŞ2", "aktos2",
    "Großmann", "GROSSMANN", "Ø-TEKSTİL", "Æ", "œuvre", "Đilas", "Łódź",
    "\tsekme\tvar\n", "çift   boşluk", "%joker_", "a\\b", "", " ", "123-456",
  ];
  samples.push(...CORPUS);
  check("körlük zemini: ≥60000 örnek taranıyor", samples.length >= 60000, `${samples.length}`);

  let mismatch = 0;
  const firstBad: string[] = [];
  if (haveFn) {
    const BATCH = 4000;
    for (let i = 0; i < samples.length; i += BATCH) {
      const slice = samples.slice(i, i + BATCH);
      const rows = await prisma.$queryRawUnsafe<{ c: string; f: string }[]>(
        `SELECT c, public.tr_fold(c) AS f FROM unnest($1::text[]) AS c`,
        slice,
      );
      for (const r of rows) {
        if (foldSearchText(r.c) !== r.f) {
          mismatch++;
          if (firstBad.length < 5) {
            const cp = [...r.c]
              .map((x) => "U+" + x.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"))
              .join(" ");
            firstBad.push(`${cp} sql=${JSON.stringify(r.f)} js=${JSON.stringify(foldSearchText(r.c))}`);
          }
        }
      }
    }
  }
  check("BMP + korpus: JS ile SQL BİREBİR", haveFn && mismatch === 0, firstBad.join(" | "));

  // ── 3) İş kuralları ───────────────────────────────────────────────────────
  console.log("\n── 3) Katlamanın iş kuralları ──");
  check("i-ailesinin DÖRDÜ de 'isik'", ["IŞIK", "ışık", "Işık", "ISIK"].every((v) => foldSearchText(v) === "isik"));
  check('"canakkale" ≡ "ÇANAKKALE"', foldSearchText("canakkale") === foldSearchText("ÇANAKKALE"));
  check('"cisem" ≡ "ÇİSEM" ≡ "Çişem"', foldSearchText("cisem") === foldSearchText("ÇİSEM") && foldSearchText("cisem") === foldSearchText("Çişem"));
  check('"gumusoglu" ≡ "GÜMÜŞOĞLU"', foldSearchText("gumusoglu") === foldSearchText("GÜMÜŞOĞLU"));
  check("boşluk teklenir + kırpılır", foldSearchText("  öz   şahin  ") === "oz sahin");
  check("sekme/satır sonu da boşluktur", foldSearchText("öz\tşahin\nas") === "oz sahin as");
  // ⚠️ Bu satır 2026-08-19 saha hatasının donmuş kanıtı: beş Electron ekranı
  // iğneyi `toLowerCase()` ile ön-küçültüyordu ve büyük İ içeren her arama
  // 0 satır dönüyordu. Katlama o kirli girdiyi de kurtarmalı.
  check('"ŞAHİN".toLowerCase() (i+U+0307) yine "sahin"', foldSearchText("ŞAHİN".toLowerCase()) === "sahin");
  check("U+0307 gerçekten oradaydı", "ŞAHİN".toLowerCase().includes("̇"));
  check("ß → ss (Almanca müşteri adı)", foldSearchText("Großmann") === foldSearchText("GROSSMANN"));
  check("Ø → o (Nordic)", foldSearchText("Ø") === "o" && foldSearchText("ø") === "o");
  check("Æ/œ çok karakterli", foldSearchText("Æ") === "ae" && foldSearchText("Œ") === "oe");
  check("LIKE jokerleri terimden DÜŞER", foldSearchTerm("%öz_şahin\\") === "ozsahin");
  check("foldSearchText joker DÜŞÜRMEZ (kolon tarafı)", foldSearchText("%a%") === "%a%");
  check("token ayrıştırma", JSON.stringify(foldSearchTokens(" ŞAHİN   tekstil ")) === '["sahin","tekstil"]');
  check("boş terim → boş token dizisi", foldSearchTokens("   ").length === 0);
  check("foldedIncludes boş aramada TÜMÜNÜ eşler", foldedIncludes("herhangi", "  ") === true);
  check("foldedIncludes null haystack'te patlamaz", foldedIncludes(null, "x") === false);
  check("foldedIncludes Türkçe eşleşme", foldedIncludes("ÖZ ŞAHİN TEKSTİL", "sahin") === true);

  // ── 4) Negatif sözleşme: katlama SIRALAMA aracı DEĞİLDİR ──────────────────
  console.log("\n── 4) Katlama ≠ sıralama ──");
  // Türkçede ç ile c AYRI harflerdir ve Ç bütün C'lerden SONRA gelir. Katlanmış
  // anahtarla sıralanan liste "Çanakkale"yi "Cebeci"nin bile ÖNÜNE atar. Bu
  // testin işi, birinin "madem katlıyoruz, sıralamada da kullanalım" demesini
  // engellemektir.
  const names = ["Ceyhan", "Çanakkale", "Cebeci"];
  const byFold = [...names].sort((a, b) => (foldSearchText(a) < foldSearchText(b) ? -1 : 1));
  const byTr = [...names].sort((a, b) => a.localeCompare(b, "tr"));
  check("katlamayla sıralama Ç'yi C'lerin ÖNÜNE atar (YANLIŞ)", byFold[0] === "Çanakkale", byFold.join(","));
  check("Türkçe harmanlama Ç'yi C'lerden SONRA koyar (DOĞRU)", byTr[2] === "Çanakkale", byTr.join(","));
  check("ikisi FARKLI sonuç veriyor (araçlar ayrı)", JSON.stringify(byFold) !== JSON.stringify(byTr));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
