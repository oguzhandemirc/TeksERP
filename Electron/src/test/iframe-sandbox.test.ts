import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CANVAS_FRAME_SANDBOX } from "@/pages/Definitions/DocumentDesigner/editor/frameSandbox";

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

/**
 * GrapesJS DÜZENLEME kanvası (belge tasarımcısı, T2) AYRI SINIFTIR: DOM'unu editör yönettiği
 * için `allow-same-origin` taşır (script izni YOK); render önizlemesi ve PDF penceresi sıkı
 * kalır (D6). iframe'i paket yaratır, kaynak taraması onu göremez. İddia: `grapesjs.init(`
 * çağıran HER dosya `frameSandboxPlugin(` ve `telemetry: false` taşır (varsayılan telemetri
 * app.grapesjs.com'a gider, panel CSP'si engellemez); paket yalnız DocumentDesigner/ altında.
 * Çalışma anı ölçümü jsdom'da değil e2e'de: `e2e/guzergah/adimlar-belge-tasarimci.mjs` BT2/BT4.
 */
const GRAPES_DIR = "src/pages/Definitions/DocumentDesigner/";
function grapesViolations(list: ReadonlyArray<{ file: string; src: string }>): string[] {
  const out: string[] = [];
  for (const { file, src: raw } of list) {
    // Yorumdaki `grapesjs.init(` anması kurulum değildir.
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (/^import\s+(?!type\b)[^;]*from\s+"grapesjs"/m.test(src) && !file.startsWith(GRAPES_DIR)) {
      out.push(`${file}: grapesjs DocumentDesigner dışında`);
    }
    if (!/\bgrapesjs\.init\(/.test(src)) continue;
    if (!/\bframeSandboxPlugin\(/.test(src)) out.push(`${file}: kanvas sandbox eklentisi YOK`);
    if (!/\btelemetry:\s*false\b/.test(src)) out.push(`${file}: telemetry:false YOK`);
  }
  return out;
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

  it("körlük zemini: GrapesJS kurulumu bulundu", () => {
    expect(files.filter((f) => /\bgrapesjs\.init\(/.test(f.src)).length).toBeGreaterThanOrEqual(1);
  });

  it("⭐ GrapesJS kanvas çerçevesi sandbox'lı; izin allow-same-origin (script YOK)", () => {
    expect(grapesViolations(files)).toEqual([]);
    expect(CANVAS_FRAME_SANDBOX).toBe("allow-same-origin");
    expect(violations([{ where: "frameSandbox.ts", sandbox: CANVAS_FRAME_SANDBOX }])).toEqual([]);
  });

  it("K-sonda: eklentisiz / telemetrisi açık GrapesJS kurulumu ve dizin dışı import GÖRÜLÜR", () => {
    const fake = [
      { file: `${GRAPES_DIR}editor/x.ts`, src: `import grapesjs from "grapesjs";\nexport const e = grapesjs.init({ plugins: [] });` },
      { file: "src/pages/Baska/y.ts", src: `import grapesjs from "grapesjs";` },
      { file: "src/pages/Baska/z.ts", src: `import type { Editor } from "grapesjs";` },
      { file: `${GRAPES_DIR}editor/t.ts`, src: `const c = { telemetry: true };\nframeSandboxPlugin();\ngrapesjs.init(c);` },
    ];
    expect(grapesViolations(fake)).toEqual([
      `${GRAPES_DIR}editor/x.ts: kanvas sandbox eklentisi YOK`,
      `${GRAPES_DIR}editor/x.ts: telemetry:false YOK`,
      "src/pages/Baska/y.ts: grapesjs DocumentDesigner dışında",
      `${GRAPES_DIR}editor/t.ts: telemetry:false YOK`,
    ]);
  });

  it("K-sonda: tarayıcı sandbox'sız ve fazla yetkili iframe'i GÖRÜR", () => {
    const fake = `<div>{x ? (<iframe title="a" srcDoc={html} className="h" />) : null}<iframe sandbox="allow-scripts allow-same-origin" /></div>`;
    expect(violations(jsxIframes("sahte.tsx", fake))).toEqual(["sahte.tsx:1: sandbox YOK", "sahte.tsx:1: yasak izin allow-scripts"]);
    const fakeDom = `const f = document.createElement("iframe");`;
    expect(violations(domIframes("sahte.ts", fakeDom))).toEqual(["sahte.ts#dom1: sandbox YOK"]);
  });
});
