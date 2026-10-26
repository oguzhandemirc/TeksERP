// =============================================================================
// test_yazilabilir_alan_beyani — genel CRUD'da yeni skaler kolon = yeni yazılabilir alan
// =============================================================================
// BaseService konfigü taşıyan her modelin genel gövdeden YAZILABİLEN kolonları
// (`baseWritableFields`: DMMF skaler/enum − sistem − *Fold − BASE_WRITE_CLOSED_FIELDS) beyan anlık
// görüntüsüne EŞİT olmalı. Yeni kolon kırmızı verir: "bu alan o uçtan yazılabilir
// olmalı mı?" — evetse beyana ekle (doğrulaması aynı dilimde), hayırsa
// `src/constants/write-guard.ts`te kapat. Beyanı yeniden üretmek: `--beyan-yaz`.
// Statik; DB sorgusu yok (base.service import edilir).
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { BASE_WRITE_CLOSED_FIELDS } from "../src/constants/write-guard";
import { baseScalarFields, baseWritableFields } from "../src/services/base.service";
import { YAZILABILIR_ALAN_BEYANI } from "./lib/yazilabilir-alan-beyan";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

const KOK = path.resolve(__dirname, "..");

function dosyalar(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...dosyalar(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** BaseService konfiglerindeki `modelName: "x"` — routes + services (search-entities constants'ta, taranmaz). */
function konfigModelleri(): Set<string> {
  const set = new Set<string>();
  for (const f of [...dosyalar(path.join(KOK, "src/routes")), ...dosyalar(path.join(KOK, "src/services"))]) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/modelName:\s*"(\w+)"/g)) set.add(m[1]!);
  }
  return set;
}

function yazilabilir(model: string): string[] | null {
  const set = baseWritableFields(model);
  return set ? [...set].sort() : null;
}

const modeller = [...konfigModelleri()].sort();

if (process.argv.includes("--beyan-yaz")) {
  const satirlar = modeller.map((m) => `  ${m}: [${(yazilabilir(m) ?? []).map((n) => JSON.stringify(n)).join(", ")}],`);
  const govde = `// ÜRETİLMİŞ BEYAN — \`npx tsx scripts/test_yazilabilir_alan_beyani.ts --beyan-yaz\`.\n` +
    `// Genel CRUD gövdesinden yazılabilen kolonlar; satır eklemek bilinçli bir "yazılabilir" kararıdır.\n` +
    `export const YAZILABILIR_ALAN_BEYANI: Readonly<Record<string, readonly string[]>> = {\n${satirlar.join("\n")}\n};\n`;
  fs.writeFileSync(path.join(KOK, "scripts/lib/yazilabilir-alan-beyan.ts"), govde);
  console.log(`beyan yazıldı: ${modeller.length} model`);
  process.exit(0);
}

console.log("§1 boğaz: sanitizeWriteData kapalı kolonları düşürür");
{
  const src = fs.readFileSync(path.join(KOK, "src/services/base.service.ts"), "utf8");
  const i = src.indexOf("protected sanitizeWriteData(");
  const govde = i >= 0 ? src.slice(i, src.indexOf("\n  }\n", i)) : "";
  check("sanitizeWriteData süzgeci baseWritableFields(this.config.modelName) (kapalı kolonlar dahil tek kaynak)",
    /baseWritableFields\(this\.config\.modelName\)/.test(govde));
  const f = src.slice(src.indexOf("export function baseWritableFields("), src.indexOf("\n}\n", src.indexOf("export function baseWritableFields(")));
  check("baseWritableFields kapalı kolonları düşürür", /baseWriteClosedFields\(modelName\)/.test(f) && /!closed\.includes\(f\)/.test(f));
}

console.log("§2 kapalı kolon beyanı canlı");
for (const [model, alanlar] of Object.entries(BASE_WRITE_CLOSED_FIELDS)) {
  const skaler = baseScalarFields(model);
  check(`${model} DMMF'te var ve BaseService konfigü taşıyor`, Boolean(skaler) && modeller.includes(model));
  for (const a of alanlar) check(`${model}.${a} DMMF skaleri (bayat kapatma yok)`, Boolean(skaler?.has(a)));
}

console.log("§3 yazılabilir alan = beyan (yeni kolon kararsız geçmez)");
for (const model of modeller) {
  const gercek = yazilabilir(model);
  if (!gercek) { check(`${model} DMMF'te çözülür`, false); continue; }
  const beyan = YAZILABILIR_ALAN_BEYANI[model];
  if (!beyan) { check(`${model} beyanda var`, false, "scripts/lib/yazilabilir-alan-beyan.ts'e satır ekle (--beyan-yaz)"); continue; }
  const b = new Set(beyan);
  const g = new Set(gercek);
  const yeni = gercek.filter((n) => !b.has(n));
  const eski = beyan.filter((n) => !g.has(n));
  check(`${model}: ${gercek.length} yazılabilir kolon beyanla eşit`, yeni.length === 0 && eski.length === 0,
    [yeni.length ? `beyansız yazılabilir: ${yeni.join(",")} — yazılabilir mi? beyana ekle ya da write-guard'da kapat` : "",
     eski.length ? `beyanda ama artık yazılabilir değil: ${eski.join(",")}` : ""].filter(Boolean).join(" · "));
}
for (const model of Object.keys(YAZILABILIR_ALAN_BEYANI)) {
  if (!modeller.includes(model)) check(`beyandaki ${model} hâlâ BaseService konfigü taşıyor`, false, "beyandan sil");
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
