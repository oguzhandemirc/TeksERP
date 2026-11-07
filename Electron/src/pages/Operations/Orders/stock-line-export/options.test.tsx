// Modal tercihi: kullanıcı tercihinde hatırlanır; bozuk/eski şema varsayılana döner; hazır değilken yazılmaz.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { AppPreferences } from "@/types/preferences";
import { DEFAULT_STOCK_LINE_OPTIONS, readStockLineOptions } from "./options";
import { useStockLineExportPrefs } from "./useStockLineExportPrefs";

let prefs: AppPreferences = {};
let ready = true;
const setPreference = vi.fn((patch: Partial<AppPreferences>) => {
  prefs = { ...prefs, ...patch };
});
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs, setPreference, ready }),
}));

beforeEach(() => {
  prefs = { orders: { statsView: "genis" } };
  ready = true;
  setPreference.mockClear();
});

describe("readStockLineOptions", () => {
  it("yok / bozuk şekil → varsayılan", () => {
    for (const raw of [undefined, null, "x", 42, [], { columns: "ordered" }]) {
      expect(readStockLineOptions(raw)).toEqual(DEFAULT_STOCK_LINE_OPTIONS);
    }
  });

  it("alan alan süzer: tanınmayan sütun düşer, boş kalırsa varsayılan sütunlar; sıra katalog sırası", () => {
    expect(readStockLineOptions({ byColor: false, byWidth: "evet", columns: ["customers", "eski", "open", "open"] })).toEqual({
      byColor: false,
      byWidth: true,
      onlyOpen: true,
      columns: ["open", "customers"],
    });
    expect(readStockLineOptions({ columns: ["eski"] }).columns).toEqual(DEFAULT_STOCK_LINE_OPTIONS.columns);
  });
});

describe("useStockLineExportPrefs", () => {
  it("kaydedilen seçim bir sonraki açılışta hazır gelir; diğer sipariş tercihleri korunur", () => {
    const first = renderHook(() => useStockLineExportPrefs());
    expect(first.result.current.options).toEqual(DEFAULT_STOCK_LINE_OPTIONS);
    act(() =>
      first.result.current.save({ byColor: false, byWidth: true, onlyOpen: false, columns: ["toProduce", "ordered"] }),
    );
    expect(prefs.orders?.statsView).toBe("genis");
    const second = renderHook(() => useStockLineExportPrefs());
    expect(second.result.current.options).toEqual({
      byColor: false,
      byWidth: true,
      onlyOpen: false,
      columns: ["ordered", "toProduce"],
    });
  });

  it("tercihler yüklenmeden yazmaz (diğer tercihleri ezmesin)", () => {
    ready = false;
    const { result } = renderHook(() => useStockLineExportPrefs());
    act(() => result.current.save({ ...DEFAULT_STOCK_LINE_OPTIONS, byColor: false }));
    expect(setPreference).not.toHaveBeenCalled();
  });
});
