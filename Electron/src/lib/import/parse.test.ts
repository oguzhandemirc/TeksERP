import { describe, expect, it } from "vitest";
import { mapRows, parseCsv } from "./parse";
import type { ImportColumn } from "@/services/importService";

// =============================================================================
// DOSYA AYRIŞTIRMA — ayraç tespiti, tırnak, başlık eşleme
// =============================================================================
// ⚠️ Buradaki hatalar SESSİZDİR: yanlış ayraçta tüm satır tek hücreye düşer ve
// "zorunlu sütun yok" hatası kullanıcıya dosyasının bozuk olduğunu düşündürür;
// eşleşmeyen başlık ise sütunu sessizce düşürür (yükledim ama alan boş kaldı).

const COLUMNS: ImportColumn[] = [
  { key: "code", label: "Renk Kodu", type: "text" },
  { key: "name", label: "Renk Adı", type: "text", required: true },
  { key: "hex", label: "Renk Kodu (HEX)", type: "text" },
];

describe("CSV ayrıştırma", () => {
  it("noktalı virgül ayracını tespit eder (bizim CSV çıktımız)", () => {
    const out = parseCsv("Renk Kodu;Renk Adı\r\nRNK1;LACİVERT\r\n");
    expect(out.headers).toEqual(["Renk Kodu", "Renk Adı"]);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.cells).toEqual(["RNK1", "LACİVERT"]);
  });

  it("virgül ayracını da tespit eder (müşteri dosyası)", () => {
    const out = parseCsv("Renk Kodu,Renk Adı\nRNK1,LACİVERT\n");
    expect(out.rows[0]!.cells).toEqual(["RNK1", "LACİVERT"]);
  });

  it("BOM'u atar — ilk başlık bozulmaz", () => {
    const out = parseCsv("﻿Renk Kodu;Renk Adı\nRNK1;A\n");
    expect(out.headers[0]).toBe("Renk Kodu");
  });

  it("tırnak içindeki ayraç ve satır sonu hücreyi bölmez", () => {
    const out = parseCsv('Ad;Not\n"A;B";"iki\nsatır"\n');
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.cells).toEqual(["A;B", "iki\nsatır"]);
  });

  it("ikilenmiş tırnak tek tırnağa iner", () => {
    const out = parseCsv('Ad\n"de""me"\n');
    expect(out.rows[0]!.cells[0]).toBe('de"me');
  });

  it("satır numarası DOSYADAKİ numaradır (başlık 1 → ilk veri 2)", () => {
    const out = parseCsv("Ad\nA\nB\n");
    expect(out.rows.map((r) => r.rowNo)).toEqual([2, 3]);
  });

  it("tamamen boş satırlar atlanır (Excel'in kuyruk satırları)", () => {
    const out = parseCsv("Ad;Not\nA;1\n;\n\nB;2\n");
    expect(out.rows.map((r) => r.cells[0])).toEqual(["A", "B"]);
  });
});

describe("başlık eşleme", () => {
  it("Türkçe harf farkını yok sayar (İ/ı, Ş, Ğ…)", () => {
    const parsed = parseCsv("RENK KODU;RENK ADI\nRNK1;A\n");
    const mapped = mapRows(parsed, COLUMNS);
    expect(mapped.rows[0]!.cells).toEqual({ code: "RNK1", name: "A" });
    expect(mapped.unmatchedHeaders).toEqual([]);
  });

  it("sütun ANAHTARI da kabul edilir (ham dışa aktarım dosyası geri yüklenebilsin)", () => {
    const parsed = parseCsv("code;name\nRNK1;A\n");
    const mapped = mapRows(parsed, COLUMNS);
    expect(mapped.rows[0]!.cells).toEqual({ code: "RNK1", name: "A" });
  });

  it("tanınmayan başlık SESSİZCE düşmez — listelenir", () => {
    const parsed = parseCsv("Renk Adı;Uydurma Sütun\nA;X\n");
    const mapped = mapRows(parsed, COLUMNS);
    expect(mapped.unmatchedHeaders).toEqual(["Uydurma Sütun"]);
    expect(mapped.rows[0]!.cells).toEqual({ name: "A" });
  });

  it("eksik ZORUNLU sütun bildirilir", () => {
    const parsed = parseCsv("Renk Kodu\nRNK1\n");
    const mapped = mapRows(parsed, COLUMNS);
    expect(mapped.missingRequired.map((c) => c.key)).toEqual(["name"]);
  });

  it("benzer iki başlık karışmaz ('Renk Kodu' ile 'Renk Kodu (HEX)')", () => {
    const parsed = parseCsv("Renk Kodu;Renk Kodu (HEX)\nRNK1;#112233\n");
    const mapped = mapRows(parsed, COLUMNS);
    expect(mapped.rows[0]!.cells).toEqual({ code: "RNK1", hex: "#112233" });
  });

  it("boş hücre gönderilir (sunucu 'dokunma' olarak yorumlar) ama satır düşmez", () => {
    const parsed = parseCsv("Renk Kodu;Renk Adı\n;A\n");
    const mapped = mapRows(parsed, COLUMNS);
    expect(mapped.rows[0]!.cells).toEqual({ code: "", name: "A" });
  });
});
