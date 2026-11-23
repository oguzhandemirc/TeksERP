// Bekçi: index.css'te yorum içindeki erken "*/" (ör. `--space-*/--control-h`) yorumu keser; kalan metin
// seçici sanılır, ardındaki kural (.app-bg) yutulur ve derleme sonundaki `@property --tw-translate-x`
// kaydı başıboş ";" ile düşer → bütün `translate-*` sınıfları ölür (arama büyüteci kayması, 2026-11-23).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";

const raw = readFileSync(resolve(process.cwd(), "src/index.css"), "utf-8");

describe("index.css ayrıştırma bütünlüğü", () => {
  it("hiçbir seçici yorum kalıntısı taşımaz", () => {
    const bad: string[] = [];
    postcss.parse(raw).walkRules((r) => {
      if (/\*\/|`|→/.test(r.selector)) bad.push(r.selector.slice(0, 80));
    });
    expect(bad).toEqual([]);
  });

  it("yorum gövdesinde ikinci bir '*/' yoktur", () => {
    const comments = raw.match(/\/\*[\s\S]*?\*\//g) ?? [];
    const stripped = comments.reduce((s, c) => s.replace(c, ""), raw);
    expect(stripped.includes("*/")).toBe(false);
  });
});
