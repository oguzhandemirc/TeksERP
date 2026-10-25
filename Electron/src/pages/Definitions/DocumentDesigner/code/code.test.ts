import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFixture } from "../binding/testContract";
import { hasRawLiquidTag, isCodeEditable, visualReturnBlocker } from "./editMode";
import { issueLabel, issueOffset, issueRange } from "./issueDiagnostics";
import { LIQUID_TAGS, buildCompletionModel, liquidCompletions, openLoops } from "./liquidCompletion";

const MOTOR = resolve(__dirname, "../../../../../../Teks-Erp/src/services/document-template/motor");
const { contract } = loadFixture();
const model = buildCompletionModel(contract, []);

/** Backend kaynağından dize dizisi okur (elle kopya yok: liste değişirse bu test kırmızı). */
function backendList(file: string, name: string): string[] {
  const src = readFileSync(resolve(MOTOR, file), "utf8");
  const m = new RegExp(`export const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\];`).exec(src);
  if (!m) throw new Error(`${name} bulunamadı`);
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}
function backendKeys(file: string, name: string): string[] {
  const src = readFileSync(resolve(MOTOR, file), "utf8");
  const m = new RegExp(`export const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`).exec(src);
  if (!m) throw new Error(`${name} bulunamadı`);
  return [...m[1]!.matchAll(/^\s{2}"?([a-z_#]+)"?\s*:/gm)].map((x) => x[1]!);
}

describe("Liquid tamamlaması — sözleşmeden", () => {
  it("değişken önerileri sözleşme köklerinden ve tablolarından gelir", () => {
    const r = liquidCompletions("<p>{{ belge.", model);
    expect(r?.kind).toBe("variable");
    const labels = r!.options.map((o) => o.label);
    for (const f of contract.kokler.filter((k) => k.sinif === "musteri")) expect(labels).toContain(f.yol);
    for (const t of contract.tablolar) expect(labels).toContain(`tablolar.${t.anahtar}`);
    expect(r!.from).toBe("<p>{{ ".length);
  });

  it("kilitli iç alan önerilmez; opt-in sonrası önerilir", () => {
    const ic = contract.kokler.find((k) => k.sinif === "ic");
    if (!ic) return;
    expect(model.variables.map((v) => v.label)).not.toContain(ic.yol);
    const open = buildCompletionModel(contract, [ic.icKod ?? ic.yol]);
    expect(open.variables.map((v) => v.label)).toContain(ic.yol);
  });

  it("açık döngüde satır değişkeni kolonlarla önerilir; endfor sonrası düşer", () => {
    const t = contract.tablolar.find((x) => x.kolonlar.length > 1)!;
    const before = `{% for s in tablolar.${t.anahtar} %}<td>{{ s.`;
    expect(openLoops(before).get("s")).toBe(t.anahtar);
    const labels = liquidCompletions(before, model)!.options.map((o) => o.label);
    expect(labels).toContain(`s.${t.kolonlar[0]!.yol}`);
    const closed = liquidCompletions(`${before}x }}{% endfor %}{{ `, model)!.options.map((o) => o.label);
    expect(closed.some((l) => l.startsWith("s."))).toBe(false);
  });

  it("boru sonrası yalnız izinli filtreler; reddedilen filtre (date, plus…) ÖNERİLMEZ", () => {
    const r = liquidCompletions("{{ belge.tarih | ta", model)!;
    expect(r.kind).toBe("filter");
    expect(r.from).toBe("{{ belge.tarih | ".length);
    const labels = r.options.map((o) => o.label);
    const allowed = new Set([...backendList("filtreler.ts", "ALLOWED_BUILTIN_FILTERS"), ...backendKeys("filtreler.ts", "CUSTOM_FILTERS")]);
    for (const l of labels) expect(allowed.has(l), l).toBe(true);
    const rejected = backendKeys("filtreler.ts", "REJECTED_FILTERS");
    expect(rejected.length).toBeGreaterThan(3);
    for (const bad of rejected) expect(labels).not.toContain(bad);
  });

  it("etiket önerileri izinli etiket kümesinin alt kümesi; include/render önerilmez", () => {
    const r = liquidCompletions("{% ", model)!;
    expect(r.kind).toBe("tag");
    const allowed = new Set(backendList("liquid.ts", "ALLOWED_TAGS"));
    const closers = new Set(["elsif", "else", "when"]);
    for (const t of LIQUID_TAGS) expect(allowed.has(t) || closers.has(t) || (t.startsWith("end") && allowed.has(t.slice(3))), t).toBe(true);
    const rejectedTags = backendKeys("liquid.ts", "REJECTED_TAGS");
    expect(rejectedTags).toContain("include");
    for (const bad of rejectedTags) expect(LIQUID_TAGS).not.toContain(bad);
  });

  it("Liquid bloğu dışında öneri yok (düz HTML)", () => {
    expect(liquidCompletions("<p>{{ a }} metin", model)).toBeNull();
    expect(liquidCompletions("<div class=", model)).toBeNull();
  });
});

describe("sunucu hata eşlemesi (satır/sütun → aralık)", () => {
  const text = "<p>\n  {{ belge.no | tarihx }}\n</p>";
  it("1 tabanlı satır/sütun ofsete çevrilir", () => {
    expect(issueOffset(text, 2, 3)).toBe(text.indexOf("{{"));
    expect(issueOffset(text, 1, 1)).toBe(0);
  });
  it("aralık etiketi kapsar, satırı aşmaz", () => {
    const r = issueRange(text, { satir: 2, sutun: 3, mesaj: "Bilinmeyen filtre" });
    expect(text.slice(r.from, r.to)).toBe("{{ belge.no | tarihx }}");
    expect(r.message).toBe("Bilinmeyen filtre");
  });
  it("taşan konum kenara kısılır; konumsuz hata başa düşer", () => {
    expect(issueOffset(text, 99, 1)).toBe(text.length);
    expect(issueOffset(text, 1, 99)).toBe(3);
    expect(issueOffset(text, null, null)).toBe(0);
    expect(issueRange("", { satir: 1, sutun: 1, mesaj: "x" })).toEqual({ from: 0, to: 0, message: "x" });
  });
  it("şerit etiketi Türkçe", () => {
    expect(issueLabel({ satir: 2, sutun: 3, mesaj: "Hata" })).toBe("Satır 2, sütun 3 — Hata");
    expect(issueLabel({ satir: null, sutun: null, mesaj: "Hata" })).toBe("Hata");
  });
});

describe("kod ↔ görsel geçiş kilidi", () => {
  it("görsel kipte kod salt-okunur, kod kipinde düzenlenebilir", () => {
    expect(isCodeEditable("VISUAL")).toBe(false);
    expect(isCodeEditable("CODE")).toBe(true);
  });
  it("ham {% %} varken görsele dönülemez (satır gerekçeli); data-* yönergeleri engel değil", () => {
    expect(visualReturnBlocker('<tr data-each="satir in tablolar.urun"><td data-alan="satir.metre">1</td></tr>')).toBeNull();
    expect(visualReturnBlocker("<p>{{ belge.no }}</p>")).toBeNull();
    const html = "<p>a</p>\n{%- if belge.no -%}x{% endif %}";
    expect(hasRawLiquidTag(html)).toBe(true);
    expect(visualReturnBlocker(html)).toContain("satır 2");
  });
});

describe("istemci Liquid ÇALIŞTIRMAZ (önizleme yalnız sunucudan)", () => {
  it("panel kaynağında Liquid motoru import'u yok", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const root = resolve(__dirname, "../../../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = resolve(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) {
          if (/(from\s+|import\(\s*|require\(\s*)["'](liquidjs|liquid|tinyliquid|@shopify\/liquid[^"']*)["']/.test(readFileSync(p, "utf8"))) hits.push(p);
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
