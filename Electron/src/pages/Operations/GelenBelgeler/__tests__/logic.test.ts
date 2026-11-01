// Gelen belge saf mantığı: hücre kuyruğu, Türkçe sayı, Excel ayrıştırma,
// onay sonucu özeti, hata kodu yalnız `details.code`, liste sorgusu (süzme sunucuda), rejim yüklemi.
import { describe, expect, it } from "vitest";
import { AxiosError, type AxiosResponse } from "axios";
import { buildReviewQueue, cellPatch, fieldRect, lineRect, lineScanId, parseTrNumber } from "../review-queue";
import { parseLineRows, MAX_IMPORT_LINES } from "../lineImport";
import { approveErrorText, approvePrecheck, defaultItemHint, errorCode, needsVarianceReason, summarizeApprove, unusableDefaultSource } from "../approveFlow";
import { EMPTY_FILTER, toQuery } from "../useNoteList";
import { isIncomingDocumentVisible } from "../gelenBelge-regime";
import type { ApproveResult, DeliveryNoteLine } from "../types";

type L = Pick<DeliveryNoteLine, "id" | "lineNo" | "blockNo" | "meters" | "weightKg" | "status" | "needsReview" | "rollId" | "sourceRects">;
const line = (o: Partial<L>): L => ({
  id: "l1", lineNo: 1, blockNo: 1, meters: "100", weightKg: null, status: "PENDING", needsReview: false, rollId: null, sourceRects: null, ...o,
});

describe("hücre gözden geçirme kuyruğu", () => {
  const rect = { x: 10, y: 20, width: 30, height: 10 };
  it("yalnız açık needsReview satırlar, blok → satır sırası; kg kutusu varsa ikinci hücre", () => {
    const q = buildReviewQueue([
      line({ id: "b", blockNo: 2, lineNo: 1, needsReview: true }),
      line({ id: "a2", blockNo: 1, lineNo: 2, needsReview: true, sourceRects: { m: rect, kg: rect } }),
      line({ id: "a1", blockNo: 1, lineNo: 1, needsReview: true }),
      line({ id: "x", needsReview: true, rollId: "r" }),
      line({ id: "y", needsReview: true, status: "SKIPPED" }),
      line({ id: "z", needsReview: false }),
    ]);
    expect(q.map((i) => `${i.lineId}:${i.field}`)).toEqual(["a1:meters", "a2:meters", "a2:weightKg", "b:meters"]);
  });
  it("metre kaydı aynı satırın kg hücresi kuyruktayken işareti korur; son hücre işareti bırakır", () => {
    const q = buildReviewQueue([line({ id: "a", needsReview: true, sourceRects: { m: rect, kg: rect } }), line({ id: "b", lineNo: 2, needsReview: true })]);
    expect(cellPatch(q, 0, 12.5)).toEqual({ meters: 12.5, needsReview: true });
    expect(cellPatch(q, 1, 40)).toEqual({ weightKg: 40 });
    expect(cellPatch(q, 2, 7)).toEqual({ meters: 7 });
  });
  it("hücre dikdörtgeni metre anahtarından, yoksa değer hücresinden, yoksa satır kutusundan", () => {
    expect(fieldRect({ sourceRects: { metre: rect } }, "meters")).toEqual(rect);
    expect(fieldRect({ sourceRects: { row: { ...rect, x: 0 }, v3: rect } }, "meters")).toEqual(rect);
    expect(fieldRect({ sourceRects: { row: rect } }, "meters")).toEqual(rect);
    expect(fieldRect({ sourceRects: null }, "weightKg")).toBeNull();
  });
  it("satır vurgusu bütün kutuların birleşimi", () => {
    expect(lineRect({ sourceRects: { a: { x: 0, y: 0, width: 10, height: 10 }, b: { x: 20, y: 5, width: 5, height: 10 } } }))
      .toEqual({ x: 0, y: 0, width: 25, height: 15 });
    expect(lineRect({ sourceRects: {} })).toBeNull();
  });
  it("Türkçe sayı: virgül ondalık, nokta binlik; ≤0 ve çöp null", () => {
    expect(parseTrNumber("1.234,5")).toBe(1234.5);
    expect(parseTrNumber("120,25")).toBe(120.25);
    expect(parseTrNumber("88.5")).toBe(88.5);
    expect(parseTrNumber("0")).toBeNull();
    expect(parseTrNumber("12a")).toBeNull();
    expect(parseTrNumber("")).toBeNull();
  });
});

describe("Excel satır ayrıştırma", () => {
  it("kolon adı bağlayıcı; boş satır atlanır; hatalı satır sebebiyle", () => {
    const r = parseLineRows([
      { Blok: 2, "Top No": "7", Metre: "120,5", Kilo: 30, Kumaş: "Penye", Renk: "Lacivert" },
      { Blok: null, Metre: null, Kilo: null },
      { Metre: "abc" },
      { Metre: 10, Kilo: "x" },
      { Blok: 120, Metre: 10 },
      { Metre: 5 },
    ]);
    expect(r.lines).toEqual([
      { blockNo: 2, senderRollNo: "7", meters: 120.5, weightKg: 30, widthCm: null, itemText: "Penye", colorText: "Lacivert" },
      { blockNo: 1, senderRollNo: null, meters: 5, weightKg: null, widthCm: null, itemText: null, colorText: null },
    ]);
    expect(r.errors).toEqual([
      { row: 4, message: "Metre boş ya da geçersiz" },
      { row: 5, message: "Kilo geçersiz" },
      { row: 6, message: "Blok 1–99 olmalı" },
    ]);
  });
  it("tavan aşılınca kesilir ve bildirilir", () => {
    const r = parseLineRows(Array.from({ length: MAX_IMPORT_LINES + 3 }, () => ({ Metre: 1 })));
    expect(r.lines).toHaveLength(MAX_IMPORT_LINES);
    expect(r.errors.at(-1)?.row).toBe(0);
  });
});

const err = (status: number, data: unknown) =>
  new AxiosError("x", "ERR", undefined, undefined, { status, data } as AxiosResponse);

describe("onay akışı", () => {
  it("hata kodu YALNIZ details.code'tan; body.code okunmaz", () => {
    expect(errorCode(err(409, { details: { code: "TOTAL_MISMATCH" } }))).toBe("TOTAL_MISMATCH");
    expect(errorCode(err(409, { code: "TOTAL_MISMATCH" }))).toBeNull();
    expect(errorCode(new Error("x"))).toBeNull();
  });
  it("gerekçe isteyen kapılar: TOTAL_MISMATCH ve sayfa eksikliği; claim çakışması değil", () => {
    expect(needsVarianceReason(err(409, { details: { code: "TOTAL_MISMATCH" } }))).toBe(true);
    expect(needsVarianceReason(err(409, { details: { code: "DELIVERY_NOTE_PAGES_MISSING" } }))).toBe(true);
    expect(needsVarianceReason(err(409, { details: { code: "CONFLICT" } }))).toBe(false);
  });
  const result = (status: ApproveResult["note"]["status"], lines: Array<Partial<DeliveryNoteLine>>, failed = 0): ApproveResult =>
    ({ note: { status, lines }, summary: { entered: 3, failed, skipped: 1, replayed: 0, rollIds: [] }, warnings: [] }) as unknown as ApproveResult;
  it("APPROVED → başlık sayılarla, düşen satır yok", () => {
    const o = summarizeApprove(result("APPROVED", [{ status: "ENTERED", lineNo: 1, blockNo: 1 }]));
    expect(o.status).toBe("APPROVED");
    expect(o.title).toBe("Onaylandı — 3 top girildi, 1 atlandı.");
    expect(o.failed).toEqual([]);
  });
  it("PARTIAL → FAILED satırlar sebebiyle listelenir", () => {
    const o = summarizeApprove(result("PARTIAL", [
      { status: "ENTERED", lineNo: 1, blockNo: 1 },
      { status: "FAILED", lineNo: 2, blockNo: 1, failReason: "Ürün çözülemedi" },
      { status: "FAILED", lineNo: 3, blockNo: 2, failReason: null },
    ], 2));
    expect(o.status).toBe("PARTIAL");
    expect(o.title).toContain("2 satır girilemedi");
    expect(o.failed).toEqual([
      { lineNo: 2, blockNo: 1, reason: "Ürün çözülemedi" },
      { lineNo: 3, blockNo: 2, reason: "Sebep bildirilmedi" },
    ]);
  });
});

describe("liste sorgusu ve rejim", () => {
  it("süzgeçler sunucuya gider; boş süzgeç alan göndermez", () => {
    expect(toQuery(EMPTY_FILTER)).toEqual({ status: undefined, ownerCustomerId: undefined, senderCustomerId: undefined, q: undefined, from: undefined, to: undefined, limit: 50 });
    expect(toQuery({ status: "DRAFT", ownerCustomerId: "o", senderCustomerId: "s", q: "  İRS-1 ", from: "2026-10-01", to: "2026-10-29" }))
      .toEqual({ status: "DRAFT", ownerCustomerId: "o", senderCustomerId: "s", q: "İRS-1", from: "2026-10-01", to: "2026-10-29", limit: 50 });
  });
  it("modül kapalı → görünmez", () => {
    expect(isIncomingDocumentVisible({ gelenBelgeEnabled: false })).toBe(false);
    expect(isIncomingDocumentVisible({ gelenBelgeEnabled: true })).toBe(true);
  });
});

describe("onay ön kontrolü (E3/E4) — backend precheck aynası, etkin varsayılan kaynağıyla", () => {
  type P = Parameters<typeof approvePrecheck>[0][number];
  const pl = (o: Partial<P>): P => ({ status: "PENDING", rollId: null, itemId: null, needsReview: false, ...o });
  const set = (mode: "WARN" | "BLOCK" = "WARN") => ({ defaultItem: null, unreviewedApproval: mode, defaultUnreviewedApproval: "WARN" as const });
  const eff = (source: "CUSTOMER" | "FACTORY" | null, name = "Ham", problem: string | null = null) =>
    ({ itemId: source ? "i" : null, name: source ? name : null, source, usable: source ? !problem : false, problem });
  it("yalnız açık satır sayılır (topsuz PENDING/FAILED/ENTERING); SKIPPED ve topu doğmuş sayılmaz", () => {
    const r = approvePrecheck([pl({}), pl({ status: "FAILED" }), pl({ status: "SKIPPED" }), pl({ status: "ENTERED", rollId: "r" }), pl({ itemId: "x" })], set(), eff("FACTORY"));
    expect([r.unresolved, r.blocked]).toEqual([2, false]);
    expect(r.messages).toEqual([{ tone: "info", text: "2 satır fabrika varsayılanıyla girecek: Ham" }]);
  });
  it("CUSTOMER kaynağı: müşteri varsayılanıyla girecek", () => {
    expect(approvePrecheck([pl({})], set(), eff("CUSTOMER", "Gül Ham")).messages).toEqual([{ tone: "info", text: "1 satır müşteri varsayılanıyla girecek: Gül Ham" }]);
  });
  it("etkin varsayılan yok + ürünsüz satır → engel (bugünkü 400'ün aynası)", () => {
    const r = approvePrecheck([pl({})], set(), eff(null));
    expect(r.blocked).toBe(true);
    expect(r.messages[0]!.text).toContain("ne müşteri ne fabrika");
  });
  it("kullanılamaz varsayılan → engel; kaynak ve sebep metinde (müşteri bozuksa fabrikaya düşmez)", () => {
    const c = approvePrecheck([pl({})], set(), eff("CUSTOMER", "Ham", "Ürün pasif."));
    expect([c.blocked, c.messages[0]!.tone]).toEqual([true, "block"]);
    expect(c.messages[0]!.text).toContain("müşteri varsayılanı kullanılamıyor: Ürün pasif.");
    expect(approvePrecheck([pl({})], set(), eff("FACTORY", "Ham", "Ürün pasif.")).messages[0]!.text).toContain("fabrika varsayılanı kullanılamıyor");
  });
  it("BLOCK'ta gözden geçirilmemiş → engel; WARN'da uyarı", () => {
    expect(approvePrecheck([pl({ itemId: "x", needsReview: true })], set("BLOCK"), eff(null)).messages).toEqual([{ tone: "block", text: "1 satır gözden geçirilmeli — onay engellenir." }]);
    expect(approvePrecheck([pl({ itemId: "x", needsReview: true })], set("WARN"), eff(null)).blocked).toBe(false);
  });
  it("ayar ve etkin varsayılan okunamadı (undefined) → sayar ama hüküm vermez", () => {
    const r = approvePrecheck([pl({ needsReview: true })], undefined, undefined);
    expect([r.unresolved, r.unreviewed, r.blocked]).toEqual([1, 1, false]);
    expect(r.messages.every((m) => m.tone === "info")).toBe(true);
  });
  it("satır ipucu: kaynak/yok/kullanılamaz", () => {
    expect(defaultItemHint(eff("CUSTOMER", "Gül Ham"))).toEqual({ tone: "info", source: "CUSTOMER", text: "Müşteri varsayılanıyla girecek: Gül Ham" });
    expect(defaultItemHint(eff("FACTORY", "Ham"))!.text).toBe("Fabrika varsayılanıyla girecek: Ham");
    expect(defaultItemHint(eff(null))).toBeNull();
    expect(defaultItemHint(undefined)).toBeNull();
    expect(defaultItemHint(eff("FACTORY", "Ham", "Ürün pasif."))).toMatchObject({ tone: "block", text: "Varsayılan ürün kullanılamıyor (fabrika varsayılanı): Ürün pasif." });
  });
  it("409 UNUSABLE kaynağa göre yönlendirir; kaynaksız (eski backend) genel metin", () => {
    const e = (source?: string) => new AxiosError("409", "ERR", undefined, undefined, { status: 409, data: { details: { code: "GELEN_BELGE_DEFAULT_ITEM_UNUSABLE", ...(source ? { source } : {}) } } } as AxiosResponse);
    expect(unusableDefaultSource(e("CUSTOMER"))).toBe("CUSTOMER");
    expect(approveErrorText(e("CUSTOMER"), "B")).toMatch(/müşterinin varsayılan ürününü düzeltin\. \(B\)$/);
    expect(approveErrorText(e("FACTORY"), "B")).toMatch(/fabrika ayarındaki varsayılan ürünü düzeltin\. \(B\)$/);
    expect(unusableDefaultSource(e())).toBeNull();
    expect(approveErrorText(e(), "B")).toMatch(/^Ürünü seçilmemiş satırların gireceği varsayılan ürün/);
  });
  it("E3 hata kodlarında Türkçe yönlendirme + backend metni; diğerlerinde yalnız backend metni", () => {
    const e = (code: string) => new AxiosError("409", "ERR", undefined, undefined, { status: 409, data: { details: { code } } } as AxiosResponse);
    expect(approveErrorText(e("DELIVERY_NOTE_REVIEW_PENDING"), "B")).toMatch(/^Gözden geçirilmemiş satır var.*\(B\)$/);
    expect(approveErrorText(e("CONFLICT"), "B")).toBe("B");
  });
});

describe("kırpık doğru sayfadan (E4 scanId)", () => {
  const scans = [{ id: "s1" }, { id: "s2" }];
  it("çok sayfada satır kendi taramasını kullanır: 2. sayfanın satırı 2. sayfadan", () => {
    expect(lineScanId({ scanId: "s2" }, scans)).toBe("s2");
    expect(lineScanId({ scanId: "s1" }, scans)).toBe("s1");
  });
  it("scanId null/undefined → bugünkü davranış: tek taramada o, çok sayfada kırpık yok", () => {
    expect(lineScanId({ scanId: null }, [{ id: "s1" }])).toBe("s1");
    expect(lineScanId({}, [{ id: "s1" }])).toBe("s1");
    expect(lineScanId({ scanId: null }, scans)).toBeNull();
  });
  it("belgede olmayan tarama → kırpık yok (yanlış görüntü gösterilmez)", () => {
    expect(lineScanId({ scanId: "yok" }, scans)).toBeNull();
  });
});
