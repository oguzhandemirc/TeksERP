// Desen kartı kopya gövdesi — ızgara/döner çerçeve birebir, tezgâh dosyası boş, gizli alan taşınmaz.
import { describe, expect, it } from "vitest";
import type { WeaveDesign } from "./types";
import { buildCopyPayload } from "./weave-copy";

const base: WeaveDesign = {
  id: "wd-1", code: "UA6007", name: "Balık", kind: "LENO", shedMechanism: "DOBBY", weaveStructure: "LENO",
  hookCount: 2688, repeatWidthCm: "12.5", familyLabel: "TERGAL-DÖNER", frameCount: 3, repeatCm: "1.50",
  liftPlan: [[1, 0, 1], [0, 1, 1]], loomFileName: "D2057.DOP", lenoSetup: "20'li normal döner", lenoFrames: [1],
  drawingInNote: "1-2-3 düz", notes: "not", isActive: true, image: { id: "i", fileName: "a.png", mimeType: "image/png", sizeBytes: 1, updatedAt: "" },
};

describe("buildCopyPayload", () => {
  it("Armür: ızgara + döner çerçeveler birebir; tezgâh dosyası, görsel, id gönderilmez", () => {
    const p = buildCopyPayload(base, { code: " UA6007B ", name: " Balık B " });
    expect(p).toEqual({
      code: "UA6007B", name: "Balık B", shedMechanism: "DOBBY", weaveStructure: "LENO", familyLabel: "TERGAL-DÖNER",
      frameCount: 3, repeatCm: "1.50", lenoSetup: "20'li normal döner", lenoFrames: [1], drawingInNote: "1-2-3 düz", notes: "not",
      liftPlan: [[1, 0, 1], [0, 1, 1]],
    });
    expect(p).not.toHaveProperty("loomFileName");
    expect(p).not.toHaveProperty("kind");
    expect(p.liftPlan).not.toBe(base.liftPlan);
  });

  it("tahar türü: Armür/Eksantrik'te kopyalanır, Jakar'da ve boşken gönderilmez", () => {
    expect(buildCopyPayload({ ...base, drawingInType: "SKIP" }, { code: "X", name: "Y" }).drawingInType).toBe("SKIP");
    expect(buildCopyPayload({ ...base, shedMechanism: "CAM", drawingInType: "POINTED" }, { code: "X", name: "Y" }).drawingInType).toBe("POINTED");
    expect(buildCopyPayload({ ...base, shedMechanism: "JACQUARD", drawingInType: "POINTED" }, { code: "X", name: "Y" })).not.toHaveProperty("drawingInType");
    expect(buildCopyPayload({ ...base, drawingInType: null }, { code: "X", name: "Y" })).not.toHaveProperty("drawingInType");
  });

  it("Eksantrik: saklı ızgara ve kanca taşınmaz (sunucu reddederdi)", () => {
    const p = buildCopyPayload({ ...base, shedMechanism: "CAM", weaveStructure: "PLAIN", selvedgeFrames: [2] }, { code: "X", name: "Y" });
    expect(p).not.toHaveProperty("liftPlan");
    expect(p).not.toHaveProperty("hookCount");
    expect(p).not.toHaveProperty("repeatWidthCm");
    expect(p).not.toHaveProperty("selvedgeFrames");
  });

  it("Armür: kenar çerçeveleri kopyalanır (yeni dizi); alan yoksa gönderilmez (eski sunucu)", () => {
    const src = { ...base, selvedgeFrames: [2, 3] };
    const p = buildCopyPayload(src, { code: "X", name: "Y" });
    expect(p.selvedgeFrames).toEqual([2, 3]);
    expect(p.selvedgeFrames).not.toBe(src.selvedgeFrames);
    expect(buildCopyPayload(base, { code: "X", name: "Y" })).not.toHaveProperty("selvedgeFrames");
  });

  it("Jakar: kanca + rapor eni gelir, ızgara gelmez; eski kart `kind`tan çözülür", () => {
    const p = buildCopyPayload({ ...base, shedMechanism: null, weaveStructure: null, kind: "JACQUARD" }, { code: "X", name: "Y" });
    expect(p.shedMechanism).toBe("JACQUARD");
    expect(p.hookCount).toBe(2688);
    expect(p.repeatWidthCm).toBe("12.5");
    expect(p).not.toHaveProperty("liftPlan");
  });
});
