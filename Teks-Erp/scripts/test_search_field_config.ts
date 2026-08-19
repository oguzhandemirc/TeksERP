// =============================================================================
// BEKÇİ: Arama alanı kovaları doğru mu — METİN ↔ KOD (2026-08-19)
// Çalıştır: npx tsx scripts/test_search_field_config.ts
// =============================================================================
// `buildTextSearch` iki kova alır: METİN yolları katlanmış gölge kolona
// (`<kolon>Fold`) çevrilir, KOD yolları olduğu gibi kullanılır. Kovalar birer
// STRING DİZİSİDİR — yani TypeScript yanlış yerleştirmeyi GÖREMEZ ve hata ancak
// çalışma anında patlar:
//
//   • kod alanı METİN kovasına konursa  → Prisma "Unknown argument `codeFold`"
//     (HTTP 500) — arama kutusuna bir harf yazan herkes 500 alır;
//   • metin alanı KOD kovasına konursa  → katlama ATLANIR, arama sessizce
//     Türkçe-duyarlı olur ("canakkale" → 0 sonuç). Bu ikincisi ÇOK DAHA SİNSİ:
//     hata yok, log yok, yalnız eksik sonuç.
//
// İkisini de 2026-08-19'da fiilen yaşadık (13 route + 34 test fixture'ı + bir
// `listShipments` çağrısı). Bu dosya o sınıfı mekanik olarak kapatır.
//
// YÖNTEM: kaynak dosyalardaki `searchFields` / `codeSearchFields` dizi
// literalleri ve `buildTextSearch(..., { text: [...], code: [...] })` çağrıları
// TS AST ile taranır; her yol Prisma DMMF üzerinden ilişki ilişki çözülür.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { Prisma } from "@prisma/client";

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

type DmmfField = { name: string; kind: string; type: string };
type DmmfModel = { name: string; dbName?: string | null; fields: DmmfField[] };
const MODELS = (
  Prisma as unknown as { dmmf: { datamodel: { models: DmmfModel[] } } }
).dmmf.datamodel.models;
const byName = new Map(MODELS.map((m) => [m.name.toLowerCase(), m]));

/**
 * "customer.name" gibi bir yolu, kök modelden başlayarak alan alan çözer.
 * `some`/`is`/`every`/`none` Prisma filtre anahtarlarıdır — atlanır.
 */
function resolvePath(rootModel: string, dotted: string): { ok: boolean; why: string } {
  let model = byName.get(rootModel.toLowerCase());
  if (!model) return { ok: false, why: `model çözülemedi: ${rootModel}` };
  const segs = dotted.split(".").filter((s) => !["some", "is", "every", "none"].includes(s));
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    const field: DmmfField | undefined = model.fields.find((f) => f.name === seg);
    if (!field) return { ok: false, why: `${model.name}.${seg} YOK` };
    if (i === segs.length - 1) return { ok: true, why: `${model.name}.${seg}` };
    if (field.kind !== "object") return { ok: false, why: `${model.name}.${seg} ilişki değil` };
    const next = byName.get(field.type.toLowerCase());
    if (!next) return { ok: false, why: `ilişki modeli çözülemedi: ${field.type}` };
    model = next;
  }
  return { ok: false, why: "boş yol" };
}

/** Metin yolu: son segmentin `<seg>Fold` gölgesi VAR OLMALI. */
function foldedOf(dotted: string): string {
  const segs = dotted.split(".");
  segs[segs.length - 1] = `${segs[segs.length - 1]}Fold`;
  return segs.join(".");
}

interface Site {
  file: string;
  line: number;
  model: string;
  text: string[];
  code: string[];
}

/** `modelName: "customer"` / generic tip argümanı `Prisma.XWhereInput` → model adı. */
function modelFromWhereInput(t: string): string | null {
  const m = /^Prisma\.(\w+)WhereInput$/.exec(t);
  return m ? m[1]! : null;
}

function scan(file: string): Site[] {
  const src = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const out: Site[] = [];
  const lineOf = (n: ts.Node): number =>
    src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1;
  const strArray = (n: ts.Node | undefined): string[] | null => {
    if (!n || !ts.isArrayLiteralExpression(n)) return null;
    const items: string[] = [];
    for (const el of n.elements) {
      if (!ts.isStringLiteral(el)) return null; // dinamik → atla
      items.push(el.text);
    }
    return items;
  };

  const visit = (node: ts.Node): void => {
    // (a) BaseService config nesneleri: { modelName: "x", searchFields: [...], codeSearchFields: [...] }
    if (ts.isObjectLiteralExpression(node)) {
      const props = new Map<string, ts.Expression>();
      for (const p of node.properties) {
        if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) props.set(p.name.text, p.initializer);
      }
      const mn = props.get("modelName");
      if (mn && ts.isStringLiteral(mn) && (props.has("searchFields") || props.has("codeSearchFields"))) {
        out.push({
          file,
          line: lineOf(node),
          model: mn.text,
          text: strArray(props.get("searchFields")) ?? [],
          code: strArray(props.get("codeSearchFields")) ?? [],
        });
      }
    }
    // (b) buildTextSearch<Prisma.XWhereInput>(term, { text: [...], code: [...] })
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "buildTextSearch"
    ) {
      const targ = node.typeArguments?.[0];
      const model = targ ? modelFromWhereInput(targ.getText(src)) : null;
      const arg = node.arguments[1];
      if (model && arg && ts.isObjectLiteralExpression(arg)) {
        const props = new Map<string, ts.Expression>();
        for (const p of arg.properties) {
          if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) props.set(p.name.text, p.initializer);
        }
        out.push({
          file,
          line: lineOf(node),
          model,
          text: strArray(props.get("text")) ?? [],
          code: strArray(props.get("code")) ?? [],
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return out;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

function main(): void {
  const files = walk(path.resolve(__dirname, "..", "src"));
  const sites = files.flatMap(scan);

  console.log("\n── 1) Tarama zemini ──");
  // ⚠️ KÖRLÜK ZEMİNİ: AST tarayıcısı bir refactor'da boşa düşerse "ihlal yok"
  // ile "hiçbir şeye bakılmadı" aynı yeşile çıkardı.
  check("taranan dosya ≥ 200", files.length >= 200, `${files.length} dosya`);
  check("bulunan arama konfigi ≥ 20", sites.length >= 20, `${sites.length} konfig`);

  console.log("\n── 2) METİN yolları: katlanmış gölge kolon VAR MI ──");
  let textBad = 0;
  for (const s of sites) {
    for (const p of s.text) {
      const r = resolvePath(s.model, foldedOf(p));
      if (!r.ok) {
        textBad++;
        check(
          `${path.basename(s.file)}:${s.line} → text:"${p}"`,
          false,
          `${r.why} — bu bir KOD alanıysa codeSearchFields'e taşı`,
        );
      }
    }
  }
  check("tüm METİN yolları katlanmış kolona çözülüyor", textBad === 0, `${sites.reduce((a, s) => a + s.text.length, 0)} yol`);

  console.log("\n── 3) KOD yolları: kolon VAR MI + gölgesi YOK MU ──");
  let codeBad = 0;
  for (const s of sites) {
    for (const p of s.code) {
      const r = resolvePath(s.model, p);
      if (!r.ok) {
        codeBad++;
        check(`${path.basename(s.file)}:${s.line} → code:"${p}"`, false, r.why);
        continue;
      }
      // Gölgesi OLAN bir kolon KOD kovasına konmuşsa katlama sessizce atlanır.
      const shadow = resolvePath(s.model, foldedOf(p));
      if (shadow.ok) {
        codeBad++;
        check(
          `${path.basename(s.file)}:${s.line} → code:"${p}"`,
          false,
          `bu kolonun katlanmış gölgesi VAR (${shadow.why}) → searchFields'e taşı, yoksa arama Türkçe-duyarlı kalır`,
        );
      }
    }
  }
  check("tüm KOD yolları geçerli ve gölgesiz", codeBad === 0, `${sites.reduce((a, s) => a + s.code.length, 0)} yol`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
