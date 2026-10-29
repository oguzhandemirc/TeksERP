// Gelen belge saf mantığı: toplam şeridi (blok başına), hücre kuyruğu, Türkçe sayı, Excel ayrıştırma,
// onay sonucu özeti, hata kodu yalnız `details.code`, liste sorgusu (süzme sunucuda), rejim yüklemi.
import { describe, expect, it } from "vitest";
import { AxiosError, type AxiosResponse } from "axios";
import { blockTotals, hasMismatch } from "../totals";
import { buildReviewQueue, cellPatch, fieldRect, lineRect, parseTrNumber } from "../review-queue";
import { parseLineRows, MAX_IMPORT_LINES } from "../lineImport";
import { errorCode, needsVarianceReason, summarizeApprove } from "../approveFlow";
import { EMPTY_FILTER, toQuery } from "../useNoteList";
import { isIncomingDocumentVisible } from "../gelenBelge-regime";
import type { ApproveResult, DeliveryNoteLine } from "../types";

type L = Pick<DeliveryNoteLine, "id" | "lineNo" | "blockNo" | "meters" | "weightKg" | "status" | "needsReview" | "rollId" | "sourceRects">;
const line = (o: Partial<L>): L => ({
  id: "l1", lineNo: 1, blockNo: 1, meters: "100", weightKg: null, status: "PENDING", needsReview: false, rollId: null, sourceRects: null, ...o,
});

describe("toplam şeridi — blok başına Σ satır ↔ beyan", () => {
  it("her blok kendi beyanıyla ölçülür; SKIPPED satır sayılmaz", () => {
    const lines = [
      line({ blockNo: 1, meters: "100.5" }),
      line({ blockNo: 1, meters: "99.5" }),
      line({ blockNo: 1, meters: "50", status: "SKIPPED" }),
      line({ blockNo: 2, meters: "80" }),
    ];
    const t = blockTotals(lines, [
      { blockNo: 1, count: "2", m: "200", kg: null },
      { blockNo: 2, count: "2", m: "80", kg: null },
    ]);
    expect(t.map((b) => [b.blockNo, b.count, b.m, b.ok])).toEqual([[1, 2, 200, true], [2, 1, 80, false]]);
    expect(t[1]!.mismatches).toEqual(["beyan 2 top, satır 1"]);
    expect(hasMismatch(t)).toBe(true);
  });
  it("binde 5 hoşgörü içinde tutar, dışında tutmaz", () => {
    expect(blockTotals([line({ meters: "1004" })], [{ blockNo: 1, count: null, m: "1000", kg: null }])[0]!.ok).toBe(true);
    expect(blockTotals([line({ meters: "1006" })], [{ blockNo: 1, count: null, m: "1000", kg: null }])[0]!.ok).toBe(false);
  });
  it("beyan yoksa doğrulanamaz (null), uyuşmazlık sayılmaz", () => {
    const t = blockTotals([line({})], null);
    expect(t[0]!.ok).toBeNull();
    expect(hasMismatch(t)).toBe(false);
  });
  it("satırı olmayan beyanlı blok da şeritte görünür", () => {
    const t = blockTotals([line({ blockNo: 1 })], [{ blockNo: 3, count: "4", m: null, kg: null }]);
    expect(t.map((b) => b.blockNo)).toEqual([1, 3]);
    expect(t[1]!.ok).toBe(false);
  });
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
    expect(toQuery(EMPTY_FILTER)).toEqual({ status: undefined, ownerCustomerId: undefined, senderCustomerId: undefined, q: undefined, limit: 50 });
    expect(toQuery({ status: "DRAFT", ownerCustomerId: "o", senderCustomerId: "s", q: "  İRS-1 " }))
      .toEqual({ status: "DRAFT", ownerCustomerId: "o", senderCustomerId: "s", q: "İRS-1", limit: 50 });
  });
  it("modül kapalı → görünmez", () => {
    expect(isIncomingDocumentVisible({ gelenBelgeEnabled: false })).toBe(false);
    expect(isIncomingDocumentVisible({ gelenBelgeEnabled: true })).toBe(true);
  });
});
