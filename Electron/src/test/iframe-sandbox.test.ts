import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// =============================================================================
// ÖNİZLEME/BASKI İFRAME'LERİ (güvenlik denetimi 2026-10-01, IST-5 — "7 iframe sandbox'sız").
// İddia: renderer'daki HER iframe `sandbox` taşır ve yetkileri en çok
// `allow-same-origin allow-modals` (doc.write + print için); `allow-scripts`,
// `allow-top-navigation*`, `allow-popups*` HİÇBİRİNDE yok. Kaynak taraması (JSX + DOM API).
// KALICI SONDA (K): tarayıcı, sandbox'sız sabit JSX'i ve yasak izni GÖRÜR.
// =============================================================================

const ALLOWED_TOKENS = new Set(["allow-same-origin", "allow-modals"]);

interface IframeFinding {
  readonly where: string;
  readonly sandbox: string | null;
}

/** JSX `<iframe …>` açılış etiketlerini (süslü parantez derinliğiyle) çıkarır. */
function jsxIframes(file: string, src: string): IframeFinding[] {
  const found: IframeFinding[] = [];
  for (const m of src.matchAll(/<iframe\b/g)) {
    let depth = 0;
    let i = m.index ?? 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    const tag = src.slice(m.index, i + 1);
    const sb = /\bsandbox="([^"]*)"/.exec(tag);
    found.push({ where: `${file}:${src.slice(0, m.index).split("\n").length}`, sandbox: sb ? (sb[1] ?? "") : null });
  }
  return found;
}

/** `createElement("iframe")` kullanan dosyada sandbox `setAttribute` ile verilmeli. */
function domIframes(file: string, src: string): IframeFinding[] {
  if (!src.includes('createElement("iframe")')) return [];
  const sets = [...src.matchAll(/setAttribute\("sandbox",\s*"([^"]*)"\)/g)].map((m) => m[1] ?? "");
  const creations = src.match(/createElement\("iframe"\)/g)?.length ?? 0;
  return Array.from({ length: creations }, (_, k) => ({ where: `${file}#dom${k + 1}`, sandbox: sets[k] ?? null }));
}

function violations(list: IframeFinding[]): string[] {
  return list.flatMap((f) => {
    if (f.sandbox === null) return [`${f.where}: sandbox YOK`];
    const bad = f.sandbox.split(/\s+/).filter((t) => t && !ALLOWED_TOKENS.has(t));
    return bad.length ? [`${f.where}: yasak izin ${bad.join(",")}`] : [];
  });
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [p] : [];
  });
}

const root = process.cwd();
const files = walk(resolve(root, "src")).map((abs) => ({ file: relative(root, abs), src: readFileSync(abs, "utf8") }));
const jsx = files.filter((f) => f.file.endsWith(".tsx")).flatMap((f) => jsxIframes(f.file, f.src));
const dom = files.flatMap((f) => domIframes(f.file, f.src));

describe("iframe sandbox", () => {
  it("körlük zemini: taranan iframe sayısı", () => {
    expect(jsx.length).toBeGreaterThanOrEqual(17);
    expect(dom.length).toBeGreaterThanOrEqual(2);
  });

  it("⭐ her iframe sandbox'lı; izinler en çok allow-same-origin + allow-modals", () => {
    expect(violations([...jsx, ...dom])).toEqual([]);
  });

  it("K-sonda: tarayıcı sandbox'sız ve fazla yetkili iframe'i GÖRÜR", () => {
    const fake = `<div>{x ? (<iframe title="a" srcDoc={html} className="h" />) : null}<iframe sandbox="allow-scripts allow-same-origin" /></div>`;
    expect(violations(jsxIframes("sahte.tsx", fake))).toEqual(["sahte.tsx:1: sandbox YOK", "sahte.tsx:1: yasak izin allow-scripts"]);
    const fakeDom = `const f = document.createElement("iframe");`;
    expect(violations(domIframes("sahte.ts", fakeDom))).toEqual(["sahte.ts#dom1: sandbox YOK"]);
  });
});
