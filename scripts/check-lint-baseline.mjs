#!/usr/bin/env node
// =============================================================================
// LINT BASELINE (cırcır) BEKÇİSİ — zero-dep, Node ESM. CI'da ve commit hook'unda koşar.
// =============================================================================
// AMAÇ: Ölçülen ihlali SIFIR OLMAYAN bir kuralı da yazabilmek.
//
// Bu repoda ESLint'e kural girmenin ölçütü şuydu: "AST'den kesin yakalanabiliyorsa
// VE mevcut ihlal SIFIRSA" (Teks-Erp/eslint.config.mjs başlığı). Ölçüt doğru ama
// DAR: dosya/fonksiyon uzunluğu, ham hex renk, sahipsiz promise gibi kurallarda
// bugünkü ihlal sıfır değildir ve olmayacaktır — devralınan kod öyle yazılmış.
// Kuralı hiç yazmamak "yeni kodda da serbest" demektir; `error` yapmak ise
// kampanya (toplu refactor) dayatır. Üçüncü yol: kural `warn` olarak yazılır,
// bugünkü sayı TAVAN olarak dondurulur ve TAVAN YALNIZ DÜŞER.
//
//   yeni kodda ZORUNLU  ·  devralınan kodda BASELINE'DA DONAR
//
// Çıkış kodu: bir kural tavanı AŞARSA 1, aksi 0. Tavanın altına düşmek hata
// değildir — "sıkıştırılabilir" diye raporlanır (kod düzelince tavanı elle indir:
// `--yaz`). Otomatik indirme YOK: baseline dosyası bir KARARDIR, commit edilir ve
// gözden geçirilir; CI'ın kendi kendine indirmesi o kaydı görünmez kılardı.
//
// Çalıştır:
//   node scripts/check-lint-baseline.mjs                 # üç proje, kontrol
//   node scripts/check-lint-baseline.mjs --proje=mobil   # tek proje
//   node scripts/check-lint-baseline.mjs --yaz           # tavanı BUGÜNKÜ sayıya sabitle
// =============================================================================

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ⚠️ KAPSAM TEK KAYNAK: buradaki argv, projenin `package.json > scripts.lint`
// argv'siyle BİREBİR aynı olmalı. Ayrışırsa baseline başka bir kümeyi ölçer ve
// "tavan aşılmadı" cümlesi anlamını yitirir (aynı sınıf hata tsc'de yaşandı:
// `scripts/` hiçbir tsconfig'in include'unda değildi, 87 tip hatası birikti).
// Kapsam değişince: lint script'i + burası + CI birlikte güncellenir.
const PROJELER = {
  backend: { dizin: "Teks-Erp", argv: ["eslint", "src", "scripts", "prisma"] },
  electron: { dizin: "Electron", argv: ["eslint", ".", "--ext", ".ts,.tsx"] },
  mobil: { dizin: "mobil", argv: ["eslint", "."] },
};

// KÖRLÜK ZEMİNİ: eslint hiçbir dosyayı lint etmediyse çıktı "0 ihlal" olur ve
// bekçi yeşil geçer — kuralın tuttuğunu değil, kapsamın boş olduğunu ölçmüş
// oluruz.
//
// ⚠️ ZEMİN "bugünkü sayının yarısı" DEĞİL, EN BÜYÜK DALI KAYBETMEYİ YAKALAYAN
// sayıdır — yarım zemin, kapsamın yarısı düştüğünde bile yeşil kalırdı.
// backend bugün 1026 dosya (src 456 · scripts 553 · prisma 17); zemin 900:
//   · `scripts` argv'den düşerse → 473 < 900 ✔ yakalanır
//   · `src` düşerse             → 570 < 900 ✔ yakalanır
//   · normal dosya silinmesi     → ~126 dosyalık pay, gürültü yapmaz
const EN_AZ_DOSYA = { backend: 900, electron: 600, mobil: 200 };

const argv = process.argv.slice(2);
const YAZ = argv.includes("--yaz");
const projeArg = argv.find((a) => a.startsWith("--proje="))?.split("=")[1];
const SECILEN = projeArg ? [projeArg] : Object.keys(PROJELER);

function baselineYolu(proje) {
  return join(REPO_ROOT, PROJELER[proje].dizin, "lint-baseline.json");
}

/** ESLint'i JSON formatıyla koş; kural bazında ihlal sayısı + taranan dosya sayısı döndür. */
function olc(proje) {
  const { dizin, argv: lintArgv } = PROJELER[proje];
  let ham;
  try {
    ham = execFileSync("npx", [...lintArgv, "-f", "json"], {
      cwd: join(REPO_ROOT, dizin),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: process.env,
    });
  } catch (err) {
    // ESLint ihlal bulunca çıkış kodu 1 verir ve JSON'u yine stdout'a basar.
    // Gerçek çökme (config hatası) ile ihlali AYIRT ET: stdout parse edilebiliyorsa
    // ihlaldir, edilemiyorsa çökmedir ve YUTULMAZ.
    ham = err.stdout ?? "";
    if (!ham.trim().startsWith("[")) {
      console.error(`❌ ${proje}: ESLint koşulamadı — bu bir ihlal değil, ARIZA.`);
      console.error(String(err.stderr ?? err.message).trimEnd().replace(/^/gm, "   | "));
      process.exit(2);
    }
  }

  const dosyalar = JSON.parse(ham);
  const sayim = {};
  let hata = 0;
  for (const d of dosyalar) {
    for (const m of d.messages ?? []) {
      // ruleId null = parse hatası (config/sözdizimi). Baseline'a giremez, ARIZADIR.
      if (!m.ruleId) {
        console.error(`❌ ${proje}: ${d.filePath}:${m.line} — parse hatası: ${m.message}`);
        process.exit(2);
      }
      sayim[m.ruleId] = (sayim[m.ruleId] ?? 0) + 1;
      if (m.severity === 2) hata++;
    }
  }
  return { sayim, dosyaSayisi: dosyalar.length, hata };
}

let kirmizi = false;
let sikistirilabilir = 0;

for (const proje of SECILEN) {
  if (!PROJELER[proje]) {
    console.error(`Bilinmeyen proje: ${proje} (${Object.keys(PROJELER).join(", ")})`);
    process.exit(2);
  }
  const { sayim, dosyaSayisi, hata } = olc(proje);

  if (dosyaSayisi < EN_AZ_DOSYA[proje]) {
    console.error(
      `❌ ${proje}: yalnız ${dosyaSayisi} dosya lint edildi (zemin ${EN_AZ_DOSYA[proje]}).\n` +
        `   Bu bir "temiz kod" sinyali DEĞİL, kapsam sinyalidir: lint argv'si ya da\n` +
        `   ignore listesi kümeyi daraltmış olabilir. Önce kapsamı doğrula.`,
    );
    kirmizi = true;
    continue;
  }

  const yol = baselineYolu(proje);
  if (YAZ) {
    const govde = {
      _not: "ESLint uyarı TAVANI — yalnız DÜŞER. Ölçüm: node scripts/check-lint-baseline.mjs --yaz",
      _kapsam: PROJELER[proje].argv.join(" "),
      _dosyaSayisi: dosyaSayisi,
      kurallar: Object.fromEntries(Object.entries(sayim).sort(([a], [b]) => a.localeCompare(b))),
    };
    writeFileSync(yol, `${JSON.stringify(govde, null, 2)}\n`);
    const toplam = Object.values(sayim).reduce((s, n) => s + n, 0);
    console.log(`✍️  ${proje}: tavan yazıldı — ${Object.keys(sayim).length} kural / ${toplam} ihlal (${dosyaSayisi} dosya)`);
    continue;
  }

  if (!existsSync(yol)) {
    console.error(`❌ ${proje}: ${PROJELER[proje].dizin}/lint-baseline.json yok — önce --yaz ile üret.`);
    kirmizi = true;
    continue;
  }
  const taban = JSON.parse(readFileSync(yol, "utf8")).kurallar ?? {};

  const asan = [];
  const dusen = [];
  for (const [kural, adet] of Object.entries(sayim)) {
    const tavan = taban[kural] ?? 0;
    if (adet > tavan) asan.push({ kural, adet, tavan });
  }
  for (const [kural, tavan] of Object.entries(taban)) {
    const adet = sayim[kural] ?? 0;
    if (adet < tavan) dusen.push({ kural, adet, tavan });
  }

  if (asan.length > 0) {
    kirmizi = true;
    console.error(`❌ ${proje}: ${asan.length} kural TAVANI AŞTI (${dosyaSayisi} dosya, ${hata} error)`);
    for (const a of asan) console.error(`   ${a.kural}: ${a.adet} > ${a.tavan}`);
    console.error(
      `   Bu kurallar YENİ KODDA ZORUNLU. Devralınan kodu düzeltmen gerekmiyor —\n` +
        `   eklediğin/dokunduğun yeri sınıra çek. Tavanı yükseltmek bir KARARDIR,\n` +
        `   gerekçesiyle birlikte yapılır (${PROJELER[proje].dizin}/lint-baseline.json).`,
    );
  } else {
    console.log(`✅ ${proje}: tavan aşılmadı (${dosyaSayisi} dosya, ${hata} error)`);
  }
  if (dusen.length > 0) {
    sikistirilabilir += dusen.length;
    console.log(`   ↓ ${dusen.length} kural tavanın ALTINDA: ${dusen.slice(0, 5).map((d) => `${d.kural} ${d.adet}<${d.tavan}`).join(", ")}${dusen.length > 5 ? " …" : ""}`);
  }
}

if (sikistirilabilir > 0 && !YAZ) {
  console.log(`\nℹ️  ${sikistirilabilir} kural sıkıştırılabilir: node scripts/check-lint-baseline.mjs --yaz`);
}
process.exit(kirmizi ? 1 : 0);
