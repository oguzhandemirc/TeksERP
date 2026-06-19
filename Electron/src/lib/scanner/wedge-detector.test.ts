import { describe, it, expect } from "vitest";
import {
  createWedgeDetector,
  DEFAULT_WEDGE_CONFIG,
  type WedgeKeyEvent,
  type WedgeResult,
} from "./wedge-detector";

function ev(key: string, over: Partial<WedgeKeyEvent> = {}): WedgeKeyEvent {
  return { key, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, ...over };
}

/** Bir string'i `gapMs` aralıklarla besler; sonda terminator varsa onu da gönderir. */
function typeString(
  det: ReturnType<typeof createWedgeDetector>,
  s: string,
  gapMs: number,
  startMs = 1000,
  terminator: string | null = "Enter",
): { result: WedgeResult | null; now: number } {
  let now = startMs;
  let result: WedgeResult | null = null;
  for (let i = 0; i < s.length; i++) {
    if (i > 0) now += gapMs;
    result = det.feed(ev(s[i]!), now);
  }
  if (terminator) {
    now += gapMs;
    result = det.feed(ev(terminator), now);
  }
  return { result, now };
}

describe("wedge-detector — burst tespiti", () => {
  it("hızlı tuşlar + Enter → scan emit eder", () => {
    const det = createWedgeDetector();
    const { result } = typeString(det, "TEKS-20260615-AB12CD34", 20);
    expect(result).not.toBeNull();
    expect(result!.code).toBe("TEKS-20260615-AB12CD34");
    expect(result!.charCount).toBe(22);
  });

  it("yavaş (insan) yazım + Enter → null", () => {
    const det = createWedgeDetector();
    const { result } = typeString(det, "TEKS-20260615-AB12CD34", 150);
    expect(result).toBeNull();
  });

  it("minLength altındaki kısa hızlı burst + Enter → null", () => {
    const det = createWedgeDetector();
    const { result } = typeString(det, "AB", 10);
    expect(result).toBeNull();
  });

  it("Enter göndermeyen tabanca → graceTail sonrası flushIdle ile emit", () => {
    const det = createWedgeDetector();
    const { now } = typeString(det, "CV-260615-001", 15, 1000, null);
    expect(det.isCapturing()).toBe(true);
    // Henüz sessizlik dolmadı → null
    expect(det.flushIdle(now + DEFAULT_WEDGE_CONFIG.graceTailMs - 10)).toBeNull();
    // Sessizlik dolunca flush
    const flushed = det.flushIdle(now + DEFAULT_WEDGE_CONFIG.graceTailMs + 5);
    expect(flushed).not.toBeNull();
    expect(flushed!.code).toBe("CV-260615-001");
  });

  it("burst ortasında modifier → buffer iptal, scan yok", () => {
    const det = createWedgeDetector();
    let now = 1000;
    det.feed(ev("T"), now);
    det.feed(ev("E"), (now += 10));
    det.feed(ev("K"), (now += 10));
    // Ctrl basılı bir tuş → reset
    const r1 = det.feed(ev("S", { ctrlKey: true }), (now += 10));
    expect(r1).toBeNull();
    expect(det.isCapturing()).toBe(false);
    const r2 = det.feed(ev("Enter"), (now += 10));
    expect(r2).toBeNull();
  });

  it("IME besteleme (isComposing) tuşları yok sayılır", () => {
    const det = createWedgeDetector();
    let now = 1000;
    det.feed(ev("ş", { isComposing: true }), now);
    det.feed(ev("ı", { isComposing: true }), (now += 10));
    expect(det.isCapturing()).toBe(false);
  });

  it("yavaş gap burst'ü böler — kısa kalan kuyruk diskalifiye olur", () => {
    const det = createWedgeDetector();
    let now = 1000;
    const s = "TEKS-2026AB"; // yavaş gap "A"'dan önce → kuyruk "AB" (2 char) < minLength
    for (let i = 0; i < s.length; i++) {
      const gap = i === 9 ? 200 : 15;
      if (i > 0) now += gap;
      det.feed(ev(s[i]!), now);
    }
    const r = det.feed(ev("Enter"), (now += 15));
    // Yavaş gap önceki "TEKS-2026" burst'ünü iptal etti; kalan "AB" çok kısa → null
    expect(r).toBeNull();
  });

  it("yavaş gap'in ardındaki uzun-hızlı kuyruk yeni burst olarak emit edilir", () => {
    const det = createWedgeDetector();
    let now = 1000;
    const s = "X-TEKS20260615"; // ilk "X-" kısa, yavaş gap, sonra uzun hızlı kuyruk
    for (let i = 0; i < s.length; i++) {
      const gap = i === 2 ? 200 : 12;
      if (i > 0) now += gap;
      det.feed(ev(s[i]!), now);
    }
    const r = det.feed(ev("Enter"), (now += 12));
    expect(r).not.toBeNull();
    expect(r!.code).toBe("TEKS20260615"); // yavaş gap'ten önceki "X-" atıldı
  });

  it("Tab terminator (config) ile çalışır", () => {
    const det = createWedgeDetector({ ...DEFAULT_WEDGE_CONFIG, terminator: "Tab" });
    const { result } = typeString(det, "TEKS-20260615-AB12CD34", 20, 1000, "Tab");
    expect(result).not.toBeNull();
    expect(result!.code).toBe("TEKS-20260615-AB12CD34");
  });

  it("reset sonrası temiz başlar", () => {
    const det = createWedgeDetector();
    typeString(det, "TEKS-1", 15, 1000, null);
    det.reset();
    expect(det.isCapturing()).toBe(false);
    expect(det.flushIdle(99999)).toBeNull();
  });
});
