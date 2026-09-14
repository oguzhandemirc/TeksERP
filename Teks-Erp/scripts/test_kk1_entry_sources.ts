// =============================================================================
// test_kk1_entry_sources — KK1 giriş kaynağı kapsamı TEK KAYNAK (DB'siz)
// =============================================================================
// Koşum: npx tsx scripts/test_kk1_entry_sources.ts
//
// §1 Backend `KK1_ENTRY_SOURCES` ↔ mobil `KK1_LIST_ENTRY_SOURCES` KÜME olarak
//    birebir (sıra değil). İki proje ortak modül import edemez; mobil dosyası
//    metinden okunur (d9'un `test_mobil_enum_aynasi` emsali).
// §2 Dashboard KK1 karnesi listeyi ELLE yazmaz: SQL'de `'SUPPLIER_RECEIPT'`
//    literali yok, sabit `Prisma.join` ile giriyor.
// §3 Backend'de başka hiçbir okuyucu bu kümeyi elle kurmaz (grep: src altında
//    `'SUPPLIER_RECEIPT', 'MANUAL_ENTRY'` dizisi 0).
// Negatif sonda: mobil listeden `WEAVING`i sil → §1 kırmızı; dashboard'a literal
// listeyi geri koy → §2 kırmızı.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { KK1_ENTRY_SOURCES } from "../src/constants/kk1-entry-sources";

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

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
