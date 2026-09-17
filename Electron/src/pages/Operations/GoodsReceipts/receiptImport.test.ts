import { describe, expect, it } from "vitest";
import { parseReceiptRows, type ImportCatalogs } from "./receiptImport";

const catalogs: ImportCatalogs = {
  items: [
    { id: "i1", code: "KMS-000001", name: "Patos" },
    { id: "i2", code: "KMS-000002", name: "İkiz" },
    { id: "i3", code: "KMS-000003", name: "İkiz" }, // aynı ADLI ikinci kumaş
    { id: "y1", code: "IPL-000001", name: "Penye İplik", yarn: true }, // Sınıf 5
  ],
  colors: [{ id: "c1", code: "RNK-1", name: "Gri" }],
  folds: [{ code: "4-KAT", name: "4 Kat" }],
};

const row = (o: Record<string, unknown>) => ({ "Kumaş Kodu": "KMS-000001", Metre: 500, ...o });

/** Dizinin n. elemanı — yoksa testi ANLAMLI mesajla düşürür (indeks tipi susturma değil). */
function at<T>(arr: T[], n: number): T {
  if (arr.length <= n) throw new Error(`Beklenen ${n + 1}. eleman yok (uzunluk ${arr.length})`);
  return arr[n] as T;
}

describe("mal kabul Excel ayrıştırma", () => {
  it("kodla eşleşir, adet kadar top sayar", () => {
    const r = parseReceiptRows([row({ Adet: 20, "En (cm)": 250, Renk: "Gri" })], catalogs);
    expect(r.errors).toEqual([]);
    expect(r.lines).toHaveLength(1);
    expect(at(r.lines, 0)).toMatchObject({ itemId: "i1", colorId: "c1", initialQty: 500, width: 250, count: 20 });
  });

  it("adet boşsa 1 kabul edilir", () => {
    expect(at(parseReceiptRows([row({})], catalogs).lines, 0).count).toBe(1);
  });

  it("kod boşsa ada düşer", () => {
    const r = parseReceiptRows([{ "Kumaş Adı": "patos", Metre: 100 }], catalogs);
    expect(at(r.lines, 0).itemId).toBe("i1");
  });

  // ⚠️ EN KRİTİK KURAL: belirsiz ad TAHMİN EDİLMEZ. Bu satır düşerse
  // ayrıştırıcı iki kumaştan birini rastgele seçer ve mal YANLIŞ kumaşa yazılır.
  it("aynı adı taşıyan iki kumaş varsa satırı REDDEDER", () => {
    const r = parseReceiptRows([{ "Kumaş Adı": "İkiz", Metre: 100 }], catalogs);
    expect(r.lines).toHaveLength(0);
    expect(at(r.errors, 0).reason).toContain("2 kumaş");
  });

  it("bulunamayan kumaş/renk/kat satırı sebebiyle raporlanır — sessizce atlanmaz", () => {
    const r = parseReceiptRows(
      [
        { "Kumaş Kodu": "YOK-1", Metre: 100 },
        row({ Renk: "Mor" }),
        row({ Kat: "6-KAT" }),
      ],
      catalogs,
    );
    expect(r.lines).toHaveLength(0);
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(at(r.errors, 0).reason).toContain("Kumaş bulunamadı");
    expect(at(r.errors, 1).reason).toContain("Renk bulunamadı");
    expect(at(r.errors, 2).reason).toContain("Kat kataloğunda yok");
  });

  it("kat adıyla da yazılabilir, DEĞER kanonik koda çevrilir", () => {
    expect(at(parseReceiptRows([row({ Kat: "4 kat" })], catalogs).lines, 0).foldType).toBe("4-KAT");
  });

  it("metre geçersizse reddeder", () => {
    const r = parseReceiptRows([row({ Metre: 0 }), row({ Metre: "abc" })], catalogs);
    expect(r.lines).toHaveLength(0);
    expect(r.errors).toHaveLength(2);
  });

  it("Türkçe ondalık ayırıcıyı okur", () => {
    expect(at(parseReceiptRows([row({ Metre: "1.250,5" })], catalogs).lines, 0).initialQty).toBe(1250.5);
  });

  it("tamamen boş satır hata DEĞİLDİR (dosya sonu dolgusu)", () => {
    const r = parseReceiptRows([{}, { Renk: "" }], catalogs);
    expect(r.lines).toHaveLength(0);
    expect(r.errors).toHaveLength(0);
  });

  it("geçerli ve geçersiz satırlar KARIŞIK gelince geçerliler yüklenir", () => {
    const r = parseReceiptRows([row({ Adet: 3 }), { "Kumaş Kodu": "YOK", Metre: 5 }], catalogs);
    expect(r.lines).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(at(r.errors, 0).row).toBe(3);
  });

  // ── Sınıf 5: iplik kalemi (yarn: true) ─────────────────────────────────────

  it("iplik satırı yüklenir — Metre kolonu KG'dir, kumaş alanları null doğar", () => {
    const r = parseReceiptRows([{ "Kumaş Kodu": "IPL-000001", Metre: 500, Adet: 2, "Birim Fiyat": 4 }], catalogs);
    expect(r.errors).toEqual([]);
    expect(at(r.lines, 0)).toMatchObject({
      itemId: "y1", initialQty: 500, count: 2, unitPrice: 4,
      colorId: null, width: null, weightKg: null, foldType: null,
    });
  });

  // ⚠️ Kural ①'in alan ölçeği: iplik satırındaki Renk/En/Kg/Kat sessizce
  // DÜŞÜRÜLMEZ — satır sebebiyle reddedilir ("renk yazdım, kayboldu" olmaz).
  it("iplik satırında Renk/En/Kg/Kat doluysa satırı SEBEBİYLE reddeder", () => {
    const r = parseReceiptRows(
      [{ "Kumaş Kodu": "IPL-000001", Metre: 500, Renk: "Gri", "En (cm)": 250, Kat: "4 Kat" }],
      catalogs,
    );
    expect(r.lines).toHaveLength(0);
    expect(at(r.errors, 0).reason).toContain("İplik kalemi");
    expect(at(r.errors, 0).reason).toContain("Renk/En/Kat");
  });

  // EK 7: "Sınıf" kolonu opsiyonel — satır bazlı top sınıfı üçlü; boş = Bitmiş.
  it("Sınıf kolonu: Ham/Yarı mamul/Bitmiş/boş → RAW/SEMI_FINISHED/FINISHED/FINISHED; kısaltma H/Y/B; tanınmayan değer SEBEBİYLE red", () => {
    const r = parseReceiptRows([row({ Sınıf: "Ham" }), row({ Sınıf: "yarı mamul" }), row({ Sınıf: "Bitmiş" }), row({}), row({ Sınıf: "Y" }), row({ Sınıf: "belki" })], catalogs);
    expect(r.lines.map((l) => l.lineClass)).toEqual(["RAW", "SEMI_FINISHED", "FINISHED", "FINISHED", "SEMI_FINISHED"]);
    expect(r.lines.every((l) => l.kind === "FABRIC")).toBe(true);
    expect(at(r.errors, 0)).toMatchObject({ row: 7 });
    expect(at(r.errors, 0).reason).toContain("Sınıf kolonu");
  });

  it("iplik satırında Sınıf doluysa red (kural ④); boşsa iplik satırı YARN türüyle doğar, sınıfsız", () => {
    const bad = parseReceiptRows([{ "Kumaş Kodu": "IPL-000001", Metre: 500, Sınıf: "Ham" }], catalogs);
    expect(bad.lines).toHaveLength(0);
    expect(at(bad.errors, 0).reason).toContain("Sınıf");
    const ok = parseReceiptRows([{ "Kumaş Kodu": "IPL-000001", Metre: 500 }], catalogs);
    expect(at(ok.lines, 0)).toMatchObject({ kind: "YARN" });
    expect(at(ok.lines, 0).lineClass).toBeUndefined();
  });
});
