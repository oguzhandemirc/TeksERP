import { describe, expect, it } from "vitest";
import {
  applyOverrides,
  countOverrides,
  replaceCellValue,
  replaceListElement,
  setOverride,
  type CellOverrides,
} from "./overrides";
import { applyMapping, autoMapColumns, parseCsv } from "./parse";
import { foldSearchText } from "@/lib/search-fold";
import type { ImportColumn, ImportRowInput } from "@/services/importService";

const fold = (s: string) => foldSearchText(s);

const rows = (): ImportRowInput[] => [
  { rowNo: 2, cells: { code: "A", name: "BİR" } },
  { rowNo: 3, cells: { code: "B", name: "İKİ" } },
];

describe("elle düzeltmeler", () => {
  it("DÜZELTME YOKSA aynı dizi referansı döner — bayatlık tespiti buna dayanıyor", () => {
    const base = rows();
    expect(applyOverrides(base, {})).toBe(base);
  });

  it("düzeltme uygulanır, dokunulmayan satır referansı korunur", () => {
    const base = rows();
    const out = applyOverrides(base, { 3: { name: "ÜÇ" } });
    expect(out).not.toBe(base);
    expect(out[0]).toBe(base[0]); // 2. satıra dokunulmadı
    expect(out[1]!.cells).toEqual({ code: "B", name: "ÜÇ" });
    expect(base[1]!.cells.name).toBe("İKİ"); // kaynak bozulmadı
  });

  it("boş string geçerli bir düzeltmedir (alanı boşalt)", () => {
    const out = applyOverrides(rows(), { 2: { name: "" } });
    expect(out[0]!.cells.name).toBe("");
  });

  it("setOverride birikimlidir, mevcut düzeltmeleri ezmez", () => {
    let ov: CellOverrides = {};
    ov = setOverride(ov, 2, "name", "X");
    ov = setOverride(ov, 2, "code", "Y");
    ov = setOverride(ov, 3, "name", "Z");
    expect(ov[2]).toEqual({ name: "X", code: "Y" });
    expect(countOverrides(ov)).toBe(3);
  });

  it("DÜZELTME EŞLEME DEĞİŞİMİNİ ATLATIR — özelliğin bütün amacı bu", () => {
    // Aynı dosya, iki farklı sütun eşlemesi. Düzeltme ŞABLON anahtarına bağlı
    // olduğu için ikisinde de hayatta kalır.
    const cols: ImportColumn[] = [
      { key: "code", label: "Kod", type: "text" },
      { key: "name", label: "Ad", type: "text" },
    ];
    const parsed = parseCsv("Kod;Ad\nA;BİR\n");
    const auto = autoMapColumns(parsed, cols);
    const ov = setOverride({}, 2, "name", "DÜZELTİLDİ");

    expect(applyOverrides(applyMapping(parsed, auto), ov)[0]!.cells.name).toBe("DÜZELTİLDİ");

    // Kullanıcı eşlemeyi değiştirdi (Ad sütununu yok saydı):
    const remapped = [auto[0]!, null];
    const after = applyOverrides(applyMapping(parsed, remapped), ov);
    // ⚠️ KARARI SABİTLER: eşlemeden düşürülmüş sütunun düzeltmesi YİNE uygulanır.
    // Eşleme çıkarımdır, düzenleme NİYETtir; niyet kazanır. (Kullanıcı bunu
    // görmezden gelmesin diye arayüzde "N hücre elle düzeltildi" rozeti var.)
    expect(after[0]!.cells.name).toBe("DÜZELTİLDİ");
  });
});

describe("çoklu hücrede tek eleman değiştirme", () => {
  it("yalnız eşleşen elemanı değiştirir, diğerlerini korur", () => {
    expect(replaceListElement("RNK1; MAVI ;RNK2", "MAVI", "RNK9", fold)).toBe("RNK1;RNK9;RNK2");
  });

  it("Türkçe harf farkını eşleşme sayar", () => {
    expect(replaceListElement("RNK1;MAVİ", "mavi", "RNK9", fold)).toBe("RNK1;RNK9");
  });

  it("eşleşme yoksa metne DOKUNMAZ (sessizce eleman eklemez)", () => {
    expect(replaceListElement("RNK1;RNK2", "MAVI", "RNK9", fold)).toBe("RNK1;RNK2");
  });

  it("yalnız İLK eşleşmeyi değiştirir", () => {
    expect(replaceListElement("MAVI;MAVI", "MAVI", "RNK9", fold)).toBe("RNK9;MAVI");
  });

  it("boş hücre → yeni değer", () => {
    expect(replaceListElement("", "MAVI", "RNK9", fold)).toBe("RNK9");
  });

  it("tekil hücrede tüm değer değişir, çoklu hücrede eleman", () => {
    expect(replaceCellValue("MAVI", "MAVI", "RNK9", false, fold)).toBe("RNK9");
    expect(replaceCellValue("RNK1;MAVI", "MAVI", "RNK9", true, fold)).toBe("RNK1;RNK9");
  });

  it("virgül ve satır sonu da ayraçtır (sunucudaki splitList ile aynı küme)", () => {
    expect(replaceListElement("RNK1,MAVI", "MAVI", "RNK9", fold)).toBe("RNK1;RNK9");
    expect(replaceListElement("RNK1\nMAVI", "MAVI", "RNK9", fold)).toBe("RNK1;RNK9");
  });
});
