import { describe, expect, it } from "vitest";
import { withListSlot } from "./service";

describe("withListSlot", () => {
  it("liste kolonu istekleri aynı anda en fazla 4 uçar, hepsi tamamlanır", async () => {
    let active = 0;
    let peak = 0;
    const job = (i: number) =>
      withListSlot(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        return i;
      });
    const out = await Promise.all(Array.from({ length: 12 }, (_, i) => job(i)));
    expect(out).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(peak).toBe(4);
  });

  it("hata yuvayı serbest bırakır", async () => {
    await expect(withListSlot(() => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await withListSlot(async () => 1)).toBe(1);
  });
});
