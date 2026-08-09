// =============================================================================
// Test: RUNTIME (value) import döngüsü YOK + tip sözleşmesi değer taşımıyor
// Çalıştır: npx tsx scripts/test_import_cycles.ts
// =============================================================================
// (2026-08-09 denetimi, F-BLG-MIM-001)
//
// ⚠️ DÜZ `madge --circular` KULLANMIYORUZ ve bu bilinçli. madge `import type`
// kenarını GERÇEK import gibi sayar; bu repoda 14 "döngü" raporlar ve HİÇBİRİ
// gerçek değildir — TypeScript o kenarları derlemede siler. Kör bir madge
// çıktısına bakmak iki şeye yol açar: ya 14 yanlış pozitife alışılır ve gerçek
// bir döngü aralarında kaybolur, ya da kontrol tamamen kapatılır.
//
// DOĞRUSU: value ve type kenarlarını AYIR, yalnız VALUE grafiğinde SCC (Tarjan)
// koştur. Bu dosya onu yapar ve iki şeyi birden kilitler:
//   1. `src/` içinde value döngüsü YOK (bugün ölçülen: 0).
//   2. `types/label.types.ts` DEĞER İHRAÇ ETMİYOR — yani oradan bir değer import
//      etmek mümkün değil, dolayısıyla o dosya üzerinden döngü YAPISAL OLARAK
//      imkânsız. Tip sözleşmesinin oraya taşınmasının bütün kazancı budur;
//      dosyaya bir sabit/fonksiyon eklenirse garanti sessizce kalkar.
//
// SAF: DB yok, HTTP yok, derleme yok — yalnız kaynak tarama.
// =============================================================================
import { readdirSync, readFileSync, statSync } from "fs";
import { join, dirname, resolve, relative } from "path";

const SRC = resolve(__dirname, "../src");
/** Körlük zemini: tarayıcı boşa düşerse "döngü yok" ile "hiçbir şeye bakılmadı" ayrışsın. */
const MIN_FILES = 100;
const MIN_VALUE_EDGES = 200;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/**
 * Yorumları söker — İMPORT TARAYICISININ ÖN KOŞULU.
 *
 * İlk yazımda sökülmüyordu ve bekçi İKİ yanlış pozitif üretti (ölçüldü):
 *   • `lib/string-validators.ts:6` bir ÖRNEK import'u yorum içinde gösteriyor
 *     (`//   import { validateName } from "../lib/string-validators";`) → kendine
 *     kenar → sahte "döngü".
 *   • `types/label.types.ts`in başlığı, taşınma gerekçesini anlatırken eski
 *     import satırını ALINTILIYOR → "hâlâ label.service'ten alıyor" sahte ihlali.
 * Bir bekçi kodu ölçmeli, kodun yanındaki cümleyi değil.
 *
 * Satır yorumunda `//` yalnız ondan ÖNCEKİ tırnak sayısı ÇİFT ise yorum kabul
 * edilir — `"https://..."` gibi string içi `//` kesilmesin.
 */
function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock
    .split("\n")
    .map((line) => {
      let quotes = 0;
      for (let i = 0; i < line.length - 1; i++) {
        const ch = line[i]!;
        if (ch === '"' || ch === "'" || ch === "`") quotes++;
        if (ch === "/" && line[i + 1] === "/" && quotes % 2 === 0) return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

/** `./x`, `../y/z` biçimli göreli import'u gerçek dosyaya çözer. */
function resolveRel(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null; // paket importu — grafiğe girmez
  const base = resolve(dirname(fromFile), spec);
  for (const cand of [`${base}.ts`, join(base, "index.ts")]) {
    try {
      if (statSync(cand).isFile()) return cand;
    } catch {
      /* yok */
    }
  }
  return null;
}

/**
 * Bir dosyanın VALUE import'larını çıkarır. `import type ...` ve satır içi
 * `{ type X }` biçimleri ELENIR — derlemede silindikleri için runtime kenarı değiller.
 */
function valueImports(file: string, raw: string): string[] {
  const src = stripComments(raw);
  const out: string[] = [];
  const re = /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const clause = m[1] ?? "";
    const spec = m[2] ?? "";
    if (/^type\b/.test(clause.trim())) continue; // `import type { X } from`
    // Yalnız `{ type A, type B }` içeren clause da tip-only sayılır.
    const named = /^\{([\s\S]*)\}$/.exec(clause.trim());
    if (named) {
      const parts = named[1]!.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length > 0 && parts.every((p) => p.startsWith("type "))) continue;
    }
    const target = resolveRel(file, spec);
    if (target) out.push(target);
  }
  // `export ... from "..."` de runtime kenarıdır (tip-only olan hariç).
  const re2 = /export\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  while ((m = re2.exec(src))) {
    if (/^type\b/.test((m[1] ?? "").trim())) continue;
    const target = resolveRel(file, m[2] ?? "");
    if (target) out.push(target);
  }
  return out;
}

/** Tarjan SCC — 1'den büyük her bileşen bir döngüdür. */
function findCycles(graph: Map<string, string[]>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const strongconnect = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!idx.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      for (;;) {
        const w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
        if (w === v) break;
      }
      // Tek elemanlı bileşen yalnız KENDİNE kenarı varsa döngüdür.
      if (comp.length > 1 || (graph.get(v) ?? []).includes(v)) cycles.push(comp);
    }
  };

  for (const v of graph.keys()) if (!idx.has(v)) strongconnect(v);
  return cycles;
}

function main(): void {
  console.log("=== Import döngüsü sözleşmesi (value-only) ===\n");
  const files = walk(SRC);
  const graph = new Map<string, string[]>();
  let edgeCount = 0;
  for (const f of files) {
    const edges = valueImports(f, readFileSync(f, "utf8"));
    graph.set(f, edges);
    edgeCount += edges.length;
  }
  console.log(`  (tarandı: ${files.length} dosya · ${edgeCount} VALUE import kenarı)\n`);

  // ── Körlük zemini ─────────────────────────────────────────────────────────
  check(`körlük zemini: en az ${MIN_FILES} dosya tarandı`, files.length >= MIN_FILES, `${files.length}`);
  check(
    `körlük zemini: en az ${MIN_VALUE_EDGES} value kenarı bulundu`,
    edgeCount >= MIN_VALUE_EDGES,
    `${edgeCount} — çözücü boşa düşmüş olabilir`,
  );

  // ── 1) VALUE döngüsü YOK ──────────────────────────────────────────────────
  const cycles = findCycles(graph);
  check(
    "src/ içinde RUNTIME (value) import döngüsü YOK",
    cycles.length === 0,
    cycles.map((c) => c.map((f) => relative(SRC, f)).join(" → ")).join(" | "),
  );

  // ── 2) Tip sözleşmesi DEĞER İHRAÇ ETMİYOR ─────────────────────────────────
  // Bu kontrol 1'in GARANTİSİDİR: değer taşımayan bir modülden değer import
  // edilemeyeceği için o dosya üzerinden döngü kurmak imkânsızdır. Dosyaya bir
  // sabit/fonksiyon eklenirse garanti sessizce kalkar — bu yüzden mekanik.
  const typeFile = join(SRC, "types", "label.types.ts");
  const typeSrc = readFileSync(typeFile, "utf8");
  const valueExports = [
    ...typeSrc.matchAll(/^export\s+(?!type\b|interface\b)(const|let|var|function|class|enum|default)\b/gm),
  ].map((m) => m[1]);
  check(
    "types/label.types.ts DEĞER ihraç etmiyor (yalnız type/interface)",
    valueExports.length === 0,
    valueExports.join(", "),
  );
  check(
    "types/label.types.ts value import ETMİYOR (tip-only bağımlılık)",
    (graph.get(typeFile) ?? []).length === 0,
    (graph.get(typeFile) ?? []).map((f) => relative(SRC, f)).join(", "),
  );

  // ── 3) LabelPayload tüketicileri SERVİSE değil TİP dosyasına bağlı ─────────
  const stillOnService = files.filter(
    (f) =>
      f !== join(SRC, "services", "label.service.ts") &&
      /import type \{[^}]*LabelPayload[^}]*\} from ["'][^"']*label\.service["']/.test(
        stripComments(readFileSync(f, "utf8")),
      ),
  );
  check(
    "LabelPayload tüketicileri types/label.types'tan alıyor (label.service'ten DEĞİL)",
    stillOnService.length === 0,
    stillOnService.map((f) => relative(SRC, f)).join(", "),
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
