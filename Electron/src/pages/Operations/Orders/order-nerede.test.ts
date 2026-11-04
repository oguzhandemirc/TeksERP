import { describe, it, expect } from "vitest";
import {
  NEREDE_TABS,
  activeNeredeTab,
  neredeExportText,
  neredeTabs,
  neredeTone,
  normalizeFasonGun,
} from "./order-nerede";
import type { OrderNerede } from "./types";

const n = (p: Partial<OrderNerede>): OrderNerede => ({
  kind: "STEP",
  tone: "blue",
  text: "Ham kontrol aşamasında · 12 top",
  extraPlaces: 0,
  overdue: false,
  overdueText: null,
  ...p,
});

describe("Nerede? — panel saf katmanı", () => {
  it("renk eşlemesi: gri/mavi/turuncu/yeşil → muted/info/warning/success", () => {
    expect(neredeTone("gray")).toBe("muted");
    expect(neredeTone("blue")).toBe("info");
    expect(neredeTone("orange")).toBe("warning");
    expect(neredeTone("green")).toBe("success");
    expect(neredeTone(undefined)).toBe("neutral");
  });

  it("dışa aktarım metni sunucunun cümlesidir; panel cümle kurmaz", () => {
    expect(neredeExportText({ nerede: n({}) })).toBe("Ham kontrol aşamasında · 12 top");
    expect(neredeExportText({ nerede: n({ overdue: true, overdueText: "Termini geçti" }) })).toBe(
      "Ham kontrol aşamasında · 12 top · Termini geçti",
    );
    expect(neredeExportText({})).toBe("—");
  });

  it("hızlı sekmeler: tasarımdaki sıra ve adlar", () => {
    expect(NEREDE_TABS.map((t) => t.label)).toEqual([
      "Tümü",
      "Bekleyenler",
      "Fasonda",
      "Sevke hazır",
      "Kısmen gidenler",
      "Gecikenler",
    ]);
    expect(NEREDE_TABS.map((t) => t.value)).toEqual([null, "BEKLEYEN", "FASONDA", "SEVKE_HAZIR", "KISMEN", "GECIKEN"]);
  });

  it("üretim kapalıyken Fasonda/Sevke hazır sekmeleri düşer, diğerleri kalır", () => {
    expect(neredeTabs(true)).toHaveLength(6);
    expect(neredeTabs(false).map((t) => t.label)).toEqual(["Tümü", "Bekleyenler", "Kısmen gidenler", "Gecikenler"]);
  });

  it("URL değerinden etkin sekme; tanınmayan değer Tümü görünür", () => {
    expect(activeNeredeTab("FASONDA")).toBe("FASONDA");
    expect(activeNeredeTab(null)).toBeNull();
    expect(activeNeredeTab("fasonda")).toBeNull();
  });

  it.each([
    ["3", "3"],
    [" 007 ", "7"],
    ["0", "0"],
    ["3650", "3650"],
    ["3651", null],
    ["-1", null],
    ["2.5", null],
    ["abc", null],
    ["", null],
  ])("gün girişi %j → %j (sunucu 400'üne düşmez)", (input, out) => {
    expect(normalizeFasonGun(input)).toBe(out);
  });
});
