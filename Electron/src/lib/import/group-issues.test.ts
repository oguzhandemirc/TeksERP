import { describe, expect, it } from "vitest";
import { formatRowNos, groupIssues, issueClass, issueValue } from "./group-issues";
import type { ImportRowResult } from "@/services/importService";

const row = (
  rowNo: number,
  errors: Array<{ column?: string; message: string }> = [],
  warnings: Array<{ column?: string; message: string }> = [],
): ImportRowResult => ({ rowNo, action: errors.length ? "ERROR" : "CREATE", errors, warnings });

describe("sorun sınıflandırma", () => {
  it("tırnaklı DEĞERİ maskeler — aynı sorun tek sınıf olur", () => {
    const a = issueClass("'MAVI' ile eşleşen renk bulunamadı (kod ya da tam ad yazın).");
    const b = issueClass("'KIRMIZI' ile eşleşen renk bulunamadı (kod ya da tam ad yazın).");
    expect(a).toBe(b);
  });

  it("satır numarasını maskeler", () => {
    expect(issueClass("Bu anahtar dosyada 14. satırda da var")).toBe(
      issueClass("Bu anahtar dosyada 7. satırda da var"),
    );
  });

  it("FARKLI sorunları birleştirmez", () => {
    expect(issueClass("'X' rengi bulunamadı")).not.toBe(issueClass("'X' kumaşı bulunamadı"));
  });

  it("değeri geri okuyabilir", () => {
    expect(issueValue("'MAVI' ile eşleşen renk bulunamadı")).toBe("MAVI");
    expect(issueValue("Miktar zorunlu")).toBeNull();
  });
});

describe("gruplama", () => {
  it("aynı sınıftaki satırları toplar ve farklı değerleri listeler", () => {
    const groups = groupIssues([
      row(2, [{ column: "colorCode", message: "'MAVI' ile eşleşen renk bulunamadı" }]),
      row(3, [{ column: "colorCode", message: "'KIRMIZI' ile eşleşen renk bulunamadı" }]),
      row(4, [{ column: "colorCode", message: "'MAVI' ile eşleşen renk bulunamadı" }]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rowNos).toEqual([2, 3, 4]);
    expect(groups[0]!.values).toEqual(["MAVI", "KIRMIZI"]);
  });

  it("en çok satır etkileyen sınıf ÖNCE gelir", () => {
    const groups = groupIssues([
      row(2, [{ message: "'A' bulunamadı" }]),
      row(3, [{ message: "Miktar zorunlu" }]),
      row(4, [{ message: "Miktar zorunlu" }]),
      row(5, [{ message: "Miktar zorunlu" }]),
    ]);
    expect(groups[0]!.rowNos).toHaveLength(3);
  });

  it("HATALAR uyarılardan önce gelir (yüklemeyi durduran şey önce okunmalı)", () => {
    const groups = groupIssues([
      row(2, [], [{ message: "'A' kod olarak bulunamadı, AD ile eşleşti" }]),
      row(3, [], [{ message: "'B' kod olarak bulunamadı, AD ile eşleşti" }]),
      row(4, [{ message: "Miktar zorunlu" }]),
    ]);
    expect(groups[0]!.kind).toBe("error");
    expect(groups[1]!.kind).toBe("warning");
  });

  it("aynı satırdaki AYNI sınIF iki kez sayılmaz", () => {
    // İki referans sütunu da aynı sınıf hatayı verirse satır bir kez sayılmalı —
    // yoksa "12 satırda sorun var" gerçekte 7 satır olur ve sayı güven kaybeder.
    const groups = groupIssues([
      row(2, [
        { column: "a", message: "'X' bulunamadı" },
        { column: "a", message: "'Y' bulunamadı" },
      ]),
    ]);
    expect(groups[0]!.rowNos).toEqual([2]);
    expect(groups[0]!.values).toEqual(["X", "Y"]);
  });

  it("sorunsuz satırlar grup üretmez", () => {
    expect(groupIssues([row(2), row(3)])).toEqual([]);
  });
});

describe("satır listesi biçimi", () => {
  it("uzun listeyi kısaltır", () => {
    expect(formatRowNos([1, 2, 3], 8)).toBe("1, 2, 3");
    expect(formatRowNos([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 8)).toBe("1, 2, 3, 4, 5, 6, 7, 8 … (+2)");
  });
});
