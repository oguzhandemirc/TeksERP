// K30-T A2/A3 rehberli tanıtma çekirdeği: adım ilerleme, TAP/NEXT/SKIP/RELABEL, ad başlıktan, "Okunan: …" okuması, benzer şablon kararı.
import { describe, expect, it } from "vitest";
import { adoptTemplate, emptyTeach, initialTeach } from "../tanit/teachDraft";
import { FINISH_STEP, GUIDED_FIELDS, chipStatus, fieldReadout, guidedMarks, guidedReduce, guidedStart, saveDecision, stepField, suggestName } from "../tanit/guidedTeach";
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

describe("rehberli tanıtma reducer'ı", () => {
  it("adım sırası: başlık → Müşteri, Parti no, Hedef metraj, Kurşun metresi, En, Desen, Renk → bitir", () => {
    expect(GUIDED_FIELDS).toEqual(["musteri", "partiNo", "hedefMetraj", "toplamMetre", "en", "desen", "renk"]);
    expect(stepField(0)).toBeNull();
    expect(stepField(1)).toBe("musteri");
    expect(stepField(FINISH_STEP)).toBeNull();
    let g = guidedStart(emptyTeach());
    for (let i = 0; i < FINISH_STEP + 3; i++) g = guidedReduce(g, { type: "NEXT" }, W);
    expect(g.step).toBe(FINISH_STEP);
    expect(guidedReduce(guidedStart(emptyTeach()), { type: "BACK" }, W).step).toBe(0);
  });

  it("başlıkta dokunma satırı kimlik yapar / kapatır; NEXT ad boşsa başlıktan önerir, doluysa dokunmaz", () => {
    let g = guidedStart(emptyTeach());
    g = guidedReduce(g, { type: "TAP", i: 1 }, W);
    expect(g.teach.identifiers).toEqual([{ text: "GÜLEÇSOY BOYA", on: true }]);
    expect(guidedReduce(g, { type: "TAP", i: 0 }, W).teach.identifiers[0]!.on).toBe(false);
    const next = guidedReduce(g, { type: "NEXT" }, W);
    expect(next.step).toBe(1);
    expect(next.teach.name).toBe("GÜLEÇSOY BOYA");
    expect(guidedReduce({ ...g, teach: { ...g.teach, name: "Benim adım" } }, { type: "NEXT" }, W).teach.name).toBe("Benim adım");
    expect(suggestName(SCAN)).toBe("GÜLEÇSOY BOYA");
  });

  it("alan adımında TAP değere ekler/çıkarır (çok kelime); RELABEL boşaltır ve adımda kalır; SKIP boşaltıp ilerler", () => {
    let g = guidedReduce(guidedStart(emptyTeach()), { type: "GOTO", step: 1 }, W);
    g = guidedReduce(g, { type: "TAP", i: 8 }, W);
    g = guidedReduce(g, { type: "TAP", i: 9 }, W);
    expect(g.teach.fields.musteri).toEqual([8, 9]);
    expect(guidedReduce(g, { type: "TAP", i: 9 }, W).teach.fields.musteri).toEqual([8]);
    const rel = guidedReduce(g, { type: "RELABEL" }, W);
    expect(rel.step).toBe(1);
    expect(rel.teach.fields.musteri).toBeUndefined();
    const sk = guidedReduce(g, { type: "SKIP" }, W);
    expect(sk.step).toBe(2);
    expect(sk.skipped).toEqual(["musteri"]);
    expect(sk.teach.fields.musteri).toBeUndefined();
    expect(chipStatus(sk.teach, "musteri", sk.skipped)).toBe("skipped");
    // Atlanan alana dönüp dokunmak "yok" işaretini kaldırır.
    const back = guidedReduce(guidedReduce(sk, { type: "GOTO", step: 1 }, W), { type: "TAP", i: 8 }, W);
    expect(back.skipped).toEqual([]);
    expect(chipStatus(back.teach, "musteri", back.skipped)).toBe("done");
  });

  it("aynı kelime başka alana atanınca önceki alandan düşer", () => {
    let g = guidedReduce(guidedStart(emptyTeach()), { type: "GOTO", step: 1 }, W);
    g = guidedReduce(g, { type: "TAP", i: 6 }, W);
    g = guidedReduce(guidedReduce(g, { type: "NEXT" }, W), { type: "TAP", i: 6 }, W);
    expect(g.teach.fields).toEqual({ partiNo: [6] });
  });

  it("fotoğraf işaretleri: başlık adımında kimlik satırı, alan adımında o alanın değeri seçili", () => {
    const s = initialTeach(SCAN);
    const head = guidedMarks(s, W, 0);
    expect(head[0]).toMatchObject({ tone: "column", label: "Başlık" });
    const g = guidedReduce(guidedReduce(guidedStart(s), { type: "GOTO", step: 2 }, W), { type: "TAP", i: 6 }, W);
    expect(guidedMarks(g.teach, W, 2)[6]).toMatchObject({ tone: "selected", label: "Parti no" });
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
