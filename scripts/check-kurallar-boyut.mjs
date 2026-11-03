#!/usr/bin/env node
// =============================================================================
// KURALLAR BOYUT CIRCIRI — docs/kurallar/*.md (zero-dep, DB'siz, ağsız)
// =============================================================================
// ⭐ NEDEN VAR (2026-11-03, kullanıcı onayı): alan kural dosyası her dokunuştan ÖNCE okunur;
//    ölçümde 14 dosya 45–170 KB'tı ve her okuma bağlam bütçesinden yedi. Kural "tek satır,
//    gerekçe arşivde" diyordu ama boyutu ölçen yoktu ⇒ dosyalar yalnız büyüdü.
//
// YÜKLEM: her `docs/kurallar/<ad>.md` (ALT DİZİNLER — ör. `ayrinti/` — HARİÇ) ≤ max(SINIR, taban).
//   Taban `scripts/lib/kurallar-boyut-taban.json` — CIRCIR: büyüyemez; dosya küçülünce
//   `--yaz` tabanı İNDİRİR (asla yükseltmez). Küçülmüş ama tabanı inmemiş dosya UYARIDIR, kırmızı
//   değil (paralel kısaltma PR'ları kırılmasın). Tabanı yükseltmek yalnız elle, gerekçeli diff'le.
// KAYNAK INDEX (`git show :yol`): commit kapısında commit edilecek bayt ölçülür; repo dışı → ağaç.
// ÜÇ SONUÇ: 0 yeşil · 1 ihlal · 2 ÖLÇÜLEMEDİ (dosya bulunamadı / taban okunamadı).
//
//   node scripts/check-kurallar-boyut.mjs            # denetim
//   node scripts/check-kurallar-boyut.mjs --yaz      # küçülen dosyaların tabanını indir
//   node scripts/check-kurallar-boyut.mjs --sonda    # kalıcı negatif + pozitif sondalar
// =============================================================================
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KOK = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SINIR = 20000;
const DIZIN = "docs/kurallar";
const TABAN_YOLU = "scripts/lib/kurallar-boyut-taban.json";
const EN_AZ_DOSYA = 10; // körlük zemini: dizin bulunamadıysa "ihlal yok" yeşili çıkmasın

/** Kapsam: yalnız dizinin DOĞRUDAN altındaki .md (alt dizinler — ayrinti/ — hariç). */
export function kapsamda(rel) {
  return new RegExp(`^${DIZIN}/[^/]+\\.md$`).test(rel);
}

/** Saf yüklem: boyutlar {rel: bayt}, taban {rel: bayt} → ihlaller + çürüme + bayat taban. */
export function degerlendir(boyutlar, taban) {
  const ihlaller = [];
  const curume = [];
  for (const [rel, bayt] of Object.entries(boyutlar)) {
    if (!kapsamda(rel)) continue;
    const tavan = Math.max(SINIR, taban[rel] ?? 0);
    if (bayt > tavan) ihlaller.push({ rel, bayt, tavan });
    else if (taban[rel] !== undefined && bayt < taban[rel]) curume.push({ rel, bayt, taban: taban[rel] });
  }
  const bayat = Object.keys(taban).filter((rel) => boyutlar[rel] === undefined);
  return { ihlaller, curume, bayat };
}

/** `--yaz`: tabanı yalnız İNDİRİR; SINIR altına düşen ve bayat girdiler silinir. */
export function yeniTaban(boyutlar, taban) {
  const out = {};
  for (const [rel, eski] of Object.entries(taban)) {
    const bayt = boyutlar[rel];
    if (bayt === undefined || bayt <= SINIR) continue;
    out[rel] = Math.min(eski, bayt);
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function olc() {
  try {
    const liste = execFileSync("git", ["ls-files", "-z", "--", DIZIN], { cwd: KOK, encoding: "utf8" }).split("\0").filter(kapsamda);
    const boyutlar = {};
    for (const rel of liste) boyutlar[rel] = execFileSync("git", ["show", `:${rel}`], { cwd: KOK, maxBuffer: 64 * 1024 * 1024 }).length;
    return { boyutlar, kaynak: "INDEX" };
  } catch {
    const boyutlar = {};
    for (const ad of readdirSync(join(KOK, DIZIN))) {
      const rel = `${DIZIN}/${ad}`;
      if (kapsamda(rel)) boyutlar[rel] = statSync(join(KOK, rel)).size;
    }
    return { boyutlar, kaynak: "AĞAÇ" };
  }
}

function tabaniOku() {
  return JSON.parse(readFileSync(join(KOK, TABAN_YOLU), "utf8")).taban;
}

function tabaniYaz(taban) {
  const govde = {
    _not: `docs/kurallar/*.md boyut cırcırı (scripts/check-kurallar-boyut.mjs): SINIR ${SINIR} bayt üstü dosyaların tavanı. Yalnız --yaz ile iner; yükseltme elle ve gerekçeli.`,
    taban,
  };
  writeFileSync(join(KOK, TABAN_YOLU), JSON.stringify(govde, null, 2) + "\n");
}

function denetim(yaz) {
  if (!existsSync(join(KOK, TABAN_YOLU))) { console.log(`❌ ÖLÇÜLEMEDİ — taban yok: ${TABAN_YOLU}`); return 2; }
  const { boyutlar, kaynak } = olc();
  const adet = Object.keys(boyutlar).length;
  if (adet < EN_AZ_DOSYA) { console.log(`❌ ÖLÇÜLEMEDİ — ${DIZIN} altında ${adet} dosya (< ${EN_AZ_DOSYA}); kaynak ${kaynak}`); return 2; }
  const taban = tabaniOku();
  const { ihlaller, curume, bayat } = degerlendir(boyutlar, taban);
  for (const i of ihlaller) console.log(`❌ ${i.rel}: ${i.bayt} bayt > tavan ${i.tavan} — yeni kural tek satır; gerekçe docs/history/arsiv/, ayrıntı docs/kurallar/ayrinti/`);
  if (yaz) {
    if (ihlaller.length) { console.log("❌ --yaz reddedildi: ihlal varken taban yazılmaz (cırcır yükselmez)"); return 1; }
    tabaniYaz(yeniTaban(boyutlar, taban));
    console.log(`✅ taban yazıldı (${TABAN_YOLU}) — ${curume.length} dosya indi, ${bayat.length} bayat girdi silindi`);
    return 0;
  }
  for (const c of curume) console.log(`⚠️ ${c.rel}: ${c.bayt} < taban ${c.taban} — tabanı indir: node scripts/check-kurallar-boyut.mjs --yaz`);
  for (const b of bayat) console.log(`⚠️ ${b}: tabanda var, dosya yok — --yaz siler`);
  console.log(`${ihlaller.length ? "❌" : "✅"} kurallar boyutu: ${adet} dosya (${kaynak}) · ${ihlaller.length} ihlal · ${curume.length} çürüme · sınır ${SINIR} bayt`);
  return ihlaller.length ? 1 : 0;
}

function sonda() {
  let fail = 0;
  const check = (ad, ok) => { if (!ok) fail++; console.log(`  ${ok ? "✅" : "❌"} ${ad}`); };
  const A = `${DIZIN}/a.md`;
  const B = `${DIZIN}/b.md`;
  const T = { [A]: 30000 };
  check("büyüyen dosya (taban + 1) ISIRILIR", degerlendir({ [A]: 30001 }, T).ihlaller.length === 1);
  check("tabandaki boyut kabul", degerlendir({ [A]: 30000 }, T).ihlaller.length === 0);
  check("tabansız yeni dosya SINIR + 1 ISIRILIR", degerlendir({ [B]: SINIR + 1 }, {}).ihlaller.length === 1);
  check("tabansız dosya tam SINIR kabul", degerlendir({ [B]: SINIR }, {}).ihlaller.length === 0);
  check("ayrinti/ alt dizini KAPSAM DIŞI (500 KB)", degerlendir({ [`${DIZIN}/ayrinti/x.md`]: 500000 }, {}).ihlaller.length === 0 && !kapsamda(`${DIZIN}/ayrinti/x.md`));
  check("küçülen dosya kırmızı DEĞİL, çürüme listelenir", (() => { const r = degerlendir({ [A]: 25000 }, T); return r.ihlaller.length === 0 && r.curume.length === 1; })());
  check("--yaz tabanı İNDİRİR, asla yükseltmez", yeniTaban({ [A]: 25000 }, T)[A] === 25000 && yeniTaban({ [A]: 40000 }, T)[A] === 30000);
  check("--yaz SINIR altına düşeni ve bayat girdiyi siler", Object.keys(yeniTaban({ [A]: 1000 }, T)).length === 0 && Object.keys(yeniTaban({}, T)).length === 0);
  // Gerçek veriye mutasyon: en büyük dosyaya 1 bayt ⇒ ısırmalı (taban gerçek boyuta eşitse).
  if (existsSync(join(KOK, TABAN_YOLU))) {
    const { boyutlar } = olc();
    const taban = tabaniOku();
    const [enBuyuk] = Object.entries(boyutlar).sort((x, y) => y[1] - x[1]);
    if (enBuyuk) {
      const mutant = { ...boyutlar, [enBuyuk[0]]: Math.max(enBuyuk[1], taban[enBuyuk[0]] ?? 0, SINIR) + 1 };
      check(`gerçek veri: ${enBuyuk[0]} tavanının 1 bayt üstü ISIRILIR`, degerlendir(mutant, taban).ihlaller.length === 1);
    }
  }
  console.log(`\n=== Sonuç: ${fail ? "sonda KIRMIZI" : "sondalar yeşil"} ===`);
  return fail ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith("check-kurallar-boyut.mjs")) {
  if (process.argv.includes("--sonda")) process.exitCode = sonda();
  else if (process.argv.includes("--ilk")) {
    // Yalnız taban HİÇ yokken: bugünkü boyutları taban yapar (ilk kurulum).
    if (existsSync(join(KOK, TABAN_YOLU))) { console.log("❌ --ilk reddedildi: taban zaten var (yalnız --yaz indirir)"); process.exitCode = 1; }
    else {
      const { boyutlar } = olc();
      tabaniYaz(Object.fromEntries(Object.entries(boyutlar).filter(([, b]) => b > SINIR).sort(([a], [b]) => a.localeCompare(b))));
      console.log(`✅ ilk taban yazıldı (${TABAN_YOLU})`);
    }
  } else process.exitCode = denetim(process.argv.includes("--yaz"));
}
