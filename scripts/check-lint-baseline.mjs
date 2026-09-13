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
import { STDIN_ARIZA_MESAJI, stdinListesi } from "./hooks/lib/stdin-liste.mjs";

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

// =============================================================================
// COMMIT KAPISI KİPİ (`--commit-kapisi` + staged liste stdin'den)
// =============================================================================
// VAKA (2026-09-13): tavan, ortak çalışma ağacında ÜÇÜNCÜ "yanlış kişiyi durduran"
// mekanizmaydı — commit dışı tek bir dosyadaki üç ihlal (`scripts/out/`, başka bir
// oturumun `.gitignore`lu scratch dizini) tavanı aşırıp commit'i reddetti.
// ⚠️ `.gitignore` bir dosyayı GİT'ten gizler, DERLEYİCİDEN ve LINTER'DAN gizlemez.
//
// KARAR (kullanıcı onaylı): **SAYIM proje geneli KALIR, yalnız VERDİKT daralır.**
// Kümeyi commit dosyalarına indirmek başka bir metrik üretirdi ve `lint-baseline.json`
// ile KARŞILAŞTIRILAMAZDI ([TD-23]/[TD-24]: tavan ile kapı aynı kümeyi ölçmeli).
//   · aşımı yapan ihlal BU COMMIT'in dosyasındaysa  → KIRMIZI
//   · yalnız yabancı dosyadaysa                     → UYARI + çıkış 0, adıyla
//   · karışıksa                                     → KIRMIZI (kendi payın varsa sorumlusun)
//
// ⚠️ BAYRAK HOOK YOLUNA ÖZGÜDÜR. CI'da hiçbir şey staged değildir; bayrak oraya
// sızarsa her ihlal "yabancı" olur ve tavan yapısal olarak KÖR kalır. Sızmadığı
// ayrıca ölçülür (test_commit_gate_scope.ts §3).
const KOMIT_KIPI = process.argv.includes("--commit-kapisi");
const STAGED = KOMIT_KIPI
  ? new Set(
      (() => {
        // ZAMAN AŞIMLI (2026-09-13): açık boru + EOF yok = sonsuz askı; 5 sn'de ARIZA.
        const { kip, liste } = stdinListesi();
        if (kip === "zaman-asimi") {
          console.error(`❌ lint tavanı: ${STDIN_ARIZA_MESAJI}`);
          process.exit(2);
        }
        try {
          return liste ?? [];
        } catch {
          return [];
        }
      })(),
    )
  : null;

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
  // --rapor=<yol>: lint-gate'in az önce yazdığı JSON — aynı küme (argv birebir,
  // yukarıdaki sözleşme), eslint ikinci kez koşmaz (ölçüldü 2026-09-13: 19 sn +
  // 3,5 GB / kapı). Verilmiş ama okunamıyorsa ARIZA: sessizce kendim koşup yeşil
  // geçmek bir kablolama hatasını 19 sn'lik bir yavaşlığa gizlerdi.
  const raporYolu = process.argv.slice(2).find((a) => a.startsWith("--rapor="))?.split("=")[1];
  if (raporYolu) {
    try {
      ham = readFileSync(raporYolu, "utf8");
    } catch (err) {
      console.error(`❌ ${proje}: --rapor verildi ama okunamadı (${raporYolu}) — ARIZA, ihlal değil: ${err.message}`);
      process.exit(2);
    }
    if (!ham.trim().startsWith("[")) {
      console.error(`❌ ${proje}: --rapor JSON değil (${raporYolu}) — ARIZA.`);
      process.exit(2);
    }
  } else try {
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
  // Kural → o kuralı ihlal eden DOSYALAR (repo köküne göre). Sayım değişmez;
  // bu harita yalnız VERDİKT için — "aşımı kim getirdi" sorusunu cevaplar.
  const kuralDosyalari = {};
  // Kural → dosya → adet. "Aşımı KİM getirdi" sorusu ancak KATKI DEĞİŞİMİYLE cevaplanır.
  const kuralDosyaSayim = {};
  let hata = 0;
  for (const d of dosyalar) {
    const repoRel = d.filePath.startsWith(REPO_ROOT)
      ? d.filePath.slice(REPO_ROOT.length + 1).replace(/\\/g, "/")
      : d.filePath;
    for (const m of d.messages ?? []) {
      // ruleId null = parse hatası (config/sözdizimi). Baseline'a giremez, ARIZADIR.
      if (!m.ruleId) {
        console.error(`❌ ${proje}: ${d.filePath}:${m.line} — parse hatası: ${m.message}`);
        process.exit(2);
      }
      sayim[m.ruleId] = (sayim[m.ruleId] ?? 0) + 1;
      (kuralDosyalari[m.ruleId] ??= new Set()).add(repoRel);
      ((kuralDosyaSayim[m.ruleId] ??= {})[repoRel] ??= 0), (kuralDosyaSayim[m.ruleId][repoRel] += 1);
      if (m.severity === 2) hata++;
    }
  }
  return { sayim, kuralDosyalari, kuralDosyaSayim, dosyaSayisi: dosyalar.length, hata };
}


/**
 * Staged bir dosyanın HEAD'deki hâlinin kural-başına ihlal sayısı.
 *
 * ⚠️ NEDEN GEREKLİ (2026-09-13): verdikt yüklemi önce *"aşan kuralın ihlallerini
 * taşıyan dosyalardan biri staged mi"* diye soruyordu. Ama bir dosya o kuralı
 * ZATEN HEAD'de ihlal ediyor olabilir; o zaman yüklem "bu commit AŞIMI YAPTI mı"
 * değil "bu commit o kurala DEĞİYOR mu" diye sorar ve YABANCI bir aşım için
 * commit'i durdurur. Ölçüldü: `max-lines-per-function` 455 > 454, staged dosyanın
 * katkısı HEAD'de de ŞİMDİ de 2 — yani aşım tamamen başka bir oturumdan.
 *
 * ⚠️ AĞACA GEÇİCİ DOSYA YAZILMAZ: ortak çalışma ağacında yarım kalan bir kopya
 * başka oturumların kapılarına düşer. `--stdin-filename` config'i yol üzerinden
 * çözer, içerik borudan gelir.
 */
function headSayim(proje, repoRel) {
  const { dizin, argv } = PROJELER[proje];
  let head = "";
  try {
    head = execFileSync("git", ["show", `HEAD:${repoRel}`], {
      cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null; // dosya HEAD'de YOK (yeni dosya) → katkısının tamamı bu commit'in
  }
  const rel = repoRel.startsWith(`${dizin}/`) ? repoRel.slice(dizin.length + 1) : repoRel;
  let ham = "";
  try {
    ham = execFileSync("npx", [...argv.slice(0, 1), "--stdin", "--stdin-filename", rel, "-f", "json"], {
      cwd: join(REPO_ROOT, dizin), encoding: "utf8", input: head, maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    ham = err.stdout ?? "";
    if (!ham.trim().startsWith("[")) return null; // ölçemedik → "arttı" VARSAYMA, geniş tarafa düş
  }
  const out = {};
  for (const d of JSON.parse(ham)) for (const m of d.messages ?? []) if (m.ruleId) out[m.ruleId] = (out[m.ruleId] ?? 0) + 1;
  return out;
}

let kirmizi = false;
let sikistirilabilir = 0;

for (const proje of SECILEN) {
  if (!PROJELER[proje]) {
    console.error(`Bilinmeyen proje: ${proje} (${Object.keys(PROJELER).join(", ")})`);
    process.exit(2);
  }
  const { sayim, kuralDosyalari, kuralDosyaSayim, dosyaSayisi, hata } = olc(proje);

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
    // VERDİKT: aşımı yapan kuralın ihlalleri BU COMMIT'in dosyalarında da var mı?
    // Bayraksız kipte (CI · elle koşum) soru sorulmaz, hepsi sert.
    // ⚠️ VERDİKT "DEĞDİ Mİ" DEĞİL "ARTTI MI" SORAR. Staged dosyanın o kurala
    // bugünkü katkısı HEAD'dekinden BÜYÜKSE aşımı bu commit getirmiştir; eşitse
    // (ya da küçükse) aşım YABANCIDIR ve commit durdurulmaz.
    const headCache = new Map();
    const benim = STAGED
      ? asan.filter((a) =>
          [...(kuralDosyalari[a.kural] ?? [])]
            .filter((f) => STAGED.has(f))
            .some((f) => {
              if (!headCache.has(f)) headCache.set(f, headSayim(proje, f));
              const h = headCache.get(f);
              if (h === null) return true; // HEAD'de yok / ölçülemedi → geniş tarafa
              return (kuralDosyaSayim[a.kural]?.[f] ?? 0) > (h[a.kural] ?? 0);
            }),
        )
      : asan;
    const yaz = benim.length > 0 ? console.error : console.log;
    if (benim.length > 0) kirmizi = true;
    yaz(
      `${benim.length > 0 ? "❌" : "⚠️ "} ${proje}: ${asan.length} kural TAVANI AŞTI ` +
        `(${dosyaSayisi} dosya, ${hata} error)`,
    );
    for (const a of asan) {
      const dosyalar = [...(kuralDosyalari[a.kural] ?? [])];
      const bende = dosyalar.filter((f) => !STAGED || STAGED.has(f));
      // Etiket YALNIZ commit kipinde anlamlıdır: bayraksız koşumda "commit" diye
      // bir küme yoktur ve "BU COMMIT'TE" yazmak uydurma bir iddia olurdu.
      const etiket = STAGED ? `  [${benim.includes(a) ? "BU COMMIT'TE" : "commit dışı"}]` : "";
      yaz(`   ${a.kural}: ${a.adet} > ${a.tavan}${etiket}`);
      for (const f of (bende.length ? bende : dosyalar).slice(0, 5)) yaz(`     · ${f}`);
    }
    if (benim.length > 0) {
      console.error(
        `   Bu kurallar YENİ KODDA ZORUNLU. Devralınan kodu düzeltmen gerekmiyor —\n` +
          `   eklediğin/dokunduğun yeri sınıra çek. Tavanı yükseltmek bir KARARDIR,\n` +
          `   gerekçesiyle birlikte yapılır (${PROJELER[proje].dizin}/lint-baseline.json).`,
      );
    } else {
      // Sahip UYDURULMAZ: "commit dışı" yalnız "bu commit'e girmiyor" demektir.
      console.log(
        `   Aşımı yapan ihlallerin hiçbiri BU COMMIT'in dosyasında değil — kapı geçti.\n` +
          `   Arka durak: CI'ın 'Lint tavanı' adımı tam ağacı ölçer ve orada SERTTİR.`,
      );
    }
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
