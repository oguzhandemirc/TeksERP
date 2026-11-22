import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { WeaveGrid, columnLayout } from "./WeaveGrid";

describe("WeaveGrid", () => {
  it("32 × 512 ızgara renk başına TEK path ile çizilir (DOM yükü yok)", () => {
    const { container } = render(
      <WeaveGrid ariaLabel="büyük" rows={512} cols={32} cell={8} fill={(r, c) => ((r + c) % 2 ? "red" : (r % 5 === 0 ? "blue" : null))} />,
    );
    expect(container.querySelectorAll("[data-fill]")).toHaveLength(2);
    expect(container.querySelectorAll("rect")).toHaveLength(0);
  });

  it("alttan yukarıda 0. satır en altta çizilir", () => {
    const one = (dir: "bottom-up" | "top-down") => {
      const { container } = render(<WeaveGrid ariaLabel="y" rows={3} cols={1} cell={10} rowLabel={false} direction={dir} fill={(r) => (r === 0 ? "red" : null)} />);
      return container.querySelector("[data-fill]")!.getAttribute("d")!;
    };
    expect(one("top-down")).toMatch(/^M0\.5 0\.5/);
    expect(one("bottom-up")).toMatch(/^M0\.5 20\.5/);
  });

  it("blok aralığı sütunları kaydırır", () => {
    const l = columnLayout(5, 10, [2, 4]);
    expect(l.blocks).toEqual([[0, 2], [2, 4], [4, 5]]);
    expect(l.xs[2]! - l.xs[1]!).toBeGreaterThan(10);
    expect(l.xs[1]! - l.xs[0]!).toBe(10);
  });

  it("rapor bandı kalın çizgiyle çizilir", () => {
    const { container } = render(<WeaveGrid ariaLabel="b" rows={6} cols={2} rowBandEvery={3} fill={() => null} />);
    expect(container.querySelector("[data-band]")).not.toBeNull();
  });
});
