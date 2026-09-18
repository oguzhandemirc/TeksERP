// BEKÇİ — Cari Hesaplar "Durum" süzgeci (Z-B ④): varsayılan Hareketli → filter[hasActivity]=true; Tümü → süzgeç yok
import { describe, expect, it } from "vitest";
import { activityFilters, CARI_ACTIVITY_DEFAULT, CARI_ACTIVITY_OPTIONS } from "./cariListFilters";

describe("cariListFilters", () => {
  it("⭐ varsayılan Hareketli ve yalnız o süzgeç gönderir", () => {
    expect(CARI_ACTIVITY_DEFAULT).toBe("active");
    expect(activityFilters("active")).toEqual({ hasActivity: "true" });
    expect(activityFilters("all")).toEqual({});
    expect(CARI_ACTIVITY_OPTIONS.map((o) => o.label)).toEqual(["Hareketli", "Tümü"]);
  });
});
