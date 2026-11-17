// =============================================================================
// Bekçi: ÇÖZGÜ KARTI İPLİĞİ TEK KAYNAK — kartın ipliği/denyesi yalnız `warpSpecYarnLines` ailesinden (DB'siz, AST)
// Çalıştır: npx tsx scripts/test_cozgu_iplik_tek_kaynak.ts
// =============================================================================
// NEDEN (fason devere D2, 2026-11-17): çözgü kartı artık çok ipliklidir (`WarpSpecYarn`). `WarpSpec.yarnItemId`
// yalnız "ana iplik", `endsCount` Σ teldir; ikisini çarpıp ana ipliğin denyesiyle kg hesaplayan okuyucu çok iplikli
// kartta YANLIŞ kg verir (5250 × 165 + 5250 × 70 yerine 10500 × 165). Kural:
//   §1 Kartın `yarnItem`ini DENYESİYLE seçmek yasak (Prisma select'te `warpSpec → yarnItem → linearDensityDen`,
//      `yarns` altı serbest) — denye satırlardan, `WARP_SPEC_YARN_DENIER_SELECT` + `warpSpecDenierLines` ile okunur.
//   §2 `<x>.warpSpec.yarnItem` / `.yarnItemId` doğrudan okuması yasak (ana iplik tek iplik değildir).
//   §3 `9_000_000` literali yalnız `constants/warp-beam.ts`te (formülün tek evi).
// Baseline BOŞ: her ihlal kırmızıdır. Muaf yalnız kartın kendi yazıcısı ve satır okuyucusu.
// NEGATİF SONDA (2026-11-17 koşuldu, geri alındı): `warp-beam-mount.helper.ts`e `warpSpec → yarnItem → linearDensityDen`
//   select'i eklendi → "ihlal yok" kırmızı (1 ihlal); ayrıca bellek içi sonda üç kuralı her koşumda ölçer.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { walkTs } from "./lib/ts-tarama";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const FORMUL_EVI = "src/constants/warp-beam.ts";
/** Kartın özet kolonlarını yazan servis + satır okuyucusunun kendisi — kolonlara bakmaları işleridir. */
const MUAF = new Set(["src/services/helpers/warp-spec-yarn.helper.ts", "src/services/warp-spec.service.ts"]);

type Ihlal = { kural: string; yer: string };

/** Düğümün atası (kendisi hariç) property-assignment adları — içten dışa. */
function ataAnahtarlar(n: ts.Node): string[] {
  const out: string[] = [];
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isPropertyAssignment(p)) out.push(p.name.getText());
    if (ts.isVariableDeclaration(p)) out.push(`const:${p.name.getText()}`);
  }
  return out;
}

/** Kart select bağlamı mı: ata anahtarlarda `warpSpec` ya da kart select sabiti (ad/`satisfies` içinde WarpSpec) ya da `prisma.warpSpec.*` çağrısı. */
function kartBaglami(n: ts.Node): boolean {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isPropertyAssignment(p)) {
      const ad = p.name.getText();
      if (ad === "yarns") return false; // satır altı serbest (her satırın kendi ipliği)
      if (ad === "warpSpec" || ad === "warpSpecs") return true;
    }
    if (ts.isVariableDeclaration(p)) {
      if (/warp_?spec/i.test(p.name.getText()) && !/weft/i.test(p.name.getText())) return true;
      if (p.initializer && /WarpSpecSelect|WarpSpecInclude/.test(p.initializer.getText().slice(-80))) return true;
    }
    if (ts.isCallExpression(p) && /\.warpSpec\.(find\w*|create|update|upsert)$/.test(p.expression.getText())) return true;
  }
  return false;
}

function tara(rel: string, sf: ts.SourceFile, ihlaller: Ihlal[]): void {
  // Dosya düzeyi sabitler: `yarnItem: { select: YARN_SELECT }` → sabitin metni de aranır (tek seviye).
  const sabitler = new Map<string, string>();
  sf.forEachChild((s) => {
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) sabitler.set(d.name.text, d.initializer.getText());
  });
  const metinGenis = (n: ts.Node): string => {
    let t = n.getText();
    for (const [ad, m] of sabitler) if (new RegExp(`\\b${ad}\\b`).test(t)) t += ` ${m}`;
    return t;
  };
  const satir = (n: ts.Node) => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const visit = (n: ts.Node): void => {
    if (!MUAF.has(rel)) {
      if (ts.isPropertyAssignment(n) && n.name.getText() === "yarnItem" && /linearDensityDen/.test(metinGenis(n.initializer)) && kartBaglami(n)) {
        ihlaller.push({ kural: "§1 kartın yarnItem'i denyesiyle seçilmiş", yer: satir(n) });
      }
      if (ts.isPropertyAccessExpression(n) && (n.name.text === "yarnItem" || n.name.text === "yarnItemId")) {
        const sol = n.expression.getText().replace(/[!?]/g, "");
        if (/(^|\.)warpSpec$/.test(sol)) ihlaller.push({ kural: `§2 ${sol}.${n.name.text} doğrudan okundu`, yer: satir(n) });
      }
    }
    if (rel !== FORMUL_EVI && ts.isNumericLiteral(n) && Number(n.text.replace(/_/g, "")) === 9_000_000) {
      ihlaller.push({ kural: "§3 9_000_000 literali formülün evi dışında", yer: satir(n) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

function main(): void {
  console.log("Bekçi: çözgü kartı ipliği tek kaynak");
  const ihlaller: Ihlal[] = [];
  const dosyalar = walkTs(SRC);
  for (const abs of dosyalar) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    const sf = ts.createSourceFile(abs, fs.readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true);
    tara(rel, sf, ihlaller);
  }
  check("tarama kör değil (src altında ≥ 500 dosya)", dosyalar.length >= 500, `${dosyalar.length} dosya`);
  // Körlük sondası: kuralların kendisi bilinen ihlal örneklerinde öter (bellek içi).
  const ornek = ts.createSourceFile(
    "ornek.ts",
    "const a = { warpSpec: { select: { yarnItem: { select: { linearDensityDen: true } } } } };\nconst b = beam.warpSpec.yarnItem;\nconst c = 9_000_000;\nconst d = { warpSpec: { select: { yarns: { select: { yarnItem: { select: { linearDensityDen: true } } } } } } };",
    ts.ScriptTarget.Latest,
    true,
  );
  const sonda: Ihlal[] = [];
  tara("ornek.ts", ornek, sonda);
  check("sonda: üç kural da bilinen örnekte öter, `yarns` altı serbest", sonda.length === 3 && new Set(sonda.map((s) => s.kural.slice(0, 2))).size === 3, sonda.map((s) => s.kural).join(" | "));
  for (const i of ihlaller) console.log(`     ${i.yer} — ${i.kural}`);
  check("ihlal yok (baseline boş)", ihlaller.length === 0, `${ihlaller.length} ihlal`);
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
