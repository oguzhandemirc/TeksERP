// =============================================================================
// test_yazilabilir_alan_beyani — genel CRUD'da yeni skaler kolon = yeni yazılabilir alan
// =============================================================================
// BaseService konfigü taşıyan her modelin genel gövdeden YAZILABİLEN kolonları
// (DMMF skaler/enum − sistem − *Fold − BASE_WRITE_CLOSED_FIELDS) beyan anlık
// görüntüsüne EŞİT olmalı. Yeni kolon kırmızı verir: "bu alan o uçtan yazılabilir
// olmalı mı?" — evetse beyana ekle (doğrulaması aynı dilimde), hayırsa
// `src/constants/write-guard.ts`te kapat. Beyanı yeniden üretmek: `--beyan-yaz`.
// Statik; DB gerekmez.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { BASE_WRITE_CLOSED_FIELDS } from "../src/constants/write-guard";
import { YAZILABILIR_ALAN_BEYANI } from "./lib/yazilabilir-alan-beyan";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

const KOK = path.resolve(__dirname, "..");
type DmmfField = { name: string; kind: string };
const MODELS = (Prisma as unknown as { dmmf: { datamodel: { models: Array<{ name: string; fields: DmmfField[] }> } } })
  .dmmf.datamodel.models;
const byName = new Map(MODELS.map((m) => [m.name.toLowerCase(), m]));

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
  const m = byName.get(model.toLowerCase());
  if (!m) return null;
  const kapali = new Set(BASE_WRITE_CLOSED_FIELDS[model] ?? []);
  return m.fields
    .filter((f) => (f.kind === "scalar" || f.kind === "enum") && !f.name.endsWith("Fold"))
    .map((f) => f.name)
    .filter((n) => n !== "id" && n !== "createdAt" && n !== "updatedAt" && !kapali.has(n))
    .sort();
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
  check("sanitizeWriteData baseWriteClosedFields(this.config.modelName) okur ve atlar",
    /baseWriteClosedFields\(this\.config\.modelName\)/.test(govde) && /closed\.includes\(key\)\)\s*continue/.test(govde));
}

console.log("§2 kapalı kolon beyanı canlı");
for (const [model, alanlar] of Object.entries(BASE_WRITE_CLOSED_FIELDS)) {
  const m = byName.get(model.toLowerCase());
  check(`${model} DMMF'te var ve BaseService konfigü taşıyor`, Boolean(m) && modeller.includes(model));
  for (const a of alanlar) check(`${model}.${a} DMMF skaleri (bayat kapatma yok)`, Boolean(m?.fields.some((f) => f.name === a && (f.kind === "scalar" || f.kind === "enum"))));
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
process.exit(fail > 0 ? 1 : 0);
