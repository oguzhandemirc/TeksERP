// BEKÇİ — rapor isteği 60 sn bekler, rapor GET uyarısı basılır (Perf-2 B5)
//   NEGATİF SONDA: `resolveRequestTimeout` her zaman `timeout`u döndürürse §1a/§1b ❌
import { describe, expect, it, vi } from "vitest";
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn() } }));
import { DEFAULT_TIMEOUT_MS, REPORT_TIMEOUT_MS, isReportUrl, resolveRequestTimeout } from "./report-request";
import { shouldToastWarnings } from "./serverNotes";

describe("rapor isteği", () => {
  it("§1a ⭐ rapor ucu varsayılan zaman aşımıyla gelirse 60 sn", () => {
    expect(resolveRequestTimeout("/api/reports/dokuma/randiman?x=1", DEFAULT_TIMEOUT_MS)).toBe(REPORT_TIMEOUT_MS);
    expect(resolveRequestTimeout("http://10.0.0.5:4000/api/reports/quality/scorecard", DEFAULT_TIMEOUT_MS)).toBe(REPORT_TIMEOUT_MS);
  });
  it("§1b ⭐ zaman aşımı hiç verilmemiş rapor isteği de 60 sn", () => {
    expect(resolveRequestTimeout("/api/reports/finance/cash-book", undefined)).toBe(REPORT_TIMEOUT_MS);
  });
  it("§1c rapor dışı uç ve açık zaman aşımı DEĞİŞMEZ", () => {
    expect(resolveRequestTimeout("/api/rolls", DEFAULT_TIMEOUT_MS)).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolveRequestTimeout("/api/reports-x/a", DEFAULT_TIMEOUT_MS)).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolveRequestTimeout("/api/reports/a", 3000)).toBe(3000);
    expect(resolveRequestTimeout("/health", 3000)).toBe(3000);
    expect(isReportUrl(undefined)).toBe(false);
  });
  it("§2 ⭐ rapor GET'inin uyarısı basılır; diğer GET basılmaz; bayrak yine susturur", () => {
    const zarf = { success: true, warnings: ["x"] };
    expect(shouldToastWarnings({ method: "get", url: "/api/reports/quality/scorecard" }, zarf)).toBe(true);
    expect(shouldToastWarnings({ method: "get", url: "/api/rolls" }, zarf)).toBe(false);
    expect(shouldToastWarnings({ method: "get", url: "/api/reports/x", serverWarnings: "silent" }, zarf)).toBe(false);
  });
});
