// Belge tanıt 3 aşama (2026-11-09) rehberli çekirdek: aşama kapısı (① Tanıma · ② Eşleme · ③ Kurallar), ② satır seç → değere dokun,
// SKIP/RELABEL/NEXT, top tablosu sütunu, ③ bölüm başı / toplam satırı / çok parti kuralı, "Okunan: …", benzer şablon kararı.
// Negatif sonda: `suggestBody`den `rules` düşürülünce "⭐ kurallar gövdesi" kırmızı; STAGE_NEXT kapısı (`canReach`) kaldırılınca "⭐ aşama kapısı" kırmızı.
import { describe, expect, it } from "vitest";
import { adoptTemplate, emptyTeach, initialTeach, isKept, locateKept, suggestBody, teachMarks, teachProblems, templateFieldKeys, type TeachState } from "../tanit/teachDraft";
import { chipStatus, fieldReadout, guidedMarks, guidedReduce, guidedStart, saveDecision, suggestName, type GuidedEvent, type GuidedState } from "../tanit/guidedTeach";
import { MAIN_FIELDS, OTHER_FIELDS, teachSummary } from "../tanit/stages";
import type { ScanWord, ScanWords, SuggestResult } from "../tanit/types";

const w = (text: string, [x, y]: [number, number], lineNo: number, width = 60): ScanWord => ({
  text, rect: { x, y, width, height: 20 }, photoRect: { x, y, width, height: 20 }, lineNo, confidence: 0.99,
});
const SCAN: ScanWords = {
  imageWidth: 1000, imageHeight: 1500, rotation: 0,
  words: [
    w("GÜLEÇSOY", [50, 20], 1, 120), w("BOYA", [180, 20], 1), w("ÇEKİ", [50, 60], 2), w("LİSTESİ", [120, 60], 2),
    w("Ham", [50, 300], 3), w("PartiNo:", [100, 300], 3), w("P2618733", [200, 300], 3, 90),
    w("Müşteri:", [50, 400], 5), w("ACME", [150, 400], 5), w("TEKSTİL", [220, 400], 5),
  ],
};
const W = SCAN.words;
const result = (fields: Record<string, string | null>, extra: Partial<SuggestResult> = {}): SuggestResult => ({
  template: {}, explain: [{ field: "partiNo", strategy: "anchor", label: "Ham PartiNo", direction: "right" }], errors: [],
  preview: { matched: true, score: 1, fields, lineCount: 1, warnings: [] }, ...extra,
});

const run = (g: GuidedState, evs: GuidedEvent[], ctx = {}) => evs.reduce((acc, ev) => guidedReduce(acc, ev, W, ctx), g);
const named = (t: TeachState = emptyTeach()) => guidedReduce(guidedStart({ ...t, name: "Güleçsoy" }), { type: "TAP", i: 1 }, W);
const atField = (key: Parameters<typeof isKept>[1], t?: TeachState) => run(named(t), [{ type: "STAGE_NEXT" }, { type: "GOTO", target: { kind: "field", key } }]);

describe("rehberli tanıtma — aşamalar", () => {
  it("② satır düzeni: görünür alanlar grup sırasıyla, hedef/diğer alanlar açılırda; Gelen kg görünür", () => {
    expect(MAIN_FIELDS).toEqual(["musteri", "partiNo", "evrakNo", "toplamMetre", "toplamKg", "en", "desen", "renk"]);
    expect(OTHER_FIELDS).toEqual(["topAdet", "hedefMetraj", "hedefKg", "siparisNo", "tarih", "not", "islem", "gonderenIsEmriNo"]);
  });

  it("⭐ aşama kapısı: kimlik/ad yokken İleri yok; ② alansızken ③'e atlanmaz; geri hep serbest", () => {
    const g0 = guidedStart(emptyTeach());
    expect(guidedReduce(g0, { type: "STAGE_NEXT" }, W).stage).toBe("TANIMA");
    const noName = guidedReduce(guidedStart(emptyTeach()), { type: "TAP", i: 1 }, W);
    expect(guidedReduce(noName, { type: "STAGE_NEXT" }, W).stage).toBe("TANIMA");
    const g = named();
    expect(g.teach.identifiers).toEqual([{ text: "GÜLEÇSOY BOYA", on: true }]);
    expect(guidedReduce(g, { type: "STAGE_GOTO", stage: "KURALLAR" }, W).stage).toBe("TANIMA");
    const e = guidedReduce(g, { type: "STAGE_NEXT" }, W);
    expect(e.stage).toBe("ESLEME");
    expect(e.target).toEqual({ kind: "field", key: "musteri" });
    expect(guidedReduce(e, { type: "STAGE_NEXT" }, W).stage).toBe("ESLEME");
    const done = run(e, [{ type: "TAP", i: 8 }, { type: "STAGE_NEXT" }]);
    expect(done.stage).toBe("KURALLAR");
    expect(done.target).toBeNull();
    expect(guidedReduce(done, { type: "STAGE_GOTO", stage: "TANIMA" }, W).stage).toBe("TANIMA");
    expect(run(done, [{ type: "STAGE_GOTO", stage: "TANIMA" }, { type: "STAGE_GOTO", stage: "KURALLAR" }]).stage).toBe("KURALLAR");
    expect(guidedReduce(done, { type: "STAGE_BACK" }, W).stage).toBe("ESLEME");
  });

  it("② metre/kg aynı kutu (sunucu teachErrors) İleri'yi kapatır; başka sunucu hatası ② kapısı değildir", () => {
    const e = run(named(), [{ type: "STAGE_NEXT" }, { type: "TAP", i: 8 }]);
    const clash = { serverErrors: ['Aynı kutu hem "Gelen metre" hem "Hedef kg" olamaz — kg için belgedeki kg değerine dokunun.'] };
    expect(guidedReduce(e, { type: "STAGE_NEXT" }, W, clash).stage).toBe("ESLEME");
    expect(guidedReduce(e, { type: "STAGE_NEXT" }, W, { serverErrors: ["Bölüm bulunamadı"] }).stage).toBe("KURALLAR");
  });

});

describe("rehberli tanıtma — dokunuşlar", () => {
  it("① dokunma satırı kimlik yapar / kapatır; ad başlıktan önerilir", () => {
    let g = guidedStart(emptyTeach());
    g = guidedReduce(g, { type: "TAP", i: 1 }, W);
    expect(g.teach.identifiers).toEqual([{ text: "GÜLEÇSOY BOYA", on: true }]);
    expect(guidedReduce(g, { type: "TAP", i: 0 }, W).teach.identifiers[0]!.on).toBe(false);
    expect(suggestName(SCAN)).toBe("GÜLEÇSOY BOYA");
  });

  it("② TAP değere ekler/çıkarır (çok kelime); RELABEL boşaltır, satırda kalır; SKIP boşaltıp sonraki satıra geçer", () => {
    let g = atField("musteri");
    g = run(g, [{ type: "TAP", i: 8 }, { type: "TAP", i: 9 }]);
    expect(g.teach.fields.musteri).toEqual([8, 9]);
    expect(guidedReduce(g, { type: "TAP", i: 9 }, W).teach.fields.musteri).toEqual([8]);
    const rel = guidedReduce(g, { type: "RELABEL" }, W);
    expect(rel.target).toEqual({ kind: "field", key: "musteri" });
    expect(rel.teach.fields.musteri).toBeUndefined();
    const sk = guidedReduce(g, { type: "SKIP" }, W);
    expect(sk.target).toEqual({ kind: "field", key: "partiNo" });
    expect(sk.skipped).toEqual(["musteri"]);
    expect(chipStatus(sk.teach, "musteri", sk.skipped)).toBe("skipped");
    const back = run(sk, [{ type: "GOTO", target: { kind: "field", key: "musteri" } }, { type: "TAP", i: 8 }]);
    expect(back.skipped).toEqual([]);
    expect(chipStatus(back.teach, "musteri", back.skipped)).toBe("done");
    expect(run(atField("renk"), [{ type: "NEXT" }]).target).toBeNull();
    expect(run(atField("partiNo"), [{ type: "BACK" }]).target).toEqual({ kind: "field", key: "musteri" });
  });

  it("aynı kelime başka alana atanınca önceki alandan düşer; Gelen kg atanabilir ve gövdeye gider", () => {
    let g = run(atField("partiNo"), [{ type: "TAP", i: 6 }, { type: "GOTO", target: { kind: "field", key: "toplamKg" } }, { type: "TAP", i: 6 }]);
    expect(g.teach.fields).toEqual({ toplamKg: [6] });
    expect(suggestBody(g.teach, W, "s1").assignments.map((a) => a.field)).toEqual(["toplamKg"]);
    g = run(g, [{ type: "GOTO", target: { kind: "column", key: "m" } }, { type: "TAP", i: 6 }]);
    expect(g.teach.fields).toEqual({});
    expect(g.teach.columns).toEqual({ m: [6] });
  });

  it("③ bölüm: Evet → başlangıç yazısına dokun (satır); toplam satırı dokunuşu; Hayır kapatır", () => {
    let g = run(named(), [{ type: "STAGE_NEXT" }, { type: "TAP", i: 6 }, { type: "STAGE_NEXT" }, { type: "SET_RULE", set: { rule: "repeats", on: true } }]);
    expect(g.target).toEqual({ kind: "sectionStart" });
    g = guidedReduce(g, { type: "TAP", i: 5 }, W);
    expect(g.teach.sectionStart).toBe("Ham PartiNo: P2618733");
    expect(guidedMarks(g.teach, W, g)[4]).toMatchObject({ tone: "selected", label: "Bölüm başı" });
    expect(guidedReduce(g, { type: "TAP", i: 4 }, W).teach.sectionStart).toBe("");
    g = run(g, [{ type: "GOTO", target: { kind: "totals" } }, { type: "TAP", i: 2 }]);
    expect(g.teach.totalsLabel).toEqual([2]);
    const off = guidedReduce(g, { type: "SET_RULE", set: { rule: "repeats", on: false } }, W);
    expect(off.teach.repeats).toBe(false);
  });

  it("fotoğraf işaretleri: ① kimlik satırı 'Başlık', ② seçili satırın değeri seçili", () => {
    const s = initialTeach(SCAN);
    expect(guidedMarks(s, W, { stage: "TANIMA", target: null })[0]).toMatchObject({ tone: "column", label: "Başlık" });
    const g = run(atField("partiNo", s), [{ type: "TAP", i: 6 }]);
    expect(guidedMarks(g.teach, W, g)[6]).toMatchObject({ tone: "selected", label: "Gönderen parti no" });
  });
});

describe("⭐ kurallar gövdesi ve Kaldır (base.drop)", () => {
  const OLD = { identifiers: { keywords: ["GÜLEÇSOY BOYA"] }, fields: [{ key: "partiNo", label: "Parti No" }, { key: "musteri", label: "Müşteri" }], rules: { multiParty: "PER_PARTY" } };
  it("yeni tipte Fabrika ayarı = gövdede rules YOK; seçilen kural gider", () => {
    const g = run(named(), [{ type: "STAGE_NEXT" }, { type: "TAP", i: 6 }]);
    expect(suggestBody(g.teach, W, "s1")).not.toHaveProperty("rules");
    const single = guidedReduce(g, { type: "SET_RULE", set: { rule: "multiParty", value: "SINGLE" } }, W);
    expect(suggestBody(single.teach, W, "s1").rules).toEqual({ multiParty: "SINGLE" });
  });
  it("güncellemede kayıtlı kural varsayılan korunur; Fabrika ayarına dönmek açıkça null gönderir", () => {
    const s = initialTeach(SCAN, "A", [], { kept: templateFieldKeys(OLD), multiParty: "PER_PARTY" });
    expect(suggestBody(s, W, "s1", "u-a").rules).toEqual({ multiParty: "PER_PARTY" });
    expect(suggestBody({ ...s, multiParty: null }, W, "s1", "u-a").rules).toEqual({ multiParty: null });
    expect(adoptTemplate(emptyTeach("T"), { name: "A", template: OLD }).multiParty).toBe("PER_PARTY");
    expect(adoptTemplate({ ...emptyTeach("T"), multiParty: "SINGLE" }, { name: "A", template: OLD }).multiParty).toBe("SINGLE");
  });
  it("Kaldır kayıtlı alanı base.drop'a koyar, Geri al çıkarır; yeniden dokunmak kaldırmayı iptal eder; hepsi kalkınca alan eksik", () => {
    const s = initialTeach(SCAN, "A Boya", ["GÜLEÇSOY BOYA"], { kept: templateFieldKeys(OLD) });
    let g = run(guidedStart(s), [{ type: "DROP_FIELD", key: "musteri", on: true }]);
    expect(isKept(g.teach, "musteri")).toBe(false);
    expect(suggestBody(g.teach, W, "s1", "u-a").base).toEqual({ code: "u-a", keep: [], drop: ["musteri"] });
    expect(teachSummary(g.teach)).toBe(`${g.teach.identifiers.filter((d) => d.on).length} kimlik yazısı · 1 alan · 0 kural`);
    expect(suggestBody(guidedReduce(g, { type: "DROP_FIELD", key: "musteri", on: false }, W).teach, W, "s1", "u-a").base).toEqual({ code: "u-a", keep: [] });
    const re = run(g, [{ type: "STAGE_NEXT" }, { type: "GOTO", target: { kind: "field", key: "musteri" } }, { type: "TAP", i: 8 }]);
    expect(suggestBody(re.teach, W, "s1", "u-a").base).toEqual({ code: "u-a", keep: [] });
    g = guidedReduce(g, { type: "DROP_FIELD", key: "partiNo", on: true }, W);
    expect(teachProblems(g.teach)).toContain("En az bir alan atayın (ör. Parti No).");
  });
});

describe("Okunan: … göstergesi", () => {
  const s = { ...emptyTeach(), fields: { partiNo: [6] } };
  it("atanmamış alan boşta; bayat önizleme okunuyor; taze değer + etiket; boş değer okunamadı; hata", () => {
    expect(fieldReadout(emptyTeach(), "partiNo", { result: null, fresh: false, error: null })).toEqual({ kind: "idle" });
    expect(fieldReadout(s, "partiNo", { result: result({ partiNo: "X" }), fresh: false, error: null })).toEqual({ kind: "loading" });
    expect(fieldReadout(s, "partiNo", { result: result({ partiNo: "P2618733" }), fresh: true, error: null })).toEqual({ kind: "ok", value: "P2618733", label: "Ham PartiNo" });
    expect(fieldReadout(s, "partiNo", { result: result({ partiNo: "  " }), fresh: true, error: null })).toEqual({ kind: "empty" });
    expect(fieldReadout(s, "partiNo", { result: null, fresh: false, error: "Ağ hatası" })).toEqual({ kind: "error", text: "Ağ hatası" });
    expect(fieldReadout(s, "partiNo", { result: result({}, { errors: ["Etiket bulunamadı"] }), fresh: true, error: null })).toEqual({ kind: "error", text: "Etiket bulunamadı" });
  });
});

describe("kayıt kararı (benzer şablon)", () => {
  const sim = [{ kod: "u-a", ad: "A Boya", skor: 0.9 }];
  it("benzer yoksa / eski sunucu → doğrudan yeni tip; güncelle kipinde mevcut kod", () => {
    expect(saveDecision({}, null)).toEqual({ kind: "create" });
    expect(saveDecision({ benzerSablonlar: [] }, null)).toEqual({ kind: "create" });
    expect(saveDecision({}, "u-x")).toEqual({ kind: "update", code: "u-x" });
  });
  it("benzer varsa sorar; Aynı tip → o kod güncellenir; Yeni tip → oluşturulur", () => {
    expect(saveDecision({ benzerSablonlar: sim }, null)).toEqual({ kind: "ask", similar: sim });
    expect(saveDecision({ benzerSablonlar: sim }, null, { same: "u-a" })).toEqual({ kind: "update", code: "u-a" });
    expect(saveDecision({ benzerSablonlar: sim }, null, "new")).toEqual({ kind: "create" });
  });
  it("güncellenen şablon benzer sayılmaz", () => {
    expect(saveDecision({ benzerSablonlar: sim }, "u-a")).toEqual({ kind: "update", code: "u-a" });
  });
  it("benimseme: işaretleme korunur, ad + kimlik + eski yapılar şablondan", () => {
    const s = { ...emptyTeach("Taslak"), fields: { partiNo: [6] } };
    const out = adoptTemplate(s, { name: "A Boya", template: { identifiers: { keywords: ["A BOYA SAN"] }, tables: [{}] } });
    expect(out.name).toBe("A Boya");
    expect(out.fields).toEqual({ partiNo: [6] });
    expect(out.identifiers).toEqual([{ text: "A BOYA SAN", on: true }]);
    expect(out.keepOld).toEqual(["tables"]);
  });
});

describe("şablonu güncelle — kayıtlı alanlar (tablet #549 aynası)", () => {
  const OLD = { identifiers: { keywords: ["GÜLEÇSOY BOYA"] }, fields: [{ key: "partiNo", label: "Parti No" }, { key: "musteri", label: "Müşteri" }, { key: "bilinmez", label: "X" }] };
  const kept = () => initialTeach(SCAN, "A Boya", ["GÜLEÇSOY BOYA"], { kept: templateFieldKeys(OLD) });
  const rects = { partiNo: { x: 195, y: 295, width: 100, height: 30 } };

  it("kayıtlı alanlar taslakta; alan atanmadan Kaydet açık; atama olarak gitmez", () => {
    const s = kept();
    expect(s.kept).toEqual(["partiNo", "musteri"]);
    expect(teachProblems(s)).toEqual([]);
    expect(teachProblems({ ...s, kept: [] })).toContain("En az bir alan atayın (ör. Parti No).");
    const b = suggestBody(s, W, "s1", "u-a");
    expect(b.assignments).toEqual([]);
    expect(b.base).toEqual({ code: "u-a", keep: [] });
  });

  it("kayıtlı alan ✓ + değeri; belge üstünde işaretli; yeniden atanınca kayıtlı sayılmaz", () => {
    const s = kept();
    expect(chipStatus(s, "partiNo", [])).toBe("done");
    expect(fieldReadout(s, "partiNo", { result: result({ partiNo: "P2618733" }), fresh: false, error: null })).toEqual({ kind: "ok", value: "P2618733", label: null, kept: true });
    expect(fieldReadout(s, "musteri", { result: null, fresh: false, error: null })).toEqual({ kind: "loading" });
    const located = locateKept(s, W, rects);
    expect(located).toEqual({ partiNo: [6] });
    expect(teachMarks(s, W, located)[6]).toMatchObject({ tone: "field", label: "Parti No (kayıtlı)" });
    expect(guidedMarks(s, W, { stage: "ESLEME", target: { kind: "field", key: "partiNo" } }, located)[6]).toMatchObject({ tone: "selected" });
    const re = { ...s, fields: { partiNo: [6] } };
    expect(isKept(re, "partiNo")).toBe(false);
    expect(locateKept(re, W, rects)).toEqual({});
    expect(suggestBody(re, W, "s1", "u-a").assignments.map((a) => a.field)).toEqual(["partiNo"]);
  });

  it("Aynı tip (adoptTemplate) o şablonun kayıtlı alanlarını alır", () => {
    expect(adoptTemplate(emptyTeach("T"), { name: "A Boya", template: OLD }).kept).toEqual(["partiNo", "musteri"]);
  });
});
