import { describe, expect, it } from "vitest";
import { deviceId, guideCss, mmToPx, pageDevices, pageDimensions, rulerTicks } from "./pageCanvas";

describe("sayfa kanvası", () => {
  it("mm → px CSS oranıyla (96 dpi)", () => {
    expect(mmToPx(25.4)).toBe(96);
    expect(mmToPx(10)).toBe(38);
  });

  it("A4/A5/Letter × dikey/yatay ölçüleri", () => {
    expect(pageDimensions("A4", "portrait")).toMatchObject({ widthPx: 794, heightPx: 1123, widthMm: 210 });
    expect(pageDimensions("A4", "landscape")).toMatchObject({ widthPx: 1123, heightPx: 794, widthMm: 297 });
    expect(pageDimensions("A5", "landscape")).toMatchObject({ widthPx: 794, heightPx: 559 });
    expect(pageDimensions("LETTER", "portrait")).toMatchObject({ widthPx: 816, heightPx: 1056 });
  });

  it("altı cihaz, Türkçe adlı, benzersiz kimlikli", () => {
    const d = pageDevices();
    expect(d).toHaveLength(6);
    expect(new Set(d.map((x) => x.id)).size).toBe(6);
    expect(d.find((x) => x.id === deviceId("A5", "landscape"))).toMatchObject({ name: "A5 yatay", width: "794px" });
  });

  it("kılavuz CSS'i kenar boşluğu ve sayfa yüksekliğinde kesme çizgisi taşır", () => {
    const css = guideCss(pageDimensions("A4", "portrait"), 15);
    expect(css).toContain("padding:57px");
    expect(css).toContain("1122px");
    expect(css).toContain("dashed");
  });

  it("cetvel: her cm çentik, çift cm etiketli", () => {
    const t = rulerTicks(210);
    expect(t).toHaveLength(22);
    expect(t.filter((x) => x.labeled).map((x) => x.cm).slice(0, 3)).toEqual([0, 2, 4]);
  });
});
