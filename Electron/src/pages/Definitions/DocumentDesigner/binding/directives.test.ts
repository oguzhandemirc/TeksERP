import { describe, expect, it } from "vitest";
import { buildCondition, loopExpression, parseCondition, parseLoop, suggestFilters, validateCondition, validateFilterChain, type ConditionRow } from "./directives";

const r = (p: Partial<ConditionRow> & { path: string }): ConditionRow => ({ join: "and", op: "", valueKind: "metin", value: "", ...p });

describe("data-if kurucusu ↔ dilbilgisi", () => {
  it("satırlar yol · op · değer + and/or olarak birleşir", () => {
    const out = buildCondition([r({ path: "satir.metre", op: ">", valueKind: "sayi", value: "0" }), r({ join: "or", path: "belge.yurtdisi", op: "==", valueKind: "sabit", value: "true" })]);
    expect(out).toEqual({ ok: true, value: "satir.metre > 0 or belge.yurtdisi == true" });
  });
  it("metin değeri tırnaklanır; op yoksa yalnız yol", () => {
    expect(buildCondition([r({ path: "karsi_taraf.ad", op: "contains", value: "A.Ş." })])).toEqual({ ok: true, value: 'karsi_taraf.ad contains "A.Ş."' });
    expect(buildCondition([r({ path: "belge.plaka" })])).toEqual({ ok: true, value: "belge.plaka" });
  });
  it.each([
    [[r({ path: "" })], /alan seçilmedi/],
    [[r({ path: "belge.no(" })], /yol geçersiz/],
    [[r({ path: "a.b", op: "==", valueKind: "sayi", value: "12,5" })], /sayı/],
    [[r({ path: "a.b", op: "==", value: 'x"y' })], /kullanılamaz/],
    [[r({ path: "a.b", op: "==", value: "{{x}}" })], /kullanılamaz/],
    [[r({ path: "a.b", op: "==", valueKind: "sabit", value: "evet" })], /sabit/],
    [[], /En az bir/],
  ])("geçersiz girdi engellenir %#", (rows, re) => {
    const out = buildCondition(rows as ConditionRow[]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(re);
  });
  it("parantez dilbilgisi dışı", () => {
    expect(validateCondition("(a.b and c)")).not.toBeNull();
  });
  it("parse ↔ build gidiş-dönüş", () => {
    const s = 'a.b == "x y" and c.d >= 2.5 or e.f';
    const rows = parseCondition(s)!;
    expect(rows.map((x) => x.join)).toEqual(["and", "and", "or"]);
    expect(buildCondition(rows)).toEqual({ ok: true, value: s });
  });
});

describe("filtre önerisi ve denetimi", () => {
  it("tür → öneri", () => {
    expect(suggestFilters("tarih")[0]!.value).toBe("tarih");
    expect(suggestFilters("tarih_saat")[0]!.value).toBe("tarih_saat");
    expect(suggestFilters("para")[0]!.value).toBe('para: "TRY"');
    expect(suggestFilters("sayi", { birim: "m", ondalik: 2 })[0]!.value).toBe("metre");
    expect(suggestFilters("sayi", { ondalik: 0 })[0]!.value).toBe("sayi: 0");
    expect(suggestFilters("gorsel")).toEqual([]);
  });
  it("izinsiz filtre ve bozuk argüman reddedilir", () => {
    expect(validateFilterChain("date")).toMatch(/İzinsiz/);
    expect(validateFilterChain("plus: 1")).toMatch(/İzinsiz/);
    expect(validateFilterChain("sayi: x")).toMatch(/argümanı/);
    expect(validateFilterChain('barkod: "code128"')).toBeNull();
    expect(validateFilterChain("upcase | default: \"-\"")).toBeNull();
  });
});

describe("data-each kaynağı yalnız tablolar.*", () => {
  it("üretim ve ayrıştırma", () => {
    expect(loopExpression("urun")).toBe("satir in tablolar.urun");
    expect(parseLoop("satir in tablolar.urun")).toEqual({ variable: "satir", tableKey: "urun" });
    expect(parseLoop("satir in belge.siparisler")).toBeNull();
    expect(parseLoop("satir in ayar.signatureLabels")).toBeNull();
  });
});
