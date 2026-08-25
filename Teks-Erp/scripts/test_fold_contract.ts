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
// DÖRT CEPHE (+ bir türev):
//   1. Üç kopya BAYT-BAYT aynı mı (backend + Electron + mobil).
//   2. JS ≡ SQL — TÜM BMP (63k karakter) + gerçek dünya korpusu.
//  2b. TÜREV: `tr_fold_color` ≡ `foldColorNameForCompare` (renk ad seddinin
//      ifadesi — 2026-08-25). Aynı dosyada, çünkü "tek bekçi" kuralı türev
//      için de geçerli: ayrı dosya = ayrı muaf listesi = sessiz ayrışma.
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
import { foldColorNameForCompare } from "../src/services/helpers/name-normalize.helper";
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

  // ── 2b) TÜREV: tr_fold_color ≡ foldColorNameForCompare ────────────────────
  // Renk ad seddi (`colors_nameFoldColor_key`, 20260825120000_color_name_unique_live)
  // düz nameFold üzerinde DEĞİL, `tr_fold_color(name)` ifadesi üzerindedir: ayraç
  // (boşluk/tire) eşdeğer + salt-rakam token'lar başa. JS kuralı
  // `foldColorNameForCompare`; ikisi ayrışırsa sed uygulamadan FARKLI davranır —
  // biri "aynı ad" derken diğeri geçirir ve bunu hiçbir hata söylemez.
  // ⚠️ JS ayracı `\s` (NBSP/U+2028… dahil); SQL tarafı bu kümeyi AÇIK yazar çünkü
  // PostgreSQL `\s`'nin ASCII-dışı davranışı ctype'a bağlıdır (saha C locale).
  // Tüm BMP taraması tam da bu sınıfı ölçer — tek karakterlik örnekler ayracın
  // her üyesini ayrı ayrı geçirir.
  console.log("\n── 2b) Türev: tr_fold_color ≡ foldColorNameForCompare ──");
  const colorFnExists = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'tr_fold_color' AND p.provolatile = 'i'`,
  );
  const haveColorFn = Number(colorFnExists[0]?.n ?? 0) === 1;
  check("public.tr_fold_color(text) var ve IMMUTABLE", haveColorFn);
  const COLOR_CORPUS = [
    "055-BEYAZ", "BEYAZ 055", "beyaz 055", "055 BEYAZ", "  055 -  BEYAZ ",
    "330-BEYAZ", "BEYAZ-330", "KREM-GÜMÜŞ", "krem gümüş", "12 lacivert 7", "7 12 LACİVERT",
    "292-7791-GRİ", "GRİ-(292-7791)", "V-1462", "V15", "1263", "46150", "078-BYR-K.KAHVE",
    "BEYAZ\u00a0055", "055\u2003BEYAZ", "055\u3000BEYAZ", "\ufeff055 BEYAZ", "055\u2028BEYAZ",
    "-055-", "--", "-", "", " ", "\t", "０５５ BEYAZ", "٠٥٥ BEYAZ", "Ø-1", "ışık 3", "IŞIK-3",
  ];
  const colorSamples = [...samples, ...COLOR_CORPUS];
  check("körlük zemini (renk): ≥60000 örnek taranıyor", colorSamples.length >= 60000, `${colorSamples.length}`);
  let colorMismatch = 0;
  const colorFirstBad: string[] = [];
  if (haveColorFn) {
    const BATCH = 4000;
    for (let i = 0; i < colorSamples.length; i += BATCH) {
      const slice = colorSamples.slice(i, i + BATCH);
      const rows = await prisma.$queryRawUnsafe<{ c: string; f: string }[]>(
        `SELECT c, public.tr_fold_color(c) AS f FROM unnest($1::text[]) AS c`,
        slice,
      );
      for (const r of rows) {
        const js = foldColorNameForCompare(r.c);
        if (js !== r.f) {
          colorMismatch++;
          if (colorFirstBad.length < 5) {
            const cp = [...r.c]
              .map((x) => "U+" + x.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"))
              .join(" ");
            colorFirstBad.push(`${cp} sql=${JSON.stringify(r.f)} js=${JSON.stringify(js)}`);
          }
        }
      }
    }
  }
  check("renk: BMP + korpus JS ile SQL BİREBİR", haveColorFn && colorMismatch === 0, colorFirstBad.join(" | "));
  // İş kuralının kendisi (eşitlik sağlansa bile YANLIŞ olabilir):
  check('renk: "055-BEYAZ" ≡ "BEYAZ 055" (ayraç + sıra bağımsız)', foldColorNameForCompare("055-BEYAZ") === foldColorNameForCompare("BEYAZ 055"));
  check('renk: "12 lacivert 7" → sayılar önde, kendi sırasında', foldColorNameForCompare("12 lacivert 7") === "12 7 lacivert");
  check('renk: parantez token\'a YAPIŞIK kalır ("GRİ-(292-7791)" ≠ "292-7791-GRİ") — bilinçli', foldColorNameForCompare("GRİ-(292-7791)") !== foldColorNameForCompare("292-7791-GRİ"));
  check('renk: NBSP ayraçtır ("BEYAZ\\u00a0055" ≡ "055 BEYAZ")', foldColorNameForCompare("BEYAZ\u00a0055") === foldColorNameForCompare("055 BEYAZ"));

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

  // ── 5) SIRALAMA SÖZLEŞMESİ: sunucu ≡ istemci ────────────────────────────
  // Liste bazen sunucuda (`ORDER BY name`), bazen istemcide sıralanır. İkisi
  // ayrışırsa aynı veri iki ekranda farklı sırada görünür ve operatör "kayıt
  // kaybolmuş" sanır. DB tarafı `COLLATE public.tr_sort`, istemci tarafı
  // `Intl.Collator("tr", { numeric: true })` — bu bölüm ikisinin AYNI cevabı
  // verdiğini ölçer.
  console.log("\n── 5) Sıralama: DB collation ≡ Intl.Collator('tr') ──");
  const SORT_SAMPLE = [
    "Çanakkale", "Cebeci", "Ceyhan", "Işık", "İnci", "Zonguldak",
    "P1", "P2", "P10", "9 YEŞİL", "1000 MAVİ", "01-BEYAZ", "029-TAŞ",
    "Öz Şahin", "Ozan", "Şahin", "Sahin", "Ünal", "Ulus",
  ];
  const collRows = await prisma.$queryRawUnsafe<{ x: string }[]>(
    `SELECT x FROM unnest($1::text[]) AS x ORDER BY x COLLATE public.tr_sort`,
    SORT_SAMPLE,
  );
  const dbOrder = collRows.map((r) => r.x);
  const jsOrder = [...SORT_SAMPLE].sort(
    new Intl.Collator("tr", { numeric: true }).compare,
  );
  check(
    "DB sırası ile istemci sırası BİREBİR",
    JSON.stringify(dbOrder) === JSON.stringify(jsOrder),
    dbOrder.join(" < "),
  );
  // Türkçe alfabenin iki ayırt edici kuralı — ikisi de sunucuda geçerli olmalı.
  check("Ç bütün C'lerden SONRA", dbOrder.indexOf("Çanakkale") > dbOrder.indexOf("Ceyhan"));
  check("I (ışık) İ'den ÖNCE", dbOrder.indexOf("Işık") < dbOrder.indexOf("İnci"));
  // ⚠️ Sayı-duyarlılık: onsuz "P10" < "P2" olurdu. Renk adları bugün sıfır
  // dolgulu olduğu için gizli kalır; dolgusuz tek ad girildiğinde görünür.
  check("sayı-duyarlı: P2 < P10", dbOrder.indexOf("P2") < dbOrder.indexOf("P10"));
  check("sayı-duyarlı: 9 < 1000", dbOrder.indexOf("9 YEŞİL") < dbOrder.indexOf("1000 MAVİ"));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
