// =============================================================================
// Panel testi: PUNTO / KALINLIK ve ölçü ayrıştırma
// =============================================================================
// `docRows.test.ts`ten AYRILDI (dosya boyutu tavanı). Bölme ekseni SORU: orada
// satırın VAR OLUP OLMADIĞI ve görünürlüğü, burada satırın STİLİ.
//
// ⚠️ Korunan sözleşme: boş punto kutusu anahtarı SİLER (0 yazmaz) — "0 punto"
// belgede görünmez metin demektir ve kullanıcı bunu kastetmez.
// =============================================================================

import { describe, expect, it } from "vitest";
import { parseDocSize } from "./docRows";
import { type DocumentConfig } from "@/services/documentConfig";
import { FASON, allRows, read, rowById, write } from "./docRows.testkit";

describe("punto ve kalınlık", () => {
  const row = () => rowById(FASON, "f:gridMetre");

  it("punto fields'a yazılır", () => {
    expect(write("fasonSevk", {}, row(), { size: 14 }).fields?.gridMetre).toEqual({ size: 14 });
  });
  it("boş punto anahtarı SİLER, 0 yazmaz", () => {
    const cfg: DocumentConfig = { fields: { gridMetre: { size: 14 } } };
    expect(write("fasonSevk", cfg, row(), { size: null }).fields?.gridMetre).toBeUndefined();
  });
  it("kalınlık puntoyu korur", () => {
    const cfg: DocumentConfig = { fields: { gridMetre: { size: 14 } } };
    const out = write("fasonSevk", cfg, row(), { weight: "bold" });
    expect(out.fields?.gridMetre).toEqual({ size: 14, weight: "bold" });
  });
  // ⚠️ Komşu GERÇEK bir alan olmalı. Eskiden burada `gridCm` yazıyordu; o alan
  // 2026-08-06'da kaldırıldı (grid'de EN sütunu yok) ve kontrol sessizce
  // BOŞA DÖNDÜ — var olmayan anahtar her koşulda undefined'dır.
  it("komşu alana dokunmaz — metre ↔ top sıra no ayrı kalır", () => {
    const out = write("fasonSevk", {}, row(), { size: 14 });
    expect(out.fields?.gridTop).toBeUndefined();
    expect(out.fields?.gridMetre).toEqual({ size: 14 });
  });
  it("stil taşımayan satırda punto girdisi çizilmez", () => {
    const secOnly = allRows(FASON).find((r) => r.section && !r.field);
    expect(secOnly).toBeDefined();
    expect(read("fasonSevk", {}, secOnly!).canStyle).toBe(false);
  });
  it("kaynağı MUTATE etmez (React state güvenliği)", () => {
    const cfg: DocumentConfig = { fields: { gridMetre: { size: 14 } } };
    write("fasonSevk", cfg, row(), { size: 20 });
    expect(cfg.fields?.gridMetre).toEqual({ size: 14 });
  });
});

describe("parseDocSize", () => {
  it("boş/anlamsız → null", () => {
    expect(parseDocSize("", 5, 48)).toBeNull();
    expect(parseDocSize("abc", 5, 48)).toBeNull();
  });
  it("sınırlara kırpar, virgüllü ondalık kabul eder", () => {
    expect(parseDocSize("999", 5, 48)).toBe(48);
    expect(parseDocSize("1", 5, 48)).toBe(5);
    expect(parseDocSize("10,5", 5, 48)).toBe(10.5);
  });
});
