import { act, render, waitFor } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ init: 0, dispose: 0, setOption: [] as Array<{ o: Record<string, unknown>; notMerge?: boolean }> }));

vi.mock("@/pages/Reports/_v2/grafik/motor", () => ({
  echarts: {
    init: (el: HTMLElement) => {
      calls.init += 1;
      return {
        setOption: (o: Record<string, unknown>, opts?: { notMerge?: boolean }) => calls.setOption.push({ o, notMerge: opts?.notMerge }),
        resize: () => undefined,
        dispose: () => { calls.dispose += 1; },
        getDom: () => el,
        getDataURL: () => "",
      };
    },
  },
}));

import { EChart } from "./EChart";
import { seriesShape } from "./useEChartInstance";

const opt = (t: { renkler: string[] }) => ({ series: [{ type: "bar", name: "a", data: [1], itemStyle: { color: t.renkler[0] } }] });

describe("EChart — görünüm değişimi yeniden kurmaz", () => {
  beforeEach(() => {
    // jsdom düzen ölçmez; kurulum boyutlu kap ister.
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 300 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 100 });
    calls.init = 0;
    calls.dispose = 0;
    calls.setOption = [];
    document.documentElement.removeAttribute("data-density");
  });

  it("tema/yoğunluk özniteliği değişince aynı örnekte birleştirerek boyar (dispose yok)", async () => {
    const { unmount } = render(<EChart option={opt} height={100} label="g" />);
    await waitFor(() => expect(calls.setOption.length).toBe(1));
    expect(calls.setOption[0]!.notMerge).toBe(true);
    await act(async () => {
      document.documentElement.setAttribute("data-density", "comfortable");
      document.documentElement.classList.toggle("dark");
      await Promise.resolve();
    });
    await waitFor(() => expect(calls.setOption.length).toBeGreaterThan(1));
    expect(calls.init).toBe(1);
    expect(calls.dispose).toBe(0);
    expect(calls.setOption.at(-1)!.notMerge).toBe(false);
    expect(calls.setOption.at(-1)!.o.animationDurationUpdate).toBe(400);
    unmount();
    expect(calls.dispose).toBe(1);
  });

  it("yeni seçenek kimliği (yeniden çizim) örneği yeniden kurmaz", async () => {
    const { rerender } = render(<EChart option={opt} height={100} label="g" />);
    await waitFor(() => expect(calls.setOption.length).toBe(1));
    rerender(<EChart option={(t) => opt(t)} height={100} label="g" />);
    await waitFor(() => expect(calls.setOption.length).toBe(2));
    expect(calls.init).toBe(1);
    expect(calls.dispose).toBe(0);
  });

  afterAll(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  });

  it("seri dizilimi değişince tam değiştirme (notMerge)", () => {
    expect(seriesShape({ series: [{ type: "line", name: "a" }] })).not.toBe(seriesShape({ series: [{ type: "bar", name: "a" }] }));
  });
});
