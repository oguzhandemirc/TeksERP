import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { DEFAULT_STALE_MS, CATALOG_STALE_MS, applyQueryFreshness } from "./query-freshness";

// K21: sorgu düzeyinde staleTime vermeyen sorgu hangi tazeliği alır?
describe("sorgu tazeliği", () => {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: DEFAULT_STALE_MS } } });
  applyQueryFreshness(qc);
  const staleOf = (key: unknown[]) => qc.defaultQueryOptions({ queryKey: key }).staleTime;
  it("para/bakiye/kasa (finance…) her mount'ta tazelenir", () => {
    expect(staleOf(["finance", "cash-boxes"])).toBe(0);
    expect(staleOf(["finance", "bank-accounts"])).toBe(0);
  });
  it("katalog 5 dk korur", () => expect(staleOf(["label-templates", "x"])).toBe(CATALOG_STALE_MS));
  it("diğer her şey 30 sn (5 dk değil)", () => {
    expect(staleOf(["warehouse-transfers"])).toBe(30_000);
    expect(staleOf(["free-documents"])).toBe(30_000);
  });
});
