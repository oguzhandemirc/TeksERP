// Arşiv 409'u — kayıt listeli gövde diyaloğa gider, toast basılmaz (yıkıcı işlem kuralı).
import { afterEach, describe, expect, it, vi } from "vitest";
import { presentLiveReferences, registerLiveReferencesPresenter } from "./live-references";

const refs = [{ kind: "ROLL", label: "Top", count: 1, records: [{ id: "r1", title: "B1", detail: "WAREHOUSE · 5 m" }] }];

afterEach(() => registerLiveReferencesPresenter(null));

describe("presentLiveReferences", () => {
  it("⭐ iki kod da (ürün + diğer ana veri) diyalogda gösterilir", () => {
    const fn = vi.fn();
    registerLiveReferencesPresenter(fn);
    for (const code of ["ITEM_HAS_LIVE_REFERENCES", "MASTER_DATA_HAS_LIVE_REFERENCES"]) {
      expect(presentLiveReferences({ message: "pasife alınamaz", details: { code, references: refs } })).toBe(true);
    }
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[0]![0]).toEqual({ message: "pasife alınamaz", references: refs });
  });
  it("başka kod, kayıt listesi olmayan gövde ya da gösterici yoksa false (genel toast kalır)", () => {
    expect(presentLiveReferences({ details: { code: "ITEM_HAS_LIVE_REFERENCES", references: refs } })).toBe(false);
    const fn = vi.fn();
    registerLiveReferencesPresenter(fn);
    expect(presentLiveReferences({ details: { code: "ITEM_LIFECYCLE_CHANGED" } })).toBe(false);
    expect(presentLiveReferences({ details: { code: "ITEM_HAS_LIVE_REFERENCES" } })).toBe(false);
    expect(presentLiveReferences(undefined)).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });
});
