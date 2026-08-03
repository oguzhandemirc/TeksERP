// Etiket Stüdyosu — koşullu basım düzenleme kuralları
// REGRESYON (2026-08-02): mod seçimi elemana HEMEN yazılıyordu → `values: []` ile
// geçersiz koşul doğuyor, canlı önizleme backend'ten 400 alıyordu
// ("showIf.values en az 1 değer içermeli"). Kullanıcı hiçbir hata yapmadan kırmızı
// görüyordu. Kural: yarım koşul elemana ASLA yazılmaz.
import { describe, expect, it } from "vitest";
import { editMode, editValue } from "./condition-edit";
import type { ElementCondition } from "@/types/label-canvas";

const A1: ElementCondition = { field: "qualityGrade", op: "in", values: ["A1"] };

describe("editMode", () => {
  it("koşulsuz elemanda mod seçimi ELEMANA YAZILMAZ (boş values 400 veriyordu)", () => {
    const e = editMode(undefined, "in");
    expect(e.showIf).toBeNull(); // null = elemana dokunma
    expect(e.pending).toBe("in"); // panel modu açık kalır
  });

  it("koşul varsa yön değişir ve SEÇİM KORUNUR", () => {
    const e = editMode(A1, "notIn");
    expect(e.showIf).toEqual({ field: "qualityGrade", op: "notIn", values: ["A1"] });
    expect(e.pending).toBeNull();
  });

  it("'Her zaman bas' koşulu kaldırır; zaten koşulsuzsa elemana dokunmaz", () => {
    expect(editMode(A1, "always")).toEqual({ showIf: undefined, pending: null });
    expect(editMode(undefined, "always")).toEqual({ showIf: null, pending: null });
  });
});

describe("editValue", () => {
  it("ilk kalite işaretlenince koşul KURULUR (bekleyen mod uygulanır)", () => {
    const e = editValue(undefined, "notIn", "FIRE", true);
    expect(e.showIf).toEqual({ field: "qualityGrade", op: "notIn", values: ["FIRE"] });
    expect(e.pending).toBeNull();
  });

  it("mod hâlâ 'always' iken işaretleme 'in' olarak kurulur", () => {
    expect(editValue(undefined, "always", "A1", true).showIf).toEqual({
      field: "qualityGrade", op: "in", values: ["A1"],
    });
  });

  it("ikinci kalite eklenir, mükerrer yazılmaz", () => {
    expect(editValue(A1, "in", "FIRE", true).showIf).toEqual({
      field: "qualityGrade", op: "in", values: ["A1", "FIRE"],
    });
    expect(editValue(A1, "in", "A1", true).showIf).toEqual({
      field: "qualityGrade", op: "in", values: ["A1"],
    });
  });

  it("son kutucuk kalkınca koşul SİLİNİR ama panel modu korunur", () => {
    const e = editValue(A1, "in", "A1", false);
    expect(e.showIf).toBeUndefined(); // koşulu kaldır
    expect(e.pending).toBe("in"); // liste kapanmasın, kullanıcı yeniden seçebilsin
  });

  it("hiçbir üretilen koşul BOŞ values taşımaz (backend sözleşmesi)", () => {
    const produced = [
      editMode(undefined, "in"), editMode(A1, "notIn"), editMode(A1, "always"),
      editValue(undefined, "in", "A1", true), editValue(A1, "in", "A1", false),
    ];
    for (const e of produced) {
      if (e.showIf) expect(e.showIf.values.length).toBeGreaterThan(0);
    }
  });
});
