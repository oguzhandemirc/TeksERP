// Durum → görünen eylemler tablosu (her durum) + izin süzgeci + süresi dolan SENT'te "Kabul et" yok;
// 409/kod → Türkçe cümle eşlemesi.
import { AxiosError, type AxiosResponse } from "axios";
import { describe, expect, it } from "vitest";
import { quoteActions } from "./quote-actions";
import { missingItemLines, quoteErrorMessage } from "./quote-errors";
import type { QuoteStatus } from "./quote-types";

const all = () => true;
const EXPECTED: Record<QuoteStatus, string[]> = {
  DRAFT: ["send", "cancel"],
  SENT: ["accept", "reject", "revise", "cancel"],
  ACCEPTED: ["convert", "unaccept"],
  REJECTED: ["revise"],
  CANCELLED: [],
  CONVERTED: [],
  SUPERSEDED: [],
};

function axiosErr(status: number, details: Record<string, unknown>): AxiosError {
  const e = new AxiosError("x");
  e.response = { status, data: { success: false, message: "sunucu", details } } as AxiosResponse;
  return e;
}

describe("teklif eylem tablosu", () => {
  for (const [s, acts] of Object.entries(EXPECTED)) {
    it(`${s} → ${acts.join(", ") || "eylem yok"}`, () => {
      expect(quoteActions(s as QuoteStatus, { can: all })).toEqual(acts);
    });
  }
  it("süresi dolmuş SENT: kabul yok, revizyon var", () => {
    expect(quoteActions("SENT", { expired: true, can: all })).toEqual(["reject", "revise", "cancel"]);
  });
  it("izin süzgeci: quote:write yalnız → kabul/dönüştür yok; quote:convert yalnız → gönder/iptal yok", () => {
    expect(quoteActions("ACCEPTED", { can: (p) => p === "quote:write" })).toEqual([]);
    expect(quoteActions("SENT", { can: (p) => p === "quote:write" })).toEqual(["reject", "revise", "cancel"]);
    expect(quoteActions("DRAFT", { can: (p) => p === "quote:convert" })).toEqual([]);
    expect(quoteActions("ACCEPTED", { can: (p) => p === "quote:convert" })).toEqual(["convert", "unaccept"]);
  });
});

describe("hata kodu → Türkçe", () => {
  it("409 QUOTE_STATUS_CONFLICT güncel durumu adıyla söyler", () => {
    expect(quoteErrorMessage(axiosErr(409, { code: "QUOTE_STATUS_CONFLICT", status: "CONVERTED" }))).toContain("şu anki durumu: Siparişe dönüştü");
  });
  it("QUOTE_EXPIRED → revizyon çaresi; PERMISSION_DENIED order:write → sipariş yetkisi", () => {
    expect(quoteErrorMessage(axiosErr(409, { code: "QUOTE_EXPIRED" }))).toContain("Revizyon oluşturup");
    expect(quoteErrorMessage(axiosErr(403, { code: "PERMISSION_DENIED", required: ["order:write"] }))).toContain("Sipariş oluşturma yetkiniz yok");
  });
  it("QUOTE_LINE_ITEM_MISSING satırları details.lines'tan", () => {
    expect(missingItemLines(axiosErr(400, { code: "QUOTE_LINE_ITEM_MISSING", lines: [{ lineNo: 2, description: "Sahra" }] }))).toEqual([{ lineNo: 2, description: "Sahra" }]);
    expect(missingItemLines(axiosErr(400, { code: "OTHER" }))).toBeNull();
  });
});
