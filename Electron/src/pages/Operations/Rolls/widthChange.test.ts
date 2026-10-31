// D4-E2b: top geçmişindeki en değişimi satırı — metin + fabrika dilimi saati.
import { describe, expect, it } from "vitest";
import type { RollHistoryEvent } from "./service";
import { readWidthChange, widthChangeLine } from "./widthChange";

const ev = (metadata: unknown, over: Partial<RollHistoryEvent> = {}): RollHistoryEvent => ({
  kind: "OPERATION",
  subKind: "QC2_COMPLETED",
  at: "2026-10-31T11:05:00.000Z",
  title: "KK2 Tamamlandı",
  stationName: "Etek Kesim",
  details: { metadata },
  operatorName: "Ayşe Yılmaz",
  ...over,
});

describe("top geçmişi — en değişimi satırı", () => {
  it("⭐ 'En 300 → 280 cm, <istasyon>, <kişi>, <saat>' (saat fabrika diliminden, UTC+3)", () => {
    expect(widthChangeLine(ev({ notes: null, widthBefore: 300, widthAfter: 280 }))).toBe(
      "En 300 → 280 cm, Etek Kesim, Ayşe Yılmaz, 31.10.2026 14:05",
    );
  });

  it("ondalık en virgülle; önceki en yoksa 'ölçüldü'", () => {
    expect(widthChangeLine(ev({ widthBefore: 300, widthAfter: 279.5 }))).toMatch(/^En 300 → 279,5 cm, /);
    expect(widthChangeLine(ev({ widthBefore: null, widthAfter: 280 }))).toMatch(/^En 280 cm ölçüldü, /);
  });

  it("eksik kişi/istasyon atlanır", () => {
    expect(widthChangeLine(ev({ widthBefore: 300, widthAfter: 280 }, { stationName: null, operatorName: null }))).toBe(
      "En 300 → 280 cm, 31.10.2026 14:05",
    );
  });

  it("en izi olmayan olay → satır YOK (eski metadata, dizi, null)", () => {
    expect(widthChangeLine(ev({ notes: "n1" }))).toBeNull();
    expect(widthChangeLine(ev(null))).toBeNull();
    expect(readWidthChange(ev([1, 2]))).toBeNull();
    expect(readWidthChange({ details: {} })).toBeNull();
  });
});
