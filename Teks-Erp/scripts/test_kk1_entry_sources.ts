// =============================================================================
// test_kk1_entry_sources — KK1 giriş kaynağı kapsamı TEK KAYNAK (DB'siz)
// =============================================================================
// Koşum: npx tsx scripts/test_kk1_entry_sources.ts
//
// §1 Backend `KK1_ENTRY_SOURCES` ↔ mobil `KK1_LIST_ENTRY_SOURCES` KÜME olarak
//    birebir (sıra değil). İki proje ortak modül import edemez; mobil dosyası
//    metinden okunur (d9'un `test_mobil_enum_aynasi` emsali).
//    ⚠️ BEYAN EDİLMİŞ BOŞLUK: bu kontrol BU ÇİFTİ ölçer; "sabit-liste aynası"
//    SINIFININ envanteri YOKTUR — ikinci bir sabit çift doğduğunda (ör. bir
//    statü/sebep listesi) hiçbir şey onu görmez, envanter gerekir (d9 yazar,
//    enum aynasının kardeşi; 2026-09-14).
// §2 Dashboard KK1 karnesi listeyi ELLE yazmaz: SQL'de `'SUPPLIER_RECEIPT'`
//    literali yok, sabit `Prisma.join` ile giriyor.
// §3 Backend'de başka hiçbir okuyucu bu kümeyi elle kurmaz (grep: src altında
//    `'SUPPLIER_RECEIPT', 'MANUAL_ENTRY'` dizisi 0).
// §4 KARDEŞ KÜME — Tambur'dan çıkan top: `TAMBUR_ENTRY_SOURCES` (TAMBUR_SPLIT ·
//    TAMBUR_MANUAL) tek sabit; `tambur.service` Çıkanlar listesi ondan okur, src
//    altında `[RollEntrySource.TAMBUR_SPLIT, RollEntrySource.TAMBUR_MANUAL]` elle dizisi 0.
//    ⚠️ Bu AYNALI ÇİFT DEĞİL (§1'in sınıfı: iki dosya ayrışır → karşılaştırma);
//    "aynı bilgi N yerde ELLE" sınıfının backend-içi üyesi (kusur: tüketici sabiti
//    atlar → ARAMA; akrabaları `test_yerel_ayar_bagimliligi §3`, `fmt-date`) —
//    panzehiri envanter değil TEK YARDIMCIDIR; envanter yalnız borcu sayar (d9).
// Negatif sonda: mobil listeden `WEAVING`i sil → §1 kırmızı; dashboard'a literal
// listeyi geri koy → §2 kırmızı.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { KK1_ENTRY_SOURCES } from "../src/constants/kk1-entry-sources";
import { TAMBUR_ENTRY_SOURCES } from "../src/constants/tambur-entry-sources";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

// §1
const mobilPath = join(__dirname, "..", "..", "mobil", "src", "constants", "kk1EntrySources.ts");
const mobilSrc = readFileSync(mobilPath, "utf8");
const m = mobilSrc.match(/KK1_LIST_ENTRY_SOURCES[^=]*=\s*\[([\s\S]*?)\]/);
const mobil = new Set([...(m?.[1] ?? "").matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((x) => x[1]));
const backend = new Set<string>(KK1_ENTRY_SOURCES);
check("§1 mobil listesi okundu (≥ 2 değer)", mobil.size >= 2, [...mobil].join(","));
check(
  "§1 backend KK1_ENTRY_SOURCES = mobil KK1_LIST_ENTRY_SOURCES (küme)",
  backend.size === mobil.size && [...backend].every((v) => mobil.has(v)),
  `backend={${[...backend].sort().join(",")}} mobil={${[...mobil].sort().join(",")}}`,
);

// §2
const dash = readFileSync(join(__dirname, "..", "src", "services", "dashboard.service.ts"), "utf8").replace(/^\s*--.*$/gm, "");
check("§2 dashboard KK1 karnesi sabitten okuyor", /Prisma\.join\(\[\.\.\.KK1_ENTRY_SOURCES\]\)/.test(dash));
check("§2 dashboard SQL'inde elle 'SUPPLIER_RECEIPT' literali yok", !/'SUPPLIER_RECEIPT'/.test(dash));

// §3
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}
const src = join(__dirname, "..", "src");
const elle = walk(src).filter((f) => !f.endsWith("kk1-entry-sources.ts") && /['"]SUPPLIER_RECEIPT['"]\s*,\s*['"]MANUAL_ENTRY['"]/.test(readFileSync(f, "utf8").replace(/^\s*(\/\/|--|\*).*$/gm, "")));
check("§3 backend'de KK1 kümesini elle kuran başka okuyucu yok", elle.length === 0, elle.map((f) => f.replace(src, "src")).join(","));

// §4
const tamburSet = new Set<string>(TAMBUR_ENTRY_SOURCES);
check("§4 TAMBUR_ENTRY_SOURCES = {TAMBUR_SPLIT, TAMBUR_MANUAL}", tamburSet.size === 2 && tamburSet.has("TAMBUR_SPLIT") && tamburSet.has("TAMBUR_MANUAL"));
const tambur = readFileSync(join(src, "services", "tambur.service.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
check("§4 tambur.service Çıkanlar listesi sabitten okuyor", /entrySource:\s*\{\s*in:\s*\[\.\.\.TAMBUR_ENTRY_SOURCES\]\s*\}/.test(tambur));
const elleTambur = walk(src).filter((f) => !f.endsWith("tambur-entry-sources.ts") && /RollEntrySource\.TAMBUR_(SPLIT|MANUAL)\s*,\s*RollEntrySource\.TAMBUR_(SPLIT|MANUAL)/.test(readFileSync(f, "utf8").replace(/^\s*(\/\/|--|\*).*$/gm, "")));
check("§4 src'de TAMBUR kümesini elle kuran okuyucu yok", elleTambur.length === 0, elleTambur.map((f) => f.replace(src, "src")).join(","));

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
